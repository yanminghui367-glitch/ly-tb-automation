"""Read-only adapter for the supplied destination pool, independent of browser code."""
import argparse
import json
import re
import struct
from pathlib import Path
from adapter import read_sheet, sha


def known_destination_mismatch(image_hash, country, city):
    # Content of these two files has been visually inspected, not inferred from names.
    if image_hash == 'cec5d55c88cad331a3ccf8025bbcd019c00f79ab364caa44b7d9cb0300c23f6f':
        return city is not None or country not in {'圣皮埃尔和密克隆', '圣皮埃尔和密克隆群岛'}
    if image_hash == '03c61e32e18abcf40a998dd05d38d79d6bae0c30cb9984afe2982f36833fdb8c':
        return (country, city) != ('德国', '柏林')
    return False


def prepare(workbook, root):
    workbook, root = Path(workbook).resolve(), Path(root).resolve()
    before = sha(workbook)
    files = sorted(p for p in root.rglob('*') if p.is_file() and p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'})
    names = {}
    for p in files:
        names.setdefault(p.name, []).append(p)
    cache = {}

    def asset(p):
        if p not in cache:
            with p.open('rb') as f:
                head = f.read(24)
            cache[p] = {'path': str(p), 'sha256': sha(p), 'bytes': p.stat().st_size,
                        'dimensions': list(struct.unpack('>II', head[16:24])) if head[:8] == b'\x89PNG\r\n\x1a\n' else None}
        return cache[p]

    def named(name, issues):
        matches = names.get(name, [])
        if len(matches) != 1:
            issues.append(('缺少图片：' if not matches else '同名图片不唯一：') + name)
            return []
        return [asset(matches[0])]

    cities = {}
    # Retain the already prepared alternate title, but always select Sheet1 I.
    # Never invent a second title or replace the user's selected spreadsheet title.
    alternatives = {}
    package_root = Path(__file__).resolve().parents[2] / 'output/batch-004-new-desktop-images-700'
    for package in package_root.glob('*.json'):
        data = json.loads(package.read_text(encoding='utf-8-sig'))
        listing = data.get('listing', {})
        key = (listing.get('location_type'), listing.get('country'), listing.get('city') or '')
        alternatives.setdefault(key, []).append((package, listing.get('title')))
    for row, cells in read_sheet(workbook, '城市池500'):
        v = {k: c['value'].strip() for k, c in cells.items()}
        if v.get('A', '').isdigit() and v.get('D'):
            cities[int(v['A']) + 200] = v
    tasks = []
    for row, cells in read_sheet(workbook, 'Sheet1'):
        v = {k: c['value'].strip() for k, c in cells.items()}
        if not v.get('A', '').isdigit() or v.get('B') not in {'国家链接', '国家-城市链接'}:
            continue
        order, country = int(v['A']), v.get('C', '')
        kind = 'country' if v['B'] == '国家链接' else 'city'
        city = cities.get(order, {}).get('D') if kind == 'city' else None
        issues = []
        if kind == 'city' and (not city or cities[order].get('B') != country):
            issues.append('城市与国家关联不一致')
        stem = f'{order:03d}-国家-{country}' if kind == 'country' else f'{order:03d}-城市-{city}-{country}'
        # Explicit spelling aliases already found in this source bundle.
        if order == 643 and city == '戴德姆':
            stem = stem.replace('戴德姆', '德德姆')
        if order == 645 and city == '大田广域市':
            stem = stem.replace('大田广域市', '大田')
        main = named(stem + '.png', issues)
        secondary = []
        for name in ['副图-B01-旅行服务.png', '副图-B02-1对1服务.png', '副图-B03-24小时服务.png', '副图-B04-服务流程.png']:
            secondary += named(name, issues)
        details = []
        for name in ['详情页-01-首页-旅行服务咨询.png', '详情页-03-服务内容.png', '详情页-04-品质服务.png', '详情页-05-1对1服务.png', '详情页-06-24小时服务.png', '详情页-07-安心出行.png', '详情页-08-服务流程.png', '详情页-09-下单前请提供.png']:
            details += named(name, issues)
        if any(known_destination_mismatch(a['sha256'], country, city) for a in main):
            issues.append('已发现主图内容与目的地不一致，需更换并复核')
        title = v.get('I', '')
        versions = [title]
        previous = alternatives.get((kind, country, city or ''), [])
        alternate_source = None
        if len(previous) == 1 and previous[0][1] and previous[0][1] != title:
            versions.append(previous[0][1])
            alternate_source = {'path': str(previous[0][0]), 'sha256': sha(previous[0][0])}
        if not title or sum(2 if ord(c) > 127 else 1 for c in title) > 60:
            issues.append('标题为空或超过当前类目长度限制')
        if any(cells.get(k, {}).get('formula') for k in 'ABCIJKLM NOPRSTUV'.replace(' ', '')):
            issues.append('关键字段包含公式，需核对缓存值')
        business = {'shop_name': '五洲畅游', 'category_path': v.get('H'), 'brand': v.get('K'), 'custom_service': v.get('L') == '是',
                    'procurement': v.get('M'), 'price_cny': v.get('N'), 'inventory': v.get('O'), 'listing_time': v.get('P'),
                    'shipping_time': v.get('R'), 'ship_from_region': v.get('S'), 'ship_from': v.get('T'),
                    'freight_template': v.get('U'), 'region_restriction': v.get('V')}
        try:
            if float(business['price_cny']) <= 0 or int(business['inventory']) <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            issues.append('价格或库存无有效值')
        for key in ['category_path', 'brand', 'procurement', 'shipping_time', 'ship_from_region', 'ship_from', 'freight_template', 'listing_time']:
            if not business[key]:
                issues.append('缺少字段：' + key)
        tasks.append({'schemaVersion': 2, 'shopId': 'wuzhou-changyou', 'priority': order,
                      'source': {'workbook': str(workbook), 'sha256': before, 'sheet': 'Sheet1', 'row': row,
                                 'cells': {k: c['cell'] for k, c in cells.items()}},
                      'listing': {'type': kind, 'country': country, 'city': city, 'title': title,
                                  'titleVersions': versions, 'alternateTitleSource': alternate_source, 'selectedTitleIndex': 0, 'guideTitle': v.get('J', '')},
                      'business': business, 'assets': {'main': main, 'secondary': secondary, 'details': details},
                      'adapterIssues': issues, 'contentReviewRequired': True})
    tasks.sort(key=lambda t: t['priority'])
    if not tasks or len({t['priority'] for t in tasks}) != len(tasks):
        raise ValueError('未识别到有效商品，或序号重复')
    if len({(t['listing']['country'], t['listing']['city']) for t in tasks}) != len(tasks):
        raise ValueError('表内目的地重复')
    if before != sha(workbook):
        raise ValueError('识别期间源表已变更，请重新识别')
    return {'sourceHash': before, 'sourceReadonly': True, 'workbook': str(workbook), 'assetRoot': str(root), 'tasks': tasks,
            'summary': {'total': len(tasks), 'images': len(files), 'blocked': sum(bool(t['adapterIssues']) for t in tasks)}}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--workbook', required=True)
    p.add_argument('--assets', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    result = prepare(args.workbook, args.assets)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(result['summary'], ensure_ascii=False))
