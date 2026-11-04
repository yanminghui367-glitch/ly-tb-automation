# 本轮联合安装顺序

用户授权来源：2026-11-01 本对话“按这个方案执行，先完成异常定位、恢复入口和页面处置，测试校验通过后再做图片集中上传。不要启动真实上架”。

1. 阶段一独立 QA 已通过后才开发阶段二；阶段一代码在 phase1-candidate 封存，证据为 qa-phase1/FINAL-QA.json。
2. 两阶段最终字节完成后生成候选白名单、逐文件 baselineSha256/sha256、candidate-manifest.json。联合独立 QA 绑定该 manifest；不得将阶段一测试通过套用到变化后的文件。
3. 联合 QA PASS 后生成新锁：只更新白名单项及本次新增执行文件；保留旧键/旧审查/历史 baselineCommit，登记本次唯一 revision。加入原未冻结但影响执行提醒的 tools/notify-workbench.ps1。
4. qa-final/FINAL-QA.json 包含实际候选哈希及逐文件哈希。正式锁和生产白名单基线未变化、内核仍绿时才准备维护。
5. `node output/recovery-materials-20261101/maintenance.mjs prepare`：核对所有店铺空闲、Chrome 均未运行；保存业务表/设置/轮次摘要、白名单原始源码与旧锁，用 SQLite backup 接口备份九个实际业务库并检查完整性。
6. `... maintenance.mjs install`：再次核对原状态，临时停用原已启用的 KeepAlive 和环球看守，等待其正常退出。走原正常关闭接口，旧进程未退出不安装。先装候选源码和旧锁快照，最后原子替换新锁，验绿后启动；传入 WORKBENCH_BROWSER_AUTOSTART=0 保持执行 Chrome 关闭，不自动开始/恢复商品。
7. `... maintenance.mjs verify`：核对新 PID/启动时间/完整内核版本和文件数；所有原业务表、设置、轮次、计数、次数不变、没有新增业务表。失败不恢复看守、不宣称上线通过。成功才恢复原计划任务启用状态，不强制运行它们。
8. 正式网页只读加载、HTTP 静态资源哈希和界面检查；不点击图片准备或商品执行，不真实上传或发布。真实淘宝多文件控件与上传回执尚待实际账号场景验收，隔离通过不等于平台已验证。

若安装后回归失败，`... maintenance.mjs rollback` 正常关闭服务并恢复白名单原代码和旧锁；新增源码保留为未引用文件，业务库不回滚。若旧进程仍未退出或核对数据变化，停止后续覆盖，保留证据先处理具体问题。
