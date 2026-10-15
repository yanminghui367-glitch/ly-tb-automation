# 五洲畅游长期默认发布规则｜2026-10-14

后续用户已明确将该偏好提升为网站所有店铺长期默认，正式配置已加载；现行范围见 [网站默认发布规则](WEBSITE_LISTING_DEFAULT_20261014.md)。下文保留本次单店保存时的范围与验证记录。

用户明确要求把“按导入清单执行，店内其他同目的地商品不阻止上架”设为店铺长期默认。该默认只绑定 `wuzhou-changyou / 五洲畅游`，其他店铺不继承。本系统已完成商品、已知原商品ID、提交结果不明、资料审核、登录身份和平台验证保护保持。

## 保存和新清单继承

默认规则保存在本地业务配置 `workbench/.runtime/product-v1/settings.json` 的 `shopListingDefaults.wuzhou-changyou`，包含布尔值 `ignoreExternalDestinationProducts=true`、revision=1、用户确认时间和来源。运行接口通过 `settings.listingDefaults` 返回当前店铺的有效规则。普通资料路径/批次设置更新不会删除它；读取时校验店铺、类型、版本和时间，损坏配置不能静默成为其他规则。

`ProductApi` 为原 `ListingRound` 提供读取当前店铺默认值的方法。以后新导入并创建固定清单时，创建函数在原事务中把默认值冻结为该清单的 `ignore-destination-duplicates` 规则，绑定新round、shop、manifest，并记录 `SHOP_DEFAULT_POLICY_INHERITED` 事件及继承的店铺规则版本。规则和清单原始授权分别记录，不能由默认值补齐发布授权。

已建立的原清单继续使用自己的冻结规则，修改店铺默认不会倒改历史或现有任务。新清单仍须走原导入、授权、资料和执行检查；保存默认不会启用执行开关、创建新任务或开始发布。配置保存属于可逆本地偏好，不作为内核发布放行；真正的创建/开始/恢复入口仍检查冻结内核。

## 验证和实际保存

当前执行者自验：产品API、轮次创建及核验相关78项回归通过（并行代码在修改，冻结一致性单项未纳入该次回归）；新增默认规则6项在最后配置保存实现上复验通过，覆盖重启读取、路径设置保留、店铺隔离、新导入自动继承、现有清单不倒改、缺少授权不放行、客户端不能伪造继承、配置损坏以及内核失败仍禁止执行。两个修改文件语法检查通过。隔离测试不是平台发布证据。

同目录有其他聊天正在修改页面数量限制、素材适配器、轮次/选择接口及界面。仅更新本任务已检查的 `product-api.mjs` 和 `listing-round.mjs` 冻结哈希，保留并行代码和它们的版本记录，没有替尚未核对的文件放行，也没有重启服务。

实际服务PID4464已经读取新增默认配置字段。本次通过同一 `ProductApi.saveSettings` 的配置方法保存规则：仅复用配置方法、不构造ProductApi/执行器、不启动浏览器、不进行轮次恢复；读业务SQLite时使用只读连接，并核对原执行器空闲。原业务配置已备份至 `workbench/.runtime/maintenance/shop-listing-default-20261014-before.json`。执行开关、资料路径、批次大小、现有清单manifest和状态保持。

22:47保存成功后，正式 `/api/v1/state` 已返回：shopId=wuzhou-changyou、ignoreExternalDestinationProducts=true、revision=1，确认时间 `2026-10-14T14:47:02.083Z`。然后将实际保存的默认配置复制到隔离配置目录，创建两条明确标记为样例的新导入清单，确认自动继承revision1、READY/inactive、源run数0、其他店铺默认仍为false；正式商品状态库未用于该样例创建。

证据位于 `output/shop-listing-default-20261014/`：`saved-default.json`、`inherited-saved-config.json`、`default-final-tests.log`、`regression.log`，以及可核对的保存/验证脚本。版本前置清单保存在 `docs/kernel-baselines/20261014-before-shop-listing-default.json` 和 `20261014-before-shop-default-save.json`。

保存时仍有其他并行内核文件未完成冻结核对，因此没有创建新的正式清单、恢复原商品或发布；该状态不影响本地默认配置持久保存。后续执行仍需原内核、资料与范围检查通过。
