#!/usr/bin/env python3
"""Build a browser-only explorer from the official Open Government CSV."""
import argparse
import csv
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import unicodedata
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "dataset.json").read_text())


def clean(value):
    return (value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def plain(value):
    return " ".join(value.split())


def normalize(value):
    base = unicodedata.normalize("NFKD", value.lower())
    return plain(re.sub(r"[^\w]+|_", " ", "".join(c for c in base if not unicodedata.combining(c))))


def valid_date(value):
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return ""


def download(target):
    for attempt in range(3):
        try:
            request = Request(CONFIG["csv"], headers={"User-Agent": "CoolCode Open Government Discovery/1.0"})
            with urlopen(request, timeout=75) as response, target.open("wb") as out:
                if response.headers.get_content_type() == "text/html":
                    raise OSError("The CSV endpoint returned an HTML page.")
                expected = response.headers.get("Content-Length")
                shutil.copyfileobj(response, out)
                if expected and expected.isdigit() and out.tell() != int(expected):
                    raise OSError("Official CSV download was truncated.")
                modified = response.headers.get("Last-Modified")
            if modified:
                try:
                    return parsedate_to_datetime(modified).date().isoformat()
                except (TypeError, ValueError):
                    pass
            return ""
        except OSError as error:
            if attempt == 2:
                raise RuntimeError(f"Official download failed: {error}") from error
            time.sleep(2 ** attempt)


def write(path, data, zipped=False):
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(gzip.compress(encoded, compresslevel=6, mtime=0) if zipped else encoded)


def read_csv(source):
    csv.field_size_limit(sys.maxsize)
    config = CONFIG
    title_cols = config.get("titleFields", [])
    content_fields = [field for group in config["sections"] for field in group[1:] if field]
    required = {"owner_org", "owner_org_title", config["reference"], config["date"], *title_cols, *content_fields, *config.get("extraFields", [])}
    records = []
    seen = set()
    with source.open(encoding="utf-8-sig", newline="") as file:
        data = csv.DictReader(file)
        if not data.fieldnames or required.difference(data.fieldnames):
            raise ValueError("The official CSV is missing expected columns.")
        for row in data:
            if None in row or any(row.get(field) is None for field in required):
                raise ValueError(f"Malformed row near line {data.line_num}.")
            row = {key: clean(value) for key, value in row.items()}
            ref = row[config["reference"]]
            org = row["owner_org"]
            org_title = row["owner_org_title"].partition("|")[0].strip() or org
            if not any(row[field] for field in title_cols + content_fields) and not ref:
                continue
            uid = hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
            if uid in seen:
                continue
            seen.add(uid)
            date_text = row[config["date"]]
            iso = valid_date(date_text)
            if title_cols:
                titles = [row[key] for key in title_cols]
                categories = []
            else:
                codes = list(dict.fromkeys(x.strip().lower() for x in row.get("findings_conclusions", "").split(",") if x.strip()))
                categories = [config["findingNames"].get(code, f"Category {code}") for code in codes]
                titles = ["; ".join(categories) or "Published finding", ""]
            sections = [[label, row.get(en, ""), row.get(fr, "")] for label, en, fr in config["sections"]]
            fulltext = " ".join([ref, org, row["owner_org_title"], date_text, *titles,
                                 *categories, *[item for group in sections for item in group[1:]]])
            previews = []
            for language in (1, 2):
                preview = plain(next((group[language] for group in sections if group[language]), ""))
                previews.append(preview[:300].rsplit(" ", 1)[0] + "…" if len(preview) > 300 else preview)
            record = {"id": uid, "ref": ref, "org": org, "institution": org_title, "date": iso,
                      "dateText": date_text, "titles": titles, "categories": categories, "previews": previews}
            records.append((record, sections, f" {normalize(fulltext)} "))
    if len(records) < config["minimum"]:
        raise ValueError(f"Only {len(records)} distinct rows parsed. Refusing to publish an incomplete export.")
    records.sort(key=lambda item: (item[0]["date"], item[0]["ref"]), reverse=True)
    return records


def build(source, output, modified):
    records = read_csv(source)
    output = output.resolve()
    web = ROOT / "web"
    if output in {ROOT, web, source.parent.resolve()} or output in ROOT.parents or web in output.parents:
        raise ValueError("Use a separate output directory.")
    if source.resolve().is_relative_to(output):
        raise ValueError("Input CSV must be outside the build output.")
    marker = output / "data/manifest.json"
    if output.exists() and any(output.iterdir()):
        if not marker.is_file() or json.loads(marker.read_text()).get("kind") != CONFIG["kind"]:
            raise ValueError("Choose a new or previously generated output directory.")
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        stage = Path(temp) / "site"
        shutil.copytree(web, stage)
        data = stage / "data"
        data.mkdir()
        groups = []
        chunk_size = 200
        for start in range(0, len(records), chunk_size):
            batch = records[start:start + chunk_size]
            number = start // chunk_size
            shard = f"search-{number:02d}.json.gz"
            details = []
            for offset in range(0, len(batch), 20):
                section_file = f"detail-{number:02d}-{offset // 20:02d}.json.gz"
                subset = batch[offset:offset + 20]
                write(data / section_file, {row["id"]: fields for row, fields, _ in subset}, True)
                details.extend([[row | {"detail": section_file}, lookup] for row, _, lookup in subset])
            write(data / shard, details, True)
            groups.append(shard)
        metadata = {key: value for key, value in CONFIG.items() if key in [
            "name", "kind", "dataset", "csv", "sourceSearch", "compare", "chips", "recordLabel"]}
        metadata.update({
            "count": len(records),
            "institutions": len({row["org"] for row, _, _ in records if row["org"]}),
            "shards": groups,
            "generated": datetime.now(timezone.utc).isoformat(),
            "modified": modified,
            "latest": next((row["date"] for row, _, _ in records if row["date"] <= date.today().isoformat()), ""),
        })
        write(data / "manifest.json", metadata)
        if output.exists():
            shutil.rmtree(output)
        stage.rename(output)
    size = sum(x.stat().st_size for x in (output / "data").glob("search-*"))
    print(f"{len(records):,} records · {metadata['institutions']} institutions · {size / (1024 ** 2):.2f} MiB compressed search index")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="Use a previously downloaded official CSV")
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    options = parser.parse_args()
    options.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    try:
        if options.csv:
            build(options.csv, options.output, "")
        else:
            with tempfile.TemporaryDirectory(prefix="coolcode-archive-") as directory:
                source = Path(directory) / "source.csv"
                modified = download(source)
                build(source, options.output, modified)
    except (ValueError, OSError, RuntimeError, csv.Error) as exc:
        parser.exit(1, f"Build failed: {exc}\n")


if __name__ == "__main__":
    main()
