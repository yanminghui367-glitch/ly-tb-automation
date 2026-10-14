"""Fixed setup template -> existing immutable task contract. No seller/browser access."""
import argparse
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine' / 'v2'))
from adapter import read_sheet, sha
from pool_adapter import known_destination_mismatch

SPEC = json.loads((Path(__file__).with_name('setup-template.json')).read_text(encoding='utf-8'))
SPEC_V2 = json.loads((Path(__file__).with_name('setup-template-v2.json')).read_text(encoding='utf-8'))
IMAGE = {'.png', '.jpg', '.jpeg', '.webp'}


def prepare(root, shop_id, shop_name):
    root = Path(root).resolve(strict=True)
    workbook = root / SPEC['workbook']
    before = sha(workbook)
    with ZipFile(workbook) as z:
        if sum(x.file_size for x in z.infolist()) > 32 * 1024 * 1024:
            raise ValueError('Excel 解压后过大，请拆分资料')
    product_rows = list(read_sheet(workbook, SPEC['productsSheet']))
    header = {c: v['value'].strip() for c, v in product_rows[0][1].items()} if product_rows else {}
    if list(header.values()) == SPEC_V2['columns']:
        spec = SPEC_V2
    elif list(header.values()) == SPEC['columns']:
        spec = SPEC
    else:
        raise ValueError('商品清单表头不匹配，请下载最新版模板，保持字段顺序不变')
    v2 = spec['version'] == 2
    config = {}
    for row, cells in read_sheet(workbook, spec['settingsSheet']):
        if row == 1:
            continue
        label = cells.get('A', {}).get('value', '').strip()
        value = cells.get('B', {}).get('value', '').strip()
        if label in spec['settings']:
            if label in config:
                raise ValueError('店铺设置重复：' + label)
            if cells.get('B', {}).get('formula'):
                raise ValueError('店铺设置不能使用公式：' + label)
            config[label] = value
    if config.get('店铺名称') != shop_name:
        raise ValueError('模板店铺名称与当前执行店铺不一致，请核对店铺设置')
    business = {key: config.get(label, '') for label, key in spec['settings'].items()}
    # The current Taobao fixed template uses this full UI label for the same
    # verified 24-hour setting. Accept only the exact option; do not infer a
    # shipping promise from partial text.
    if business['shipping_time'] == '按商品统一设置-24小时内发货':
        business['shipping_time'] = '24小时内发货'
    required_settings = [label for label in spec['settings'] if label not in ('店铺识别码', '素材版本')]
    shared_issues = ['店铺设置缺少：' + label for label in required_settings if not config.get(label)]
    if v2:
        if not re.fullmatch(r'[A-Z0-9]{2,12}', config.get('店铺识别码', '')):
            shared_issues.append('店铺识别码须为2至12位大写英文字母或数字')
    if config.get('是否定制') not in ('是', '否'):
        shared_issues.append('是否定制必须明确填是或否')
    business['custom_service'] = config.get('是否定制') == '是'
    if business['brand'] != '无品牌/无注册商标':
        shared_issues.append('品牌应为已确认的无品牌/无注册商标')
    # Preserve the actual executor's supported settings; never invent defaults.
    if not re.search(r'个性定制/设计服务/DIY.*其它定制.*其它商品定制', business['category_path']):
        shared_issues.append('此类目尚未完成执行适配，请核对真实类目；不要为通过检查修改业务事实')
    supported = {'custom_service': True, 'procurement': '中国内地（大陆）', 'shipping_time': '24小时内发货',
                 'ship_from_region': '大陆及港澳台', 'region_restriction': '不设置商品维度区域限售模板'}
    if any(business[k] != v for k, v in supported.items()) or business['ship_from'].replace(' ', '') != '北京/北京':
        shared_issues.append('店铺设置与当前已验证执行范围不同，需完成适配后才能执行')
    if business['listing_time'] not in ('立刻上架', '立即上架', '放入仓库'):
        shared_issues.append('上架方式未填写或不在已验证范围')
    files, by_stem, by_name = [], {}, {}
    for folder in spec['folders']:
        base = root / folder
        if not base.is_dir():
            shared_issues.append('缺少目录：' + folder)
            continue
        if base.resolve() != base or base.is_symlink():
            raise ValueError('资料目录不能使用链接：' + folder)
        for p in sorted(base.iterdir()):
            if p.is_symlink():
                raise ValueError('图片不能使用链接：' + p.name)
            if p.is_file() and p.suffix.lower() in IMAGE:
                files.append(p)
                by_stem.setdefault((folder, p.stem), []).append(p)
                by_name.setdefault(p.name.lower(), []).append(p)
    if len(files) > 5000:
        raise ValueError('图片超过5000张，请按店铺拆分')
    for name, matches in by_name.items():
        if len(matches) > 1:
            shared_issues.append('图片文件名重复：' + name)
    cache = {}
    for folder, count in [('副图/A', 4), ('副图/B', 4), ('详情首页', 2)]:
        actual = sum(p.parent == root / folder for p in files)
        if actual != count:
            shared_issues.append(f'{folder}应为{count}张，实际{actual}张；请移除多余版本或补齐')

    def image(folder, stem, issues):
        matches = by_stem.get((folder, stem), [])
        if len(matches) != 1:
            issues.append(('缺少图片：' if not matches else '图片编号重复：') + folder + '/' + stem)
            return []
        p = matches[0]
        if p not in cache:
            if not 0 < p.stat().st_size <= 16 * 1024 * 1024:
                issues.append('图片大小须为1字节至16MB：' + p.name)
            with p.open('rb') as f:
                head = f.read(24)
            valid = (p.suffix.lower() == '.png' and head.startswith(b'\x89PNG\r\n\x1a\n') or
                     p.suffix.lower() in ('.jpg', '.jpeg') and head.startswith(b'\xff\xd8\xff') or
                     p.suffix.lower() == '.webp' and head[:4] == b'RIFF' and head[8:12] == b'WEBP')
            if not valid:
                issues.append('图片格式与扩展名不一致或文件损坏：' + p.name)
            cache[p] = {'path': str(p), 'sha256': sha(p), 'bytes': p.stat().st_size}
        return [cache[p]]

    def versioned_image(folder, key, issues):
        if not v2:
            return image(folder, key, issues)
        matches = [p for (parent, stem), paths in by_stem.items()
                   if parent == folder and re.fullmatch(re.escape(key) + r'-R\d{2,}', stem)
                   for p in paths]
        if len(matches) != 1:
            issues.append(('缺少图片：' if not matches else '同一素材存在多个版本：') + folder + '/' + key)
            return []
        return image(folder, matches[0].stem, issues)

    shop_code = config.get('店铺识别码', '')
    def shared_stem(kind, group, number):
        if not v2:
            if kind == 'secondary': return f'副图-{group}{number:02}'
            if kind == 'cover': return f'首页-{number:02}'
            return f'详情-{number:02}'
        if kind == 'secondary': return f'{shop_code}-副图-{group}{number:02}'
        if kind == 'cover': return f'{shop_code}-详情页首页-{number}'
        return f'{shop_code}-详情页正文-{number:02}'
    sets = {g: [a for n in range(1, 5) for a in versioned_image('副图/' + g, shared_stem('secondary', g, n), shared_issues)] for g in ('A', 'B')}
    covers = [a for n in (1, 2) for a in versioned_image('详情首页', shared_stem('cover', '', n), shared_issues)]
    body_files = [p for p in files if p.parent.name == '详情正文']
    if not 7 <= len(body_files) <= 12:
        shared_issues.append('详情正文需7至12张，详情首页单独两张')
    body = [a for n in range(1, min(len(body_files), 12) + 1) for a in versioned_image('详情正文', shared_stem('body', '', n), shared_issues)]
    tasks, seen, orders = [], set(), set()
    for row, cells in product_rows[1:]:
        v = {header.get(c): cell['value'].strip() for c, cell in cells.items()}
        if not any(v.values()):
            continue
        if not v.get('序号', '').isdigit() or int(v['序号']) < 1:
            raise ValueError(f'商品清单第{row}行：序号必须为正整数')
        order = int(v['序号'])
        country, city = v.get('国家或地区', ''), v.get('城市', '')
        if v2 and v.get('链接类型', '') not in ('国家', '城市'):
            raise ValueError(f'商品清单第{row}行：链接类型必须填“国家”或“城市”')
        if v2 and ((v.get('链接类型') == '国家' and city) or (v.get('链接类型') == '城市' and not city)):
            raise ValueError(f'商品清单第{row}行：链接类型须与城市是否填写一致')
        if order in orders or (country, city) in seen:
            raise ValueError(f'商品清单第{row}行：序号或目的地重复，请核对后再导入')
        orders.add(order); seen.add((country, city))
        issues = list(shared_issues)
        if not country:
            issues.append('国家或地区未填写')
        titles = [v.get('标题一', ''), v.get('标题二', '')]
        if any(not x or sum(2 if ord(c) > 127 else 1 for c in x) > 60 for x in titles):
            issues.append('两版标题均需填写且不得超过60字符单位')
        choice = v.get('使用标题', '')
        if choice not in ('1', '2'):
            issues.append('使用标题必须填1或2')
        if any(c.get('formula') for c in cells.values()):
            issues.append('商品字段包含公式，请核对后粘贴为实际值')
        b = dict(business, price_cny=v.get('售价', ''), inventory=v.get('库存', ''))
        try:
            if not Decimal(b['price_cny']).is_finite() or Decimal(b['price_cny']) <= 0 or not b['inventory'].isdigit() or int(b['inventory']) <= 0:
                raise ValueError()
        except (ValueError, InvalidOperation):
            issues.append('售价和库存必须填写真实有效的正数，库存为整数')
        if v2:
            link_type = v['链接类型']
            main_stem = f'{shop_code}-{order:03}-{link_type}-{country}-' + (f'{city}-' if city else '') + '主图'
        else:
            main_stem = f'主图-{order:03}'
        main = versioned_image('主图', main_stem, issues)
        if any(known_destination_mismatch(a['sha256'], country, city or None) for a in main):
            issues.append('已知主图内容与目的地不一致，需人工核对')
        selected = int(choice) - 1 if choice in ('1', '2') else 0
        tasks.append({'schemaVersion': 2, 'shopId': shop_id, 'priority': order,
            'source': {'workbook': str(workbook), 'sha256': before, 'sheet': SPEC['productsSheet'], 'row': row},
            'listing': {'type': 'city' if city else 'country', 'country': country, 'city': city or None,
                'title': titles[selected], 'titleVersions': titles, 'selectedTitleIndex': selected, 'guideTitle': v.get('导购标题', '')},
            'business': b, 'assets': {'main': main, 'secondary': sets['A'], 'details': covers[:1] + body},
            'adapterIssues': list(dict.fromkeys(issues)), 'contentReviewRequired': True})
    if not tasks:
        raise ValueError('模板尚未填写商品。请在商品清单第2行起填写真实资料')
    if sha(workbook) != before:
        raise ValueError('识别期间Excel发生变化，请保存后重新导入')
    tasks.sort(key=lambda t: t['priority'])
    return {'sourceHash': before, 'sourceReadonly': True, 'workbook': str(workbook), 'poolWorkbook': str(workbook),
        'poolHash': before, 'sheet': '境外城市热度', 'assetRoot': str(root), 'tasks': tasks,
        'summary': {'total': len(tasks), 'blocked': sum(bool(t['adapterIssues']) for t in tasks), 'images': len(files),
            'main': sum(p.parent.name == '主图' for p in files), 'secondary': sum(p.parent.name in ('A', 'B') for p in files),
            'covers': len(covers), 'details': len(body_files)},
        'format': f"travel-os-template-v{spec['version']}",
        'templateMaterials': {'secondary': sets, 'covers': covers}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True); parser.add_argument('--shop-id', required=True); parser.add_argument('--shop-name', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.root, args.shop_id, args.shop_name), ensure_ascii=False))
    except Exception as e:
        print(str(e), file=sys.stderr); sys.exit(1)
