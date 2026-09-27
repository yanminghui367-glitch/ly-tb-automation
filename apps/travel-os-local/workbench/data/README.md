# 地球展示坐标（2026-09-23）

只用于工作台导航，独立于商品包、价格、任务与上架状态。WGS84；国家使用示意位置，城市使用中心点，不是服务地址、行政边界或供给范围。

本次 700 条目录包含 200 条国家/地区商品和 500 条城市商品。已匹配 699 条；美国堪萨斯城在 KS/MO 两州有相邻同名城市，用户于本轮明确选择“暂不确定，保留待确认”，不落点、不用国家中心替代。仍可搜索和查看原资料。

## 来源与规则

- 城市：[GeoNames cities15000](https://download.geonames.org/export/dump/cities15000.zip)，[CC BY 4.0](https://www.geonames.org/export/)。每条保留 GeoNames ID 和原页面地址。中文仅做 OpenCC 繁简归一与标点、重音规范化；限定相同国家代码。
- 国家：[mledoze/countries](https://github.com/mledoze/countries)，ODbL-1.0。使用公开 latlng 示意坐标，国家名/地区名沿用商品目录，无行政边界展示。
- 同名消歧：读取原热度表中**当前导入任务对应行**的英文名、主要服务机场；不能跨行按同名覆盖。英文准确匹配仍无法区分时，与 [OpenFlights 机场坐标](https://openflights.org/data.php)比对，最近候选须距机场小于 200 km，且与第二候选的距离差超过 50 km。24 条采用这一**导航推断**，每条保留源行、机场、距离及 inferred 标记；页面点击后明确提示。机场数据并不用于提供航班或机场营业信息。
- 仍有多个候选则不给坐标。堪萨斯城因两候选相邻未通过消歧，保留用户确认记录。
- 本派生坐标集合按 ODbL-1.0 提供；保留 GeoNames 的 CC BY 4.0 署名和 OpenFlights ODbL/DbCL 来源声明。此声明只适用于公开地理数据，不扩展到业务资料、代码或用户图片。

## 复现与边界

`tools/build-globe-coordinates.mjs` 使用 `output/globe-20260923/` 内只读整理的 locations.json、heat-rows.json 和下载的 countries-mledoze.json、geonames/cities15000.txt、airports.json 重建本文件夹中的坐标索引。源热度工作簿通过 ZIP/XML 只读解析；原文件未改。运行页面不需要这些中间文件或 OpenCC，不发外部地理编码请求。

新导入的目的地仅以当前商品标识关联索引；没有可靠匹配的新增条目进入“位置待确认”，不会猜坐标。修改此索引只影响地球展示，不影响任何发布规则。
