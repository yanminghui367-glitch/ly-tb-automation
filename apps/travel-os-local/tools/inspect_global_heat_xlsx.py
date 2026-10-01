from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

SOURCE = Path(r"D:\桌面文件迁移\全球城市服务需求热度_中国客群筛选版(1).xlsx")
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def cell_value(cell, shared_strings):
    value = cell.find("m:v", NS)
    if value is None:
        inline = cell.find("m:is/m:t", NS)
        return inline.text if inline is not None else ""
    text = value.text or ""
    if cell.get("t") == "s":
        return shared_strings[int(text)]
    return text


with ZipFile(SOURCE) as book:
    shared_root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    shared = ["".join(node.itertext()) for node in shared_root.findall("m:si", NS)]
    workbook = ET.fromstring(book.read("xl/workbook.xml"))
    rels_root = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    rel_map = {node.get("Id"): node.get("Target") for node in rels_root}

    for sheet in workbook.find("m:sheets", NS):
        name = sheet.get("name")
        target = rel_map[sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
        xml_path = "xl/" + target.replace("\\", "/")
        sheet_root = ET.fromstring(book.read(xml_path))
        rows = sheet_root.findall("m:sheetData/m:row", NS)
        print(f"SHEET={name} ROWS={len(rows)}")
        for row in rows[:12]:
            values = [f"{cell.get('r')}={cell_value(cell, shared)}" for cell in row.findall("m:c", NS)]
            print(" | ".join(values))
