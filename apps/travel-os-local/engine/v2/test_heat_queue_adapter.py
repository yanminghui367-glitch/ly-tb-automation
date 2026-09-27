import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from heat_queue_adapter import prepare, remap_verified_main, VERIFIED_MAIN


class HeatQueueAdapterTest(unittest.TestCase):
    def test_reviewed_hash_remaps_copy_and_missing_hash_blocks(self):
        task = {'listing': {'country':'日本','city':'东京'}, 'assets':{'main':[{'path':'wrong','sha256':'wrong'}]},'adapterIssues':['已发现主图内容与目的地不一致，需更换并复核']}
        expected = VERIFIED_MAIN[('日本','东京')]
        packages = [{'assets':{'main':[{'path':'misnamed.png','sha256':expected}]}}]
        remap_verified_main(task, packages)
        self.assertEqual(task['assets']['main'][0]['path'],'misnamed.png')
        self.assertEqual(task['adapterIssues'],[])
        task['assets']['main'][0]['path']='changed-copy'
        self.assertEqual(packages[0]['assets']['main'][0]['path'],'misnamed.png')
        remap_verified_main(task, [])
        self.assertIn('已核验的目的地主图缺失或不唯一',task['adapterIssues'])
    def test_join_is_by_country_city_and_identity_survives_sort_change(self):
        with tempfile.TemporaryDirectory(prefix='ly-heat-') as tmp:
            root = Path(tmp)
            heat, pool = root/'heat.xlsx', root/'pool.xlsx'
            heat.write_bytes(b'readonly heat')
            pool.write_bytes(b'readonly business')
            before = heat.read_bytes()
            package = {'shopId':'wuzhou-changyou','priority':202,'source':{'workbook':str(pool),'sha256':hashlib.sha256(pool.read_bytes()).hexdigest()},'listing':{'type':'city','country':'墨西哥','city':'墨西哥城','title':'已确认标题','titleVersions':['已确认标题'],'guideTitle':'导购标题'},'adapterIssues':[]}
            prepared = {'sourceHash':package['source']['sha256'],'tasks':[package],'assetRoot':str(root),'workbook':str(pool),'summary':{'images':13}}
            def cells(values):return {k:{'value':v,'cell':k+'5','formula':False} for k,v in values.items()}
            header=cells({'A':'热度排名','D':'国家/地区','G':'城市名称'})
            data=[(5,header),(6,cells({'A':'2','D':'墨西哥','G':'墨西哥城'})),(7,cells({'A':'3','D':'美国','G':'墨西哥城'}))]
            with patch('heat_queue_adapter.prepare_pool',return_value=prepared),patch('heat_queue_adapter.read_sheet',return_value=data):
                first=prepare(heat,'境外城市热度',pool,root)
            self.assertEqual(first['summary']['unmapped'],1)
            self.assertEqual(first['tasks'][0]['listing']['title'],'已确认标题')
            self.assertEqual(first['tasks'][0]['sourceReferences'][0],package['source'])
            data[1][1]['A']['value']='99'
            with patch('heat_queue_adapter.prepare_pool',return_value=prepared),patch('heat_queue_adapter.read_sheet',return_value=data):
                second=prepare(heat,'境外城市热度',pool,root)
            self.assertEqual(first['tasks'][0]['taskId'],second['tasks'][0]['taskId'])
            self.assertEqual(heat.read_bytes(),before)
            self.assertEqual(package['priority'],202)


if __name__=='__main__': unittest.main()
