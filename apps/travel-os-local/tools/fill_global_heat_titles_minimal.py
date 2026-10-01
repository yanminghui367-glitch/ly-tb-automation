from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import xml.etree.ElementTree as ET

SOURCE = Path(r"D:\桌面文件迁移\全球城市服务需求热度_中国客群筛选版(1).xlsx")
OUTPUT_DIR = Path.cwd() / "output" / "标题补全_20260916"
OUTPUT = OUTPUT_DIR / "全球城市服务需求热度_中国客群筛选版(1)_标题补全.xlsx"
DESKTOP_OUTPUT = Path(r"D:\桌面文件迁移\全球城市服务需求热度_中国客群筛选版(1)_标题补全.xlsx")
CITY_COUNT = 500
COUNTRY_COUNT = 200
LINK_MAX = 30
GUIDE_MAX = 15
SERVICES = ["导游", "地陪", "包车", "翻译", "一日游", "接送机", "旅行", "定制行程", "地接", "商务"]
CITY_TITLE_ALIASES = {
    "Nizhniy Novgorod": "下诺夫哥罗德",
    "Staten Island": "斯塔滕岛",
    "Ecatepec de Morelos": "埃卡特佩克",
    "Leon de los Aldama": "莱昂",
    "堪察加的彼得巴甫洛夫斯克": "彼得罗巴甫洛夫斯克",
    "Mueang Nonthaburi": "暖武里",
    "Ciudad Lopez Mateos": "洛佩斯马特奥斯城",
    "Banjarbaru": "班贾尔巴鲁",
    "Saint Charles": "圣查尔斯",
    "Ras Al Khaimah": "哈伊马角",
    "Gasteiz / Vitoria": "维多利亚",
    "Makhachkala": "马哈奇卡拉",
    "圣地亚哥-德孔波斯特拉": "圣地亚哥",
    "Newport News": "纽波特纽斯",
    "Higashiosaka": "东大阪",
    "Krasnoyarsk": "克拉斯诺亚尔斯克",
    "Chicoloapan": "奇科洛阿潘",
}
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS = {"m": MAIN_NS}
ET.register_namespace("", MAIN_NS)


def col_to_num(column):
    total = 0
    for char in column:
        total = total * 26 + ord(char) - 64
    return total


