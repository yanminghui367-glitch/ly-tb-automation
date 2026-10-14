import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {fixture} from './setup-fixture.mjs';

test('standard import recognizes the current exact 24-hour shipping option', async t => {
  const x = await fixture(t);
  const root = join(x.dir, 'source-current-shipping-label');
  execFileSync('python', [resolve('scripts/setup-fixture.py'), root, '--count', '2', '--version', '2'], {windowsHide: true});
  const patchWorkbook = [
    'from pathlib import Path',
    'from zipfile import ZipFile',
    'import os,sys',
    'p=Path(sys.argv[1]); tmp=p.with_suffix(".tmp")',
    'with ZipFile(p) as src, ZipFile(tmp,"w") as dst:',
    ' for item in src.infolist():',
    '  data=src.read(item.filename)',
    '  if item.filename=="xl/worksheets/sheet2.xml":',
    '   old="24小时内发货".encode(); new="按商品统一设置-24小时内发货".encode()',
    '   assert old in data',
    '   data=data.replace(old,new)',
    '  dst.writestr(item,data)',
    'os.replace(tmp,p)',
  ].join('\n');
  execFileSync('python', ['-c', patchWorkbook, join(root, '商品资料.xlsx')], {windowsHide: true});

  const result = await x.p.setup.importSource({format: 'standard', root});
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.blocked, 0);
  assert.equal(x.store.batch(result.importId).tasks[0].business.shipping_time, '24小时内发货');
  assert.equal((await x.p.settings()).executionEnabled, false);
});
