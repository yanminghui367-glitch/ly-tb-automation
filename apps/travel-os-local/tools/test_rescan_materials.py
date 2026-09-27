import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from rescan_materials import scan


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.file = self.root / 'main.png'
        self.file.write_bytes(b'fixture-image')
        self.book = self.root / 'data.xlsx'
        self.book.write_bytes(b'fixture-sheet')
        asset = {'path': str(self.file), 'sha256': hashlib.sha256(b'fixture-image').hexdigest()}
        self.payload = {'settings': {'assets': str(self.root), 'pool': str(self.book), 'heat': str(self.book), 'sheet': 'test'}, 'targets': [{'product': {'key': 'p', 'destination': '测试城', 'country': '测试国', 'city': '测试城', 'issues': ['热度表国家城市重复'], 'source': {}}, 'task': {'assets': {'main': [asset], 'secondary': [asset] * 4, 'details': [asset]}}}]}
        self.rows = [(1, {'A': {'value': '国家/地区'}, 'B': {'value': '城市名称'}, 'C': {'value': '热度排名'}}), (2, {'A': {'value': '测试国'}, 'B': {'value': '测试城'}, 'C': {'value': '1'}})]

    def result(self, payload=None):
        with patch('rescan_materials.read_sheet', return_value=self.rows):
            return scan(payload or self.payload)

    def test_existing_file_is_not_automatically_approved(self):
        result = self.result()
        self.assertEqual(result['summary']['RECHECK'], 1)
        self.assertEqual(self.file.read_bytes(), b'fixture-image')
        self.assertEqual(self.book.read_bytes(), b'fixture-sheet')

    def test_missing_file(self):
        self.payload['targets'][0]['task']['assets']['main'][0]['path'] = str(self.root / 'missing.png')
        self.assertEqual(self.result()['summary']['MISSING'], 1)

    def test_found_elsewhere_is_unlinked_not_missing(self):
        self.payload['targets'][0]['task']['assets']['main'][0]['path'] = str(self.root / 'old/main.png')
        result = self.result()
        self.assertEqual(result['summary']['UNLINKED'], 1)
        self.assertEqual(result['summary']['MISSING'], 0)

    def test_duplicate_rows_remain_ambiguous(self):
        self.rows.append((8, {'A': {'value': '测试国'}, 'B': {'value': '测试城'}, 'C': {'value': '7'}}))
        result = self.result()
        self.assertEqual(result['summary']['AMBIGUOUS'], 1)
        finding = next(f for f in result['results'][0]['findings'] if f['code'] == 'AMBIGUOUS')
        self.assertEqual([r['row'] for r in finding['rows']], [2, 8])

    def test_changed_file_and_known_bad_content_are_separate(self):
        self.file.write_bytes(b'changed-image')
        with patch('rescan_materials.known_destination_mismatch', return_value=True):
            result = self.result()
        self.assertEqual(result['summary']['CHANGED'], 1)
        self.assertEqual(result['summary']['CONTENT'], 1)

    def test_unreadable_root_does_not_claim_absence(self):
        self.payload['settings']['assets'] = str(self.root / 'unavailable')
        self.file.unlink()
        result = self.result()
        self.assertEqual(result['summary']['MISSING'], 0)
        self.assertEqual(result['summary']['UNCHECKED'], 1)

    def test_missing_source_snapshot(self):
        self.payload['targets'][0]['task'] = None
        self.assertEqual(self.result()['summary']['UNLINKED'], 1)


if __name__ == '__main__':
    unittest.main()
