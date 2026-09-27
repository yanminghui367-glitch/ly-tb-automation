import hashlib
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from xml.sax.saxutils import escape
from pool_adapter import prepare, known_destination_mismatch


class PoolAdapterTest(unittest.TestCase):
    def test_wrong_content_is_scoped_to_destination_and_not_permanent_row_block(self):
        h = 'cec5d55c88cad331a3ccf8025bbcd019c00f79ab364caa44b7d9cb0300c23f6f'
        self.assertTrue(known_destination_mismatch(h, '英国', '伦敦'))
        self.assertTrue(known_destination_mismatch(h, '法属波利尼西亚', None))
        self.assertFalse(known_destination_mismatch(h, '圣皮埃尔和密克隆群岛', None))
        self.assertFalse(known_destination_mismatch('replacement', '英国', '伦敦'))

    def fixture(self, root, formula=False):
        workbook = root / 'source.xlsx'
        cells = {'A': '1', 'B': '国家链接', 'C': '英国', 'H': '个性定制/设计服务/DIY>>其它定制>>其它商品定制',
                 'I': '英国旅行服务', 'J': '英国旅行', 'K': '无品牌/无注册商标', 'L': '是', 'M': '中国内地（大陆）',
                 'N': '20', 'O': '999999', 'P': '立刻上架', 'R': '24小时内发货', 'S': '大陆及港澳台', 'T': '北京/北京', 'U': '旅游', 'V': '不设置商品维度区域限售模板'}
        ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        body = ''.join(f'<c r="{k}5" t="inlineStr">' + ('<f>1+1</f>' if formula and k == 'N' else '') + f'<is><t>{escape(v)}</t></is></c>' for k, v in cells.items())
        with ZipFile(workbook, 'w') as z:
            z.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" r:id="r1"/><sheet name="城市池500" r:id="r2"/></sheets></workbook>')
            z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/s1.xml"/><Relationship Id="r2" Target="worksheets/s2.xml"/></Relationships>')
            z.writestr('xl/worksheets/s1.xml', f'<worksheet xmlns="{ns}"><sheetData><row r="5">{body}</row></sheetData></worksheet>')
            z.writestr('xl/worksheets/s2.xml', f'<worksheet xmlns="{ns}"><sheetData/></worksheet>')
        return workbook

    def test_source_is_unchanged_and_missing_images_are_not_ready(self):
        with tempfile.TemporaryDirectory(prefix='ly-pool-test-') as temp:
            root = Path(temp)
            workbook = self.fixture(root)
            before = hashlib.sha256(workbook.read_bytes()).hexdigest()
            result = prepare(workbook, root)
            self.assertEqual(before, hashlib.sha256(workbook.read_bytes()).hexdigest())
            self.assertEqual(result['tasks'][0]['source']['row'], 5)
            self.assertEqual(result['tasks'][0]['source']['cells']['N'], 'N5')
            self.assertEqual(result['tasks'][0]['business']['price_cny'], '20')
            self.assertEqual(len(result['tasks'][0]['adapterIssues']), 13)

    def test_formula_is_not_silently_used_as_verified_business_input(self):
        with tempfile.TemporaryDirectory(prefix='ly-pool-test-') as temp:
            root = Path(temp)
            result = prepare(self.fixture(root, formula=True), root)
            self.assertIn('关键字段包含公式，需核对缓存值', result['tasks'][0]['adapterIssues'])


if __name__ == '__main__':
    unittest.main()
