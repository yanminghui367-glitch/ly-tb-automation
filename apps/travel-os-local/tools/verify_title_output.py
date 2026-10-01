from zipfile import ZipFile
import xml.etree.ElementTree as ET

SOURCE = r"D:\桌面文件迁移\全球城市服务需求热度_中国客群筛选版(1).xlsx"
PATH = r"D:\桌面文件迁移\全球城市服务需求热度_中国客群筛选版(1)_标题补全.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def column(reference):
    return "".join(char for char in reference if char.isalpha())


def inline_value(rows, row_number, target_column):
    cell = next((item for item in rows[row_number].findall("m:c", NS) if column(item.get("r")) == target_column), None)
    inline = cell.find("m:is", NS) if cell is not None else None
    return "".join(inline.itertext()) if inline is not None else ""


with ZipFile(PATH) as book:
    city_root = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
    country_root = ET.fromstring(book.read("xl/worksheets/sheet4.xml"))
    city_rows = {int(row.get("r")): row for row in city_root.findall("m:sheetData/m:row", NS)}
    country_rows = {int(row.get("r")): row for row in country_root.findall("m:sheetData/m:row", NS)}
    print({
        "city_headers": [inline_value(city_rows, 5, column_name) for column_name in ("J", "K", "L")],
        "city_samples": [(row_number, inline_value(city_rows, row_number, "J"), inline_value(city_rows, row_number, "K")) for row_number in (6, 7, 505)],
        "country_headers": [inline_value(country_rows, 4, column_name) for column_name in ("AN", "AO")],
        "country_samples": [(row_number, inline_value(country_rows, row_number, "AN"), inline_value(country_rows, row_number, "AO")) for row_number in (5, 7, 205)],
        "city_table_ref": ET.fromstring(book.read("xl/tables/table1.xml")).get("ref"),
        "country_table_ref": ET.fromstring(book.read("xl/tables/table4.xml")).get("ref"),
    })

for workbook_path in (SOURCE, PATH):
    with ZipFile(workbook_path) as book:
        worksheet_xml = b"".join(
            book.read(name)
            for name in book.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        print({
            "workbook": workbook_path,
            "formula_nodes": worksheet_xml.count(b"<f"),
            "formula_error_tokens": sum(
                worksheet_xml.count(token)
                for token in (b"#REF!", b"#DIV/0!", b"#VALUE!", b"#NAME?", b"#N/A", b"#NUM!", b"#NULL!", b"#SPILL!", b"#CALC!")
            ),
        })

with ZipFile(PATH) as book:
    for sheet_name in ("sheet1.xml", "sheet4.xml"):
        root = ET.fromstring(book.read(f"xl/worksheets/{sheet_name}"))
        formulas = ["".join(node.itertext()) for node in root.findall(".//m:f", NS)]
        print({"sheet": sheet_name, "formula_count": len(formulas), "formula_samples": formulas[:10]})
    city_root = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
    print({"city_column_widths": [node.attrib for node in city_root.findall("m:cols/m:col", NS) if node.get("min") in {"10", "11", "12", "13"}]})