def num_to_col(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def split_ref(reference):
    letters = "".join(char for char in reference if char.isalpha())
    numbers = "".join(char for char in reference if char.isdigit())
    return letters, int(numbers)


def cell_value(cell, shared_strings):
    if cell is None:
        return ""
    if cell.get("t") == "inlineStr":
        inline = cell.find("m:is", NS)
        return "".join(inline.itertext()) if inline is not None else ""
    value = cell.find("m:v", NS)
    if value is None:
        return ""
    text = value.text or ""
    return shared_strings[int(text)] if cell.get("t") == "s" else text


def find_cell(row, column):
    for cell in row.findall("m:c", NS):
        letters, _ = split_ref(cell.get("r"))
        if letters == column:
            return cell
    return None


def set_inline_text(row, column, row_number, text):
    cell = find_cell(row, column)
    if cell is None:
        cell = ET.Element(f"{{{MAIN_NS}}}c", {"r": f"{column}{row_number}", "t": "inlineStr"})
        row.append(cell)
    cell.attrib["r"] = f"{column}{row_number}"
    cell.attrib["t"] = "inlineStr"
    for child in list(cell):
        cell.remove(child)
    inline = ET.SubElement(cell, f"{{{MAIN_NS}}}is")
    text_node = ET.SubElement(inline, f"{{{MAIN_NS}}}t")
    text_node.text = text
    row[:] = sorted(row, key=lambda node: col_to_num(split_ref(node.get("r"))[0]) if node.tag == f"{{{MAIN_NS}}}c" else -1)


def ordered_services(index):
    offset = index % len(SERVICES)
    rotated = SERVICES[offset:] + SERVICES[:offset]
    return rotated if (index // len(SERVICES)) % 2 == 0 else list(reversed(rotated))


def build_title(location, index, max_length):
    location = str(location).strip()
    if not location or len(location) >= max_length:
        raise ValueError(f"无法为地点生成服务标题：{location}")
    title = location
    used = []
    priority = ["定制行程"] + [item for item in ordered_services(index) if item != "定制行程"]
    for keyword in priority:
        if len(title) + len(keyword) <= max_length:
            title += keyword
            used.append(keyword)
    if not used:
        raise ValueError(f"标题没有可用服务关键词：{location}")
    return title


def add_table_column(table_root, header, ref):
    table_root.attrib["ref"] = ref
    auto_filter = table_root.find("m:autoFilter", NS)
    if auto_filter is not None:
        auto_filter.attrib["ref"] = ref
    columns = table_root.find("m:tableColumns", NS)
    if columns is None:
        raise ValueError("表格缺少 tableColumns 定义。")
    columns.append(ET.Element(f"{{{MAIN_NS}}}tableColumn", {"id": "0", "name": header}))
    for index, column in enumerate(columns.findall("m:tableColumn", NS), start=1):
        column.attrib["id"] = str(index)
    columns.attrib["count"] = str(len(columns.findall("m:tableColumn", NS)))


def insert_city_guide_column(sheet_root):
    for row in sheet_root.findall("m:sheetData/m:row", NS):
        for cell in reversed(row.findall("m:c", NS)):
            column, row_number = split_ref(cell.get("r"))
            if col_to_num(column) >= col_to_num("K"):
                cell.attrib["r"] = f"{num_to_col(col_to_num(column) + 1)}{row_number}"
        row[:] = sorted(row, key=lambda node: col_to_num(split_ref(node.get("r"))[0]) if node.tag == f"{{{MAIN_NS}}}c" else -1)
    dimension = sheet_root.find("m:dimension", NS)
    if dimension is not None:
        dimension.attrib["ref"] = "A1:V27800"
    columns = sheet_root.find("m:cols", NS)
    if columns is None:
        columns = ET.Element(f"{{{MAIN_NS}}}cols")
        sheet_root.insert(1, columns)
    for column in list(columns):
        if column.tag != f"{{{MAIN_NS}}}col":
            continue
        if int(column.get("min")) >= 11:
            column.attrib["min"] = str(int(column.get("min")) + 1)
            column.attrib["max"] = str(int(column.get("max")) + 1)
    columns.append(ET.Element(f"{{{MAIN_NS}}}col", {"min": "10", "max": "10", "width": "30", "customWidth": "1"}))
    columns.append(ET.Element(f"{{{MAIN_NS}}}col", {"min": "11", "max": "11", "width": "18", "customWidth": "1"}))
    columns[:] = sorted(columns, key=lambda node: int(node.get("min", "0")))


def set_country_title_column_widths(sheet_root):
    columns = sheet_root.find("m:cols", NS)
    if columns is None:
        columns = ET.Element(f"{{{MAIN_NS}}}cols")
        sheet_root.insert(1, columns)
    columns.append(ET.Element(f"{{{MAIN_NS}}}col", {"min": "40", "max": "40", "width": "30", "customWidth": "1"}))
    columns.append(ET.Element(f"{{{MAIN_NS}}}col", {"min": "41", "max": "41", "width": "18", "customWidth": "1"}))
    columns[:] = sorted(columns, key=lambda node: int(node.get("min", "0")))


def source_rows(sheet_root):
    return {int(row.get("r")): row for row in sheet_root.findall("m:sheetData/m:row", NS)}


def validate_prefix(title, prefix, max_length):
    return title.startswith(prefix) and len(title) <= max_length and any(keyword in title for keyword in SERVICES)


print("读取源工作簿并生成候选标题...")
with ZipFile(SOURCE) as source_zip:
    shared_root = ET.fromstring(source_zip.read("xl/sharedStrings.xml"))
    shared_strings = ["".join(item.itertext()) for item in shared_root.findall("m:si", NS)]
    city_root = ET.fromstring(source_zip.read("xl/worksheets/sheet1.xml"))
    country_root = ET.fromstring(source_zip.read("xl/worksheets/sheet4.xml"))
    city_rows_before = source_rows(city_root)
    country_rows_before = source_rows(country_root)

    city_locations = []
    for row_number in range(6, 6 + CITY_COUNT):
        row = city_rows_before[row_number]
        city = cell_value(find_cell(row, "G"), shared_strings).strip()
        title_city = CITY_TITLE_ALIASES.get(city, city)
        country = cell_value(find_cell(row, "D"), shared_strings).strip()
        if not title_city or not country:
            raise ValueError(f"境外城市热度第{row_number}行缺少城市或国家。")
        city_locations.append((row_number, title_city, country))

    country_locations = []
    for row_number in range(5, 226):
        row = country_rows_before.get(row_number)
        country = cell_value(find_cell(row, "E") if row is not None else None, shared_strings).strip()
        if country and country != "中国":
            country_locations.append((row_number, country))
    country_locations = country_locations[:COUNTRY_COUNT]
    if len(country_locations) != COUNTRY_COUNT:
        raise ValueError("境外国家不足200条。")

    overlong_city_locations = [(city + country, len(city + country)) for _, city, country in city_locations if len(city + country) > GUIDE_MAX - 2]
    if overlong_city_locations:
        print({"overlong_city_prefixes": overlong_city_locations})

    city_links = [build_title(city + country, index, LINK_MAX) for index, (_, city, country) in enumerate(city_locations)]
    city_guides = [build_title(city + country, index + 37, GUIDE_MAX) for index, (_, city, country) in enumerate(city_locations)]
    country_links = [build_title(country, index + 101, LINK_MAX) for index, (_, country) in enumerate(country_locations)]
    country_guides = [build_title(country, index + 211, GUIDE_MAX) for index, (_, country) in enumerate(country_locations)]

    if not all(validate_prefix(title, city + country, LINK_MAX) for title, (_, city, country) in zip(city_links, city_locations)):
        raise ValueError("城市链接标题前缀或长度校验失败。")
    if not all(validate_prefix(title, city + country, GUIDE_MAX) for title, (_, city, country) in zip(city_guides, city_locations)):
        raise ValueError("城市导购标题前缀或长度校验失败。")
    if not all(validate_prefix(title, country, LINK_MAX) for title, (_, country) in zip(country_links, country_locations)):
        raise ValueError("国家链接标题前缀或长度校验失败。")
    if not all(validate_prefix(title, country, GUIDE_MAX) for title, (_, country) in zip(country_guides, country_locations)):
        raise ValueError("国家导购标题前缀或长度校验失败。")

    insert_city_guide_column(city_root)
    city_rows = source_rows(city_root)
    for (row_number, _, _), link_title, guide_title in zip(city_locations, city_links, city_guides):
        set_inline_text(city_rows[row_number], "J", row_number, link_title)
        set_inline_text(city_rows[row_number], "K", row_number, guide_title)
    set_inline_text(city_rows[5], "J", 5, "链接标题")
    set_inline_text(city_rows[5], "K", 5, "导购标题")

    country_rows = source_rows(country_root)
    set_inline_text(country_rows[4], "AN", 4, "链接标题")
    set_inline_text(country_rows[4], "AO", 4, "导购标题")
    for (row_number, _), link_title, guide_title in zip(country_locations, country_links, country_guides):
        set_inline_text(country_rows[row_number], "AN", row_number, link_title)
        set_inline_text(country_rows[row_number], "AO", row_number, guide_title)
    country_dimension = country_root.find("m:dimension", NS)
    if country_dimension is not None:
        country_dimension.attrib["ref"] = "A1:AO225"
    set_country_title_column_widths(country_root)

    table1 = ET.fromstring(source_zip.read("xl/tables/table1.xml"))
    table1_columns = table1.find("m:tableColumns", NS)
    table1_list = table1_columns.findall("m:tableColumn", NS)
    link_index = next((index for index, column in enumerate(table1_list) if column.get("name") == "链接标题"), None)
    if link_index is None:
        raise ValueError("境外城市表未找到链接标题列。")
    table1_columns.insert(link_index + 1, ET.Element(f"{{{MAIN_NS}}}tableColumn", {"id": "0", "name": "导购标题"}))
    table1.attrib["ref"] = "A5:V27800"
    table1_auto_filter = table1.find("m:autoFilter", NS)
    if table1_auto_filter is not None:
        table1_auto_filter.attrib["ref"] = "A5:V27800"
    for index, column in enumerate(table1_columns.findall("m:tableColumn", NS), start=1):
        column.attrib["id"] = str(index)
    table1_columns.attrib["count"] = str(len(table1_columns.findall("m:tableColumn", NS)))

    table4 = ET.fromstring(source_zip.read("xl/tables/table4.xml"))
    add_table_column(table4, "链接标题", "A4:AO225")
    add_table_column(table4, "导购标题", "A4:AO225")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=6) as output_zip:
        for item in source_zip.infolist():
            if item.filename == "xl/worksheets/sheet1.xml":
                output_zip.writestr(item, ET.tostring(city_root, encoding="utf-8", xml_declaration=True))
            elif item.filename == "xl/worksheets/sheet4.xml":
                output_zip.writestr(item, ET.tostring(country_root, encoding="utf-8", xml_declaration=True))
            elif item.filename == "xl/tables/table1.xml":
                output_zip.writestr(item, ET.tostring(table1, encoding="utf-8", xml_declaration=True))
            elif item.filename == "xl/tables/table4.xml":
                output_zip.writestr(item, ET.tostring(table4, encoding="utf-8", xml_declaration=True))
            else:
                output_zip.writestr(item, source_zip.read(item.filename))

print("验证输出工作簿...")
with ZipFile(OUTPUT) as output_zip:
    if output_zip.testzip() is not None:
        raise ValueError("输出工作簿压缩结构损坏。")
    validated_city_root = ET.fromstring(output_zip.read("xl/worksheets/sheet1.xml"))
    validated_country_root = ET.fromstring(output_zip.read("xl/worksheets/sheet4.xml"))
    validated_city_rows = source_rows(validated_city_root)
    validated_country_rows = source_rows(validated_country_root)
    for (row_number, city, country), link_title, guide_title in zip(city_locations, city_links, city_guides):
        if cell_value(find_cell(validated_city_rows[row_number], "J"), shared_strings) != link_title:
            raise ValueError(f"城市链接标题回读失败：第{row_number}行。")
        if cell_value(find_cell(validated_city_rows[row_number], "K"), shared_strings) != guide_title:
            raise ValueError(f"城市导购标题回读失败：第{row_number}行。")
    for (row_number, country), link_title, guide_title in zip(country_locations, country_links, country_guides):
        if cell_value(find_cell(validated_country_rows[row_number], "AN"), shared_strings) != link_title:
            raise ValueError(f"国家链接标题回读失败：第{row_number}行。")
        if cell_value(find_cell(validated_country_rows[row_number], "AO"), shared_strings) != guide_title:
            raise ValueError(f"国家导购标题回读失败：第{row_number}行。")
    if ET.fromstring(output_zip.read("xl/tables/table1.xml")).get("ref") != "A5:V27800":
        raise ValueError("境外城市表范围未扩展至导购标题列。")
    if ET.fromstring(output_zip.read("xl/tables/table4.xml")).get("ref") != "A4:AO225":
        raise ValueError("所有国家表范围未扩展至标题列。")

DESKTOP_OUTPUT.write_bytes(OUTPUT.read_bytes())
print({
    "output": str(DESKTOP_OUTPUT),
    "city_titles": len(city_links),
    "country_titles": len(country_links),
    "max_link_length": max(map(len, city_links + country_links)),
    "max_guide_length": max(map(len, city_guides + country_guides)),
})
