const base = new URL("./data/", import.meta.url);
let rows;
let pending;
let cached;
function normalize(value) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function terms(query) {
  return [...query.replace(/[“”]/g, '"').matchAll(/(-?)"([^"]*)"?(?=\s|$)|(-?)([^\s"]+)/g)]
    .flatMap(match => {
      const quoted = match[1] !== undefined;
      const value = normalize(match[2] ?? match[4]);
      return value ? (quoted ? [value] : value.split(" ")).map(text => [` ${text}${quoted || match[3] ? " " : ""}`, Boolean(match[1] || match[3])]) : [];
    });
}
async function read(file) {
  const response = await fetch(new URL(file, base), { signal: AbortSignal.timeout(75000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = new Blob([bytes]);
  return JSON.parse(await (bytes[0] === 31 && bytes[1] === 139
    ? new Response(body.stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : body.text()));
}
async function load() {
  const metadata = await read("manifest.json");
  if (!metadata.count || !metadata.shards?.length) throw new Error("Empty search snapshot");
  let left = 0, count = 0;
  const chunks = new Array(metadata.shards.length);
  self.postMessage({ type: "metadata", metadata });
  async function loader() {
    while (left < chunks.length) {
      const index = left++;
      chunks[index] = await read(metadata.shards[index]);
      count += chunks[index].length;
      self.postMessage({ type: "progress", count, total: metadata.count });
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, loader));
  rows = chunks.flat();
  if (rows.length !== metadata.count) throw new Error("Incomplete search snapshot");
  const orgs = new Map(), years = new Set(), categories = new Set();
  for (const [row] of rows) {
    if (row.org) orgs.set(row.org, row.institution);
    if (row.date) years.add(row.date.slice(0, 4));
    row.categories.forEach(category => categories.add(category));
  }
  self.postMessage({ type: "ready", orgs: [...orgs], years: [...years], categories: [...categories] });
  if (pending) search(pending);
}
function search(message) {
  const { revision, query, org, year, category, page, limit, record } = message;
  const key = JSON.stringify([query, org, year, category]);
  if (key !== cached?.key) {
    const tokens = terms(query);
    const q = normalize(query);
    const hits = [];
    for (const [row, text] of rows) {
      if ((org && org !== row.org) || (year && !row.date.startsWith(year)) || (category && !row.categories.includes(category))) continue;
      if (!tokens.every(([term, excluded]) => text.includes(term) !== excluded)) continue;
      let score = 0;
      if (q) {
        if (normalize(row.ref) === q) score += 30;
        if (row.titles.some(title => normalize(title).includes(q))) score += 15;
      }
      hits.push([row, score]);
    }
    if (q) hits.sort((a, b) => b[1] - a[1]);
    cached = { key, hits };
  }
  const { hits } = cached;
  self.postMessage({ type: "results", revision, count: hits.length, pageRows: hits.slice(page * limit, (page + 1) * limit).map(x => x[0]),
    linked: record ? rows.find(x => x[0].id === record)?.[0] : null });
}
self.onmessage = ({ data }) => {
  if (rows) search(data);
  else pending = data;
};
load().catch(error => self.postMessage({ type: "error", message: error.message }));
