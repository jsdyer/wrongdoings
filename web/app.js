const $ = name => document.getElementById(name);
const query = $("query");
const dialog = $("dialog");
const results = $("results");
const initial = new URLSearchParams(location.hash.slice(1));
const selected = new Map();
const detailsCache = new Map();
const format = new Intl.NumberFormat("en-CA");
const limit = 12;
let current = 0;
let total = 0;
let page = 0;
let manifest;
let worker;
let linked = initial.get("record");
let inputTimer;
let detailRequest = 0;

function el(tag, text, style) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (style) node.className = style;
  return node;
}

function button(text, run, style) {
  const node = el("button", text, style);
  node.type = "button";
  node.addEventListener("click", run);
  return node;
}

function link(text, href) {
  const node = el("a", text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function dateLabel(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) return "Date unavailable";
  return value.slice(0, 10);
}

function title(row) {
  const language = $("lang").value === "fr" ? 1 : 0;
  return row.titles[language] || row.titles[1 - language] || row.ref || "Untitled record";
}

function search() {
  if (!worker) return;
  $("clear-query").hidden = !query.value;
  const filters = Object.fromEntries(["org", "year", "category", "lang"].map(key => [key, $(key).value]));
  const parameters = new URLSearchParams();
  if (query.value.trim()) parameters.set("q", query.value.trim());
  for (const [k, value] of Object.entries(filters)) if (value && (k !== "lang" || value !== "en")) parameters.set(k, value);
  if (linked) parameters.set("record", linked);
  const hash = parameters.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
  worker.postMessage({ type: "search", revision: ++current, query: query.value, ...filters, page, limit, record: linked });
}

function refresh() {
  clearTimeout(inputTimer);
  page = 0;
  linked = null;
  search();
}

function renderMetadata(data) {
  manifest = data;
  $("record-count").textContent = format.format(data.count);
  $("institutions").textContent = `${format.format(data.institutions)} institutions`;
  $("record-date").textContent = data.latest ? `Most recent dated record: ${dateLabel(data.latest)}` : "";
  $("provenance").textContent = `Snapshot built ${dateLabel(data.generated)}. ${data.modified ? `Source file last modified ${dateLabel(data.modified)}.` : "Publisher modification date unavailable."}`;
  $("chips").replaceChildren(...data.chips.map(value => button(value, () => { query.value = value; refresh(); query.focus(); }, "chip")));
}

function options(element, values) {
  for (const [value, label] of values) {
    const option = el("option", label);
    option.value = value;
    element.append(option);
  }
  const fromUrl = initial.get(element.id);
  if (fromUrl && [...element.options].some(option => option.value === fromUrl)) element.value = fromUrl;
}

function sourceFor(row) {
  if (row.org && row.ref) return new URL(`record/${encodeURIComponent(row.org + "," + row.ref)}`, manifest.sourceSearch).href;
  const url = new URL(manifest.sourceSearch);
  url.searchParams.set("search_text", row.ref || title(row));
  return url.href;
}

function atipFor(row) {
  const params = new URLSearchParams({ q: row.ref ? `"${row.ref}"` : title(row).slice(0, 180) });
  if (row.org) params.set("institution", row.org);
  return `https://coolcode.ca/atip/#${params}`;
}

function displayMeta(row) {
  const when = row.date || (row.dateText ? `Source date: ${row.dateText}` : "Date unavailable");
  return [row.ref, row.institution || "Institution unavailable", when].filter(Boolean).join(" · ");
}

function card(row) {
  const article = el("article", null, "result");
  article.append(el("p", displayMeta(row), "meta"), el("h3", title(row)));
  const language = $("lang").value === "fr" ? 1 : 0;
  const preview = row.previews[language] || row.previews[1 - language];
  if (preview) article.append(el("p", preview, "summary"));
  const actions = el("div", null, "actions");
  actions.append(button("Read record", () => openRecord(row), "primary"));
  if (manifest.compare) {
    const compare = button(selected.has(row.id) ? "Selected ✓" : "Select for comparison", () => {
      if (selected.has(row.id)) selected.delete(row.id);
      else if (selected.size < 2) selected.set(row.id, row);
      updateCompare();
    });
    compare.dataset.compare = row.id;
    compare.setAttribute("aria-label", `Select ${row.ref || title(row)} for comparison`);
    actions.append(compare);
  }
  article.append(actions);
  return article;
}

function render(data) {
  total = data.count;
  $("status").textContent = `${format.format(total)} ${manifest.recordLabel}`;
  results.replaceChildren(...data.pageRows.map(card));
  if (!total) {
    const empty = el("article", null, "result");
    empty.append(el("h3", "No matching records"), el("p", "Try a shorter phrase, another institution, or a term in French."), button("Clear all filters", reset));
    results.append(empty);
  }
  const pages = Math.ceil(total / limit);
  $("pagination").hidden = pages <= 1;
  $("page-info").textContent = `Page ${page + 1} of ${Math.max(pages, 1)}`;
  $("previous").disabled = page === 0;
  $("next").disabled = page + 1 >= pages;
  updateCompare();
  if (linked) {
    if (data.linked) openRecord(data.linked);
    else $("status").textContent += " · The linked record is unavailable in this snapshot.";
    linked = null;
  }
}

function updateCompare() {
  $("compare-tray").hidden = !selected.size;
  $("compare-status").textContent = selected.size === 2 ? "Two notes selected" : "Select one more note to compare";
  $("compare-open").disabled = selected.size !== 2;
  for (const b of results.querySelectorAll("[data-compare]")) {
    const included = selected.has(b.dataset.compare);
    b.textContent = included ? "Selected ✓" : "Select for comparison";
    b.setAttribute("aria-pressed", String(included));
    b.disabled = !included && selected.size === 2;
  }
}

function failure() {
  $("status").textContent = "The search snapshot could not be loaded.";
  const panel = el("article", null, "result");
  panel.append(el("p", "Try loading again, or search the government portal while this snapshot is unavailable."),
    button("Retry", () => location.reload()));
  results.replaceChildren(panel);
}

async function getDetails(row) {
  if (!detailsCache.has(row.detail)) {
    const url = new URL(`./data/${row.detail}`, import.meta.url);
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const blob = new Blob([bytes]);
    const text = await (bytes[0] === 31 && bytes[1] === 139 ? new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text() : blob.text());
    if (detailsCache.size >= 6) detailsCache.delete(detailsCache.keys().next().value);
    detailsCache.set(row.detail, JSON.parse(text));
  }
  return detailsCache.get(row.detail)[row.id] || [];
}

function writeSections(card, sections) {
  const fr = $("lang").value === "fr";
  for (const [label, en, french] of sections) {
    const text = (fr ? french : en) || (fr ? en : french);
    if (!text) continue;
    const box = el("section", null, "detail-section");
    const fallback = fr && !french && en ? " (English source)" : !fr && !en && french ? " (French source)" : "";
    box.append(el("h3", label + fallback), el("p", text, "detail-text"));
    card.append(box);
  }
}

function dialogShell(heading) {
  const token = ++detailRequest;
  $("detail-heading").textContent = heading;
  const body = $("detail-body");
  body.replaceChildren();
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  return [token, body];
}

function recordHeader(row, container, heading) {
  if (heading) container.append(el("h3", title(row)));
  container.append(el("p", displayMeta(row), "meta"), link("Find the original disclosure ↗", sourceFor(row)));
}

async function openRecord(row) {
  const [token, body] = dialogShell(title(row));
  recordHeader(row, body, false);
  const links = el("p", null, "actions");
  const share = new URL(location.href);
  const params = new URLSearchParams(share.hash.slice(1));
  params.set("record", row.id);
  share.hash = params.toString();
  const copy = button("Copy record link", async () => {
    try { await navigator.clipboard.writeText(share.href); copy.textContent = "Link copied"; }
    catch { links.append(el("span", share.href)); }
  });
  links.append(copy, link("Look for related ATI files ↗", atipFor(row)));
  body.append(links);
  const loading = el("p", "Loading original text…", "small");
  body.append(loading);
  try {
    const sections = await getDetails(row);
    if (token !== detailRequest) return;
    loading.remove();
    writeSections(body, sections);
  } catch {
    if (token === detailRequest) loading.textContent = "Original text unavailable here. Use the official source link above.";
  }
}

async function compare() {
  if (selected.size !== 2) return;
  const pair = [...selected.values()];
  const [token, body] = dialogShell("Compare prepared notes");
  const grid = el("div", null, "comparison");
  body.append(grid);
  await Promise.allSettled(pair.map(async row => {
    const column = el("article");
    recordHeader(row, column, true);
    grid.append(column);
    try {
      const sections = await getDetails(row);
      if (token === detailRequest) writeSections(column, sections);
    } catch { column.append(el("p", "Full text unavailable.")); }
  }));
}

function reset() {
  query.value = "";
  for (const id of ["org", "year", "category"]) $(id).value = "";
  refresh();
  query.focus();
}

query.value = (initial.get("q") || "").slice(0, 240);
if (initial.get("lang") === "fr") $("lang").value = "fr";
$("search-form").addEventListener("submit", event => { event.preventDefault(); refresh(); });
query.addEventListener("input", () => {
  clearTimeout(inputTimer);
  inputTimer = setTimeout(refresh, 60);
});
$("clear-query").addEventListener("click", () => { query.value = ""; refresh(); query.focus(); });
for (const id of ["org", "year", "category", "lang"]) $(id).addEventListener("change", refresh);
$("reset").addEventListener("click", reset);
$("compare-open").addEventListener("click", compare);
$("compare-clear").addEventListener("click", () => { selected.clear(); updateCompare(); });
$("previous").addEventListener("click", () => { if (page) { page--; search(); } });
$("next").addEventListener("click", () => { if ((page + 1) * limit < total) { page++; search(); } });
dialog.addEventListener("close", () => detailRequest++);
try {
  worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  worker.addEventListener("error", failure);
  worker.addEventListener("message", ({ data }) => {
    if (data.type === "metadata") renderMetadata(data.metadata);
    if (data.type === "progress") $("status").textContent = `Loaded ${format.format(data.count)} of ${format.format(data.total)} records…`;
    if (data.type === "ready") {
      options($("org"), data.orgs.sort((a, b) => a[1].localeCompare(b[1])));
      options($("year"), data.years.sort().reverse().map(year => [year, year]));
      options($("category"), data.categories.sort().map(category => [category, category]));
      $("category-label").hidden = !data.categories.length;
      search();
    }
    if (data.type === "results" && data.revision === current) render(data);
    if (data.type === "error") failure();
  });
} catch { failure(); }
