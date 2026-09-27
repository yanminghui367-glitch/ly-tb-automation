"""Read-only diagnostics. Never imports, fixes, approves or publishes a product."""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine' / 'v2'))
from adapter import read_sheet, sha, ALIASES
from pool_adapter import known_destination_mismatch


def scan(payload):
    settings, targets = payload['settings'], payload['targets']
    root = Path(settings['assets']).resolve()
    warnings, names, images = [], defaultdict(list), []
    if not root.is_dir():
        warnings.append('配置的素材目录无法读取，不能据此判定素材空缺。')
    else:
        def walk_error(error):
            warnings.append('部分素材目录无法读取：' + str(error.filename))
        for folder, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
            dirs[:] = [d for d in dirs if not Path(folder, d).is_symlink() and not os.path.isjunction(Path(folder, d))]
            for name in files:
                path = Path(folder, name)
                if path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} or path.is_symlink():
                    continue
                images.append(path)
                names[name].append(path)

    heat, documents, sheet_cache, hashes = defaultdict(list), [], {}, {}
    def digest(path):
        path = str(path)
        if path not in hashes:
            hashes[path] = sha(path)
        return hashes[path]

    for label, path in [('商品表', settings['pool']), ('热度表', settings['heat'])]:
        try:
            documents.append({'label': label, 'path': path, 'readable': True, 'sha256': digest(path)})
        except (OSError, ValueError) as e:
            documents.append({'label': label, 'path': path, 'readable': False})
            warnings.append(label + '无法读取：' + str(e))
    try:
        header, descriptions = None, {}
        for row, cells in read_sheet(settings['heat'], settings['sheet']):
            if header is None:
                header = {key: next((c for c, v in cells.items() if v['value'] in ALIASES[key]), None) for key in ['country', 'city', 'rank']}
                if not all(header.values()):
                    header = None
                else:
                    descriptions = {col: cell['value'] for col, cell in cells.items() if any(word in cell['value'] for word in ['英文', '机场', '行政区', '经度', '纬度'])}
                continue
            value = lambda key: cells.get(header[key], {}).get('value', '').strip()
            if value('rank').isdigit() and value('city'):
                evidence = {name: cells.get(col, {}).get('value', '').strip() for col, name in descriptions.items()}
                heat[(value('country'), value('city'))].append({'row': row, 'rank': int(value('rank')), 'evidence': {k: v[:180] for k, v in evidence.items() if v}})
        if header is None:
            warnings.append('热度表字段未识别，无法核对重复对应关系。')
    except Exception as e:
        warnings.append('热度表读取失败：' + str(e))

    results = []
    for target in targets:
        product, task = target['product'], target.get('task')
        findings, files = [], []
        def add(code, message, **extra):
            findings.append({'code': code, 'message': message, **extra})
        if not task:
            add('UNLINKED', '原始导入商品无法对应，请核对来源后重新导入。')
        else:
            for group in ['main', 'secondary', 'details']:
                assets = task.get('assets', {}).get(group, [])
                if not assets:
                    add('UNLINKED', {'main': '主图', 'secondary': '副图', 'details': '详情页'}[group] + '未关联，需核对目录中的素材。')
                elif (group == 'main' and len(assets) != 1) or (group == 'secondary' and len(assets) != 4):
                    add('UNLINKED', '已关联素材数量异常：' + group + ' ' + str(len(assets)) + ' 张。')
                for asset in assets:
                    path = Path(asset['path'])
                    file = {'group': group, 'path': str(path), 'name': path.name, 'exists': path.is_file()}
                    files.append(file)
                    if not file['exists']:
                        matches = [str(p) for p in names.get(path.name, [])]
                        if matches:
                            add('UNLINKED', '原路径失效，但目录中找到同名文件：' + path.name, candidates=matches[:12])
                        elif warnings:
                            add('UNCHECKED', '原文件不可读且目录检查不完整，暂不能判为空缺：' + path.name)
                        else:
                            add('MISSING', '原路径及配置素材目录中均未找到此文件：' + path.name)
                        continue
                    try:
                        file['sha256'] = digest(path)
                        file['snapshotMatches'] = file['sha256'] == asset.get('sha256')
                        if asset.get('sha256') and not file['snapshotMatches']:
                            add('CHANGED', '文件与导入版本不同，需复核后重新导入：' + path.name)
                        if group == 'main' and known_destination_mismatch(file['sha256'], product['country'], product.get('city') or None):
                            add('CONTENT', '主图文件存在，但命中已人工核验的错图指纹；需要正确目的地主图。', path=str(path), sha256=file['sha256'])
                    except OSError:
                        add('UNCHECKED', '文件存在但无法读取：' + path.name)
            matches = heat.get((product['country'], product.get('city')), [])
            if product.get('city') and len(matches) > 1:
                add('AMBIGUOUS', '热度表中同国家/城市名称有 ' + str(len(matches)) + ' 行，需按地区或来源行确认对应关系。', rows=matches)
            if product.get('city') and not matches and not warnings:
                add('UNLINKED', '当前热度表没有精确国家/城市对应行。')
            # Look for alternatives by filename only. No claim about their visual correctness.
            main_paths = {f['path'] for f in files if f['group'] == 'main'}
            alternatives = [str(p) for p in images if product['destination'] in p.stem and str(p) not in main_paths]
            if alternatives:
                add('CANDIDATE', '找到含目的地名称的候选文件；仅按文件名检索，未核验画面。', candidates=alternatives[:12])
            unhandled = [x for x in product['issues'] if not any(word in x for word in ['主图内容与目的地不一致', '热度表国家城市重复', '缺少图片', '同名图片不唯一'])]
            for issue in unhandled:
                add('MANUAL', '原导入仍有需复核事项：' + issue)
            if not findings:
                add('RECHECK', '当前未复现文件或重复对应问题；须复核并重新导入，原资料状态不会自动放行。')
        results.append({'key': product['key'], 'destination': product['destination'], 'country': product['country'], 'source': product['source'], 'originalIssues': product['issues'], 'findings': findings, 'files': files})

    for document in documents:
        if document['readable']:
            try:
                if sha(document['path']) != document['sha256']:
                    warnings.append(document['label'] + '在检索期间发生变化，本次报告需重新检索核对。')
            except OSError:
                warnings.append(document['label'] + '在检索结束时无法读取，请重新检索。')
    summary = {code: sum(any(f['code'] == code for f in r['findings']) for r in results) for code in ['MISSING', 'UNLINKED', 'CONTENT', 'AMBIGUOUS', 'CHANGED', 'MANUAL', 'UNCHECKED', 'CANDIDATE', 'RECHECK']}
    return {'scope': '当前店铺全部待补资料商品；只读检索，不自动替换、重新导入或解除阻塞', 'assetRoot': str(root), 'scannedImages': len(images), 'documents': documents, 'warnings': warnings, 'total': len(results), 'summary': summary, 'results': results}


if __name__ == '__main__':
    try:
        print(json.dumps(scan(json.load(sys.stdin)), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': '检索失败：' + str(e)}, ensure_ascii=False))
        sys.exit(1)
