"""Synthetic test data only. Fill a copy of the shipped template; no platform facts."""
from pathlib import Path
from zipfile import ZipFile
import argparse
import base64
import json
import xml.etree.ElementTree as ET

def make(root, count=2):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    base=Path(__file__).resolve().parents[1]
    spec=json.loads((base/'setup-template.json').read_text(encoding='utf-8'))
    with ZipFile(base/'templates/travel-os-template-v1.zip') as z:
        workbook=z.read('星途资料模板/商品资料.xlsx')
    import io
    ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    def sheet(rows):
        node=ET.Element('{'+ns+'}worksheet'); data=ET.SubElement(node,'{'+ns+'}sheetData')
        for number,values in enumerate(rows,1):
            row=ET.SubElement(data,'{'+ns+'}row',r=str(number))
            for index,value in enumerate(values):
                c=ET.SubElement(row,'{'+ns+'}c',r=chr(65+index)+str(number),t='inlineStr')
                ET.SubElement(ET.SubElement(c,'{'+ns+'}is'),'{'+ns+'}t').text=str(value)
        return ET.tostring(node,encoding='utf-8',xml_declaration=True)
    config=['五洲畅游','个性定制/设计服务/DIY / 其它定制 / 其它商品定制','无品牌/无注册商标','是','中国内地（大陆）','放入仓库','24小时内发货','大陆及港澳台','北京/北京','隔离测试运费模板','不设置商品维度区域限售模板']
    products=[spec['columns']]+[[n,'隔离测试国家','隔离测试城市'+str(n),'隔离测试标题一'+str(n),'隔离测试标题二'+str(n),'1','仅用于测试','20','10'] for n in range(1,count+1)]
    # Workbook relationships are retained from the artifact-tool generated template.
    with ZipFile(io.BytesIO(workbook)) as original,ZipFile(root/'商品资料.xlsx','w') as out:
        for item in original.infolist():
            content=original.read(item.filename)
            if item.filename=='xl/worksheets/sheet1.xml':content=sheet(products)
            if item.filename=='xl/worksheets/sheet2.xml':content=sheet([['设置项','真实资料（请填写）']]+list(zip(spec['settings'],config)))
            out.writestr(item,content)
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=')
    for folder in spec['folders']:(root/folder).mkdir(parents=True,exist_ok=True)
    names=[('主图',f'主图-{n:03}.png') for n in range(1,count+1)]
    names += [('副图/'+g,f'副图-{g}{n:02}.png') for g in ('A','B') for n in range(1,5)]
    names += [('详情首页',f'首页-{n:02}.png') for n in (1,2)]
    names += [('详情正文',f'详情-{n:02}.png') for n in range(1,8)]
    for folder,name in names:(root/folder/name).write_bytes(png)
    return root

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root');p.add_argument('--count',type=int,default=2);a=p.parse_args();make(a.root,a.count)
