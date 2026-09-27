"""Join read-only heat ranking to the user-approved listing pool by country/city."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
from adapter import read_sheet, sha, ALIASES
from pool_adapter import prepare as prepare_pool

# Visually checked 2026-09-21: source filenames 203/204/205 are shifted.
# Match immutable content hashes; never rename or modify the user's images.
VERIFIED_MAIN = {
    ('日本', '东京'): '272418ab209729f8b2993510f3d85a9f234d97375d8941a5caeda4991d7e20a4',
    ('西班牙', '马德里'): 'cc73518d32103771fb0882e82e9bd83d1b99923fb49801f653624cbc907c68bb',
    ('德国', '柏林'): '03c61e32e18abcf40a998dd05d38d79d6bae0c30cb9984afe2982f36833fdb8c',
}


def remap_verified_main(task, packages):
    expected = VERIFIED_MAIN.get((task['listing']['country'], task['listing']['city']))
    if not expected:
        return
    matches = {a['path']: a for p in packages for a in p.get('assets', {}).get('main', []) if a['sha256'] == expected}
    if len(matches) != 1:
        task['adapterIssues'].append('已核验的目的地主图缺失或不唯一')
        return
    previous = copy.deepcopy(task['assets']['main'])
    task['assets']['main'] = [copy.deepcopy(next(iter(matches.values()))) ]
    task['assetMappingReview'] = {'at': '2026-09-21', 'method': 'visual destination plus sha256', 'original': previous, 'selectedHash': expected}
    task['adapterIssues'] = [x for x in task['adapterIssues'] if x != '已发现主图内容与目的地不一致，需更换并复核']


def prepare(heat, sheet, pool, assets):
    heat = Path(heat).resolve()
    before = sha(heat)
    packages = prepare_pool(pool, assets)
    index = {(t['listing']['country'], t['listing']['city']): t for t in packages['tasks'] if t['listing']['type'] == 'city'}
    tasks, missing, seen = [], [], set()
    header = None
    for row, cells in read_sheet(heat, sheet):
        if header is None:
            candidate = {key: next((col for col, cell in cells.items() if cell['value'] in aliases), None) for key, aliases in ALIASES.items()}
            if all(candidate.get(key) for key in ('rank', 'country', 'city')):
                header = candidate
            continue
        def value(key):
            return cells.get(header.get(key), {}).get('value', '').strip()
        if not value('rank').isdigit() or not value('city'):
            continue
        country, city, rank = value('country'), value('city'), int(value('rank'))
        match = index.get((country, city))
        if not match:
            missing.append({'rank': rank, 'row': row, 'country': country, 'city': city, 'reason': '商品表缺少精确国家城市映射'})
            continue
        task = copy.deepcopy(match)
        remap_verified_main(task, packages['tasks'])
        task['sourceReferences'] = [task['source']]
        task['source'] = {'workbook': str(heat), 'sha256': before, 'sheet': sheet, 'row': row,
                          'cells': {k: cells[c]['cell'] for k, c in header.items() if c and c in cells}}
        task['poolOrder'], task['priority'] = task['priority'], rank
        if value('title'):
            task['listing']['title'] = value('title')
            task['listing']['titleVersions'] = list(dict.fromkeys([value('title')] + task['listing']['titleVersions']))
            task['listing']['selectedTitleIndex'] = 0
        if any(cells.get(header.get(k), {}).get('formula') for k in ('rank', 'country', 'city', 'title')):
            task['adapterIssues'].append('热度表关键字段含公式，需核验')
        if (country, city) in seen:
            task['adapterIssues'].append('热度表国家城市重复')
        seen.add((country, city))
        identity = json.dumps([task['shopId'], 'city', country, city], ensure_ascii=False, separators=(',', ':'))
        task['taskId'] = 'task-' + hashlib.sha256(identity.encode()).hexdigest()[:24]
        tasks.append(task)
    if header is None or not tasks:
        raise ValueError('未识别到可关联的热度城市资料')
    if sha(heat) != before or sha(pool) != packages['sourceHash']:
        raise ValueError('读取期间源表发生变化')
    tasks.sort(key=lambda t: (t['priority'], t['source']['row']))
    return {'sourceHash': before, 'sourceReadonly': True, 'workbook': str(heat), 'sheet': sheet,
            'assetRoot': packages['assetRoot'], 'poolWorkbook': packages['workbook'], 'poolHash': packages['sourceHash'],
            'tasks': tasks, 'unmapped': missing,
            'summary': {'total': len(tasks), 'heatRows': len(tasks) + len(missing), 'unmapped': len(missing),
                        'blocked': sum(bool(t['adapterIssues']) for t in tasks), 'images': packages['summary']['images']}}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    for arg in ('heat', 'pool', 'assets', 'output'):
        p.add_argument('--' + arg, required=True)
    p.add_argument('--sheet', default='境外城市热度')
    a = p.parse_args()
    data = prepare(a.heat, a.sheet, a.pool, a.assets)
    Path(a.output).write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(data['summary'], ensure_ascii=False))
