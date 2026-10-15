# 网站所有店铺长期默认发布规则｜2026-10-14

用户在单店长期默认规则完成后明确要求：“设为所有店铺长期默认规则，设置为网站长期默认规则”。本次把有效范围扩展为网站内所有现有及以后新增的店铺：按导入产品清单执行，店内其他同目的地商品不阻止上架。本系统已有成功记录、原商品ID、提交结果不明、资料、授权、店铺身份和验证码保护继续生效。

## 配置和继承

本地业务配置 `workbench/.runtime/product-v1/settings.json` 新增 `websiteListingDefaults`：scope=ALL_SHOPS、ignoreExternalDestinationProducts=true、revision=1、confirmedAt=`2026-10-14T15:27:55.610Z`、source=user-confirmed-website-default。该配置不绑定某个店铺，重启后持续读取。

网站规则优先于旧店铺偏好。旧 `shopListingDefaults` 原样保留以追溯历史，但不能覆盖网站规则；若以后修改这个发布偏好，需要明确使用网站范围。`settings.listingDefaults` 返回当前店铺ID及scope=WEBSITE_DEFAULT的有效值，`settings.websiteListingDefaults` 返回原网站配置。普通路径和批次数量更新会保留规则；类型、范围、版本或时间无效则报错，不能静默切换执行逻辑。

保存接口沿用 `POST /api/v1/settings`，输入为 `ignoreExternalDestinationProducts: true`、`listingDefaultsScope: WEBSITE_DEFAULT`、`confirmAllShops: true`。这些字段只保存用户已确认的默认偏好，不提供LIVE发布授权或启动任务。原执行检查及内核校验保留。

以后创建固定清单时，沿原事务追加绑定round/shop/manifest的 `ignore-destination-duplicates` 规则，记录 `WEBSITE_DEFAULT_POLICY_INHERITED`，并冻结所继承的网站版本及确认时间。已有清单和历史授权不倒改。本次原700条清单已经有用户确认的同目的地忽略规则，保持该历史策略即可继续符合用户要求。

网站目前列有8家店铺；本次配置覆盖这些店铺及以后新增店铺。它属于通用发布偏好，不补齐其他店铺尚未完成的执行适配、供给资料或登录。

## 验证及正式加载

本执行者自验：产品API、轮次创建及核验相关85项回归通过；最后13项默认规则定向复验通过。覆盖现有及新增店铺、旧店铺偏好不能覆盖网站规则、重启及普通设置保存、新清单继承及授权哈希、现有策略不倒改、损坏设置拒绝、缺少授权不放行，以及自身成功记录和提交结果不明保护。两个实现文件语法检查通过。并行修改中的冻结一致性单项未纳入该85项回归。

先确认执行器空闲，再使用只读SQLite备份原业务库、保存原设置，并复用 `ProductApi.saveSettings` 配置方法写入网站规则；该保存脚本不构造生产执行器、恢复器或浏览器。备份位于 `workbench/.runtime/maintenance/website-default-20261014/`，不进入源码基线。

仅将本任务已验证的 `product-api.mjs` 和 `listing-round.mjs` 哈希写入冻结清单，保留其他聊天的版本记录与文件。前置清单位于 `docs/kernel-baselines/20261014-before-website-listing-default.json`。通过原维护入口正常关闭并以原启动器加载，PID30272→8620，正式服务已返回有效scope=WEBSITE_DEFAULT。磁盘/加载版本为 `20261014-website-listing-default`。其他进行中的 `engine/v2/pool_adapter.py` 冻结差异继续阻止发布，未替其放行。

本机和局域网正式接口均已返回网站revision1；加载前后29张业务表的完整内容哈希相同，原round/window/manifest/授权、第四轮91/100和暂停状态相同，执行开关与原资料设置相同。本次没有创建正式清单、恢复任务或提交商品。

将实际保存的规则复制到隔离设置目录，分别为8家实际店铺及1家模拟未来店铺创建两条样例的新清单；全部自动继承WEBSITE_DEFAULT/revision1，原授权哈希一致，READY/inactive、源run数0，模拟重启后保持。正式业务数据库未用于这些样例创建，没有运行任何发布器。

证据：`output/website-default-regression-20261014.log`、`output/website-default-targeted-20261014.log`，以及 `output/website-listing-default-20261014/` 内的 `before.json`、`saved-default.json`、`after.json`、`inherited-saved-config.json`、维护回执和可复查脚本。上述为代码、配置和本地运行验证，不代表新的平台上架结果或独立QA验收。
