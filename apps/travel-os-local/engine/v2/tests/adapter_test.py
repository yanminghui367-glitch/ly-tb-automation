import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from adapter import prepare, read_sheet


class AdapterTests(unittest.TestCase):
    def make(self, directory):
        p = Path(directory) / "source.xlsx"
        cells = lambda r, vals: '<row r="%d">%s</row>' % (r, ''.join('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (col, r, v) for col, v in vals.items()))
        with ZipFile(p, "w") as z:
            z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="境外城市热度" r:id="rId1"/></sheets></workbook>')
            z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>')
            z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
                       cells(5, {"A": "境外热度排名", "D": "国家/地区(中文)", "G": "城市中文名", "J": "链接标题", "K": "导购标题"}) +
                       cells(9, {"A": "2", "D": "甲国", "G": "甲城", "J": "甲城咨询", "K": "不是第二商品标题"}) +
                       cells(12, {"A": "1", "D": "乙国", "G": "乙城", "J": "乙城咨询"}) +
                       cells(20, {"A": "3", "D": "丙国", "G": "丙城"}) + '</sheetData></worksheet>')
        return p

    def test_physical_rows_exact_sheet_provenance_and_source_readonly(self):
        with tempfile.TemporaryDirectory() as d:
            p = self.make(d)
            before = hashlib.sha256(p.read_bytes()).hexdigest()
            output = prepare(p, "境外城市热度", d, "test")
            self.assertEqual([t["source"]["row"] for t in output["tasks"]], [12, 9])
            self.assertEqual(output["tasks"][1]["source"]["cells"]["title"], "J9")
            self.assertEqual(output["tasks"][1]["listing"]["titleVersions"], ["甲城咨询"])
            self.assertEqual(output["selection"]["excludedWithoutTitle"], 1)
            self.assertEqual(before, hashlib.sha256(p.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, "Sheet missing"):
                list(read_sheet(p, "错误表名"))

    def test_ambiguous_main_is_blocked_not_arbitrarily_selected(self):
        with tempfile.TemporaryDirectory() as d:
            p = self.make(d)
            for name in ["001-城市-甲城.png", "002-城市-甲城.png"]:
                (Path(d) / name).write_bytes(b"test")
            output = prepare(p, "境外城市热度", d, "test")
            self.assertIn("MAIN_IMAGE_AMBIGUOUS", output["tasks"][1]["adapterIssues"])
            self.assertEqual(output["tasks"][1]["assets"]["main"], [])


if __name__ == "__main__":
    unittest.main()
