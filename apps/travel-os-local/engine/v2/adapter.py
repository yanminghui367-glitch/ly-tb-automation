"""Read-only XLSX adapter. Standard library only; never opens source for writing."""
import argparse
import hashlib
import json
import posixpath
import re
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_sheet(path, name):
    with ZipFile(path) as z:
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            strings = ["".join(t.text or "" for t in si.iterfind(".//m:t", NS))
                       for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        sheets = ET.fromstring(z.read("xl/workbook.xml")).findall("m:sheets/m:sheet", NS)
        target = next((rels[s.get(RID)] for s in sheets if s.get("name") == name), None)
        if target is None:
            raise ValueError(f"Sheet missing: {name}; available: {[s.get('name') for s in sheets]}")
        entry = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
        for row in ET.fromstring(z.read(entry)).findall("m:sheetData/m:row", NS):
            cells = {}
            for c in row.findall("m:c", NS):
                v = c.find("m:v", NS)
                value = v.text or "" if v is not None else ""
                if c.get("t") == "s":
                    value = strings[int(value)]
                elif c.get("t") == "inlineStr":
                    value = "".join(t.text or "" for t in c.iterfind(".//m:t", NS))
                cells[re.sub(r"\d", "", c.get("r"))] = {
                    "value": value, "cell": c.get("r"), "formula": c.find("m:f", NS) is not None}
            yield int(row.get("r")), cells


ALIASES = {"rank": ["境外热度排名", "筛选后热度排名", "热度排名"], "country": ["国家/地区(中文)", "国家地区", "国家/地区"],
           "city": ["城市中文名", "城市名称"], "title": ["链接标题", "商品标题"],
           "title2": ["商品标题2", "标题版本2"], "category": ["类目"]}


def prepare(workbook, sheet, assets, shop, packages=None, limit=None):
    before = sha(workbook)
    images = sorted(p for p in Path(assets).rglob("*") if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
    mains = {}
    for p in images:
        m = re.fullmatch(r"\d+-(国家|城市)-(.+)", p.stem)
        if m:
            mains.setdefault((m[1], m[2]), []).append(str(p.resolve()))
    package_index = {}
    if packages:
        for p in sorted(Path(packages).glob("*.json")):
            data = json.loads(p.read_text(encoding="utf-8-sig"))
            listing = data.get("listing", {})
            if listing.get("location_type") == "city":
                package_index.setdefault((listing.get("country"), listing.get("city")), []).append((p, data))
    header = None
    tasks = []
    seen = set()
    data_rows = 0
    titleless_rows = 0
    for row, cells in read_sheet(workbook, sheet):
        if header is None:
            candidate = {key: next((col for col, c in cells.items() if c["value"] in names), None) for key, names in ALIASES.items()}
            if all(candidate[k] for k in ["rank", "country", "city", "title"]):
                header = candidate
            continue
        def value(key):
            return cells.get(header.get(key), {}).get("value", "").strip()
        if not value("rank").isdigit() or not value("city"):
            continue
        data_rows += 1
        if not value("title"):
            titleless_rows += 1
            continue
        country, city = value("country"), value("city")
        issues = []
        if (country, city) in seen:
            issues.append("DUPLICATE_DESTINATION")
        seen.add((country, city))
        if any(cells.get(header[k], {}).get("formula") for k in ["country", "city", "title"]):
            issues.append("FORMULA_BUSINESS_FIELD_REQUIRES_REVIEW")
        matching = package_index.get((country, city), [])
        pkg = matching[0][1] if len(matching) == 1 else {}
        if len(matching) > 1:
            issues.append("AMBIGUOUS_PACKAGE")
        base = matching[0][0].parent if len(matching) == 1 else Path(assets)
        source_assets = pkg.get("assets", {})
        candidates = mains.get(("城市", city), [])
        main = source_assets.get("main_image")
        if not main:
            main = candidates[0] if len(candidates) == 1 else None
            if len(candidates) != 1:
                issues.append("MAIN_IMAGE_MISSING" if not candidates else "MAIN_IMAGE_AMBIGUOUS")
        secondary = source_assets.get("secondary_images", source_assets.get("secondary_image_set", {}).get("files", []))
        details = source_assets.get("detail_images", [])
        def asset(path):
            p = Path(path)
            p = p if p.is_absolute() else base / p
            if not p.is_file():
                issues.append("ASSET_NOT_FOUND")
                return {"path": str(p.resolve()), "sha256": None}
            return {"path": str(p.resolve()), "sha256": sha(p)}
        title_versions = pkg.get("listing", {}).get("title_versions", [])
        if not title_versions:
            title_versions = [value("title")] + ([value("title2")] if value("title2") else [])
        if pkg.get("listing", {}).get("title") not in (None, value("title")):
            issues.append("PACKAGE_TITLE_DIFFERS_FROM_EXCEL")
        selected = pkg.get("listing", {}).get("selected_title_index")
        provenance = {"workbook": str(Path(workbook).resolve()), "sha256": before, "sheet": sheet, "row": row,
                      "cells": {k: cells.get(col, {}).get("cell") for k, col in header.items() if col}}
        if len(matching) == 1:
            provenance["package"] = {"path": str(matching[0][0].resolve()), "sha256": sha(matching[0][0])}
        tasks.append({"schemaVersion": 2, "shopId": shop, "source": provenance,
                      "listing": {"type": "city", "country": country, "city": city, "title": value("title"),
                                  "titleVersions": title_versions, "selectedTitleIndex": selected},
                      "assets": {"main": [asset(main)] if main else [], "secondary": [asset(p) for p in secondary], "details": [asset(p) for p in details]},
                      "business": pkg.get("release_profile", {}), "evidence": pkg.get("review_evidence", {}),
                      "adapterIssues": sorted(set(issues)), "priority": int(value("rank")),
                      "mappingCandidates": {"main": candidates, "categoryFromExcel": value("category")}})
    if header is None:
        raise ValueError("Required headers not found; refusing positional guesses")
    tasks.sort(key=lambda t: (t["priority"], t["source"]["row"]))
    if limit is not None:
        tasks = tasks[:limit]
    if sha(workbook) != before:
        raise ValueError("Source changed during read")
    return {"schemaVersion": 2, "sourceHashBefore": before, "sourceHashAfter": before, "tasks": tasks,
            "selection": {"dataRows": data_rows, "excludedWithoutTitle": titleless_rows, "selected": len(tasks), "limit": limit},
            "assetInventory": {"count": len(images), "mainNamingRule": "数字-(国家|城市)-目的地.扩展名",
                               "nonMainCandidates": [str(p.resolve()) for p in images if not re.fullmatch(r"\d+-(国家|城市)-(.+)", p.stem)]}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--sheet", default="境外城市热度")
    parser.add_argument("--assets", required=True)
    parser.add_argument("--shop", required=True)
    parser.add_argument("--packages")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output == Path(args.workbook).resolve() or output.suffix.lower() != ".json" or output.exists():
        raise ValueError("Output must be a new JSON file; source and existing artifacts are read-only")
    result = prepare(args.workbook, args.sheet, args.assets, args.shop, args.packages, args.limit)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"tasks": len(result["tasks"]), "sourceUnchanged": True, "output": str(output)}, ensure_ascii=False))
