# Windows 执行提醒｜2026-10-17

2026-10-18 整合更新：此处此前“等待安全部署”为旧时点记录。通知server/module/启动器已由单条重新执行维护一并保留加载，正式PID40776/84项`20261017-single-item-direct-retry3`；独立QA复核整合、9库原记录不变。没有调用真实通知工具或验收桌面送达。现有规则可能对正常单条结束暂停发attention提醒，已记录为非阻断后续事项，本次未改通知行为。部署证据：`output/single-item-direct-retry-20261017/production-after.json`及`qa/independent-qa.md`。

用户授权的范围：单轮异常停机和整轮完成各提醒一次；操作者主动暂停/停止及单条跳过不提醒。提醒内容为店铺、当前目的地和简短说明，点击回到工作台任务页；提醒不恢复、不重试，也不改变执行权限。

实现由 `workbench/execution-notifications.mjs` 观察每家店最近轮次，状态持久化在本机 `.runtime/execution-notifications.json`，先写去重记录再发送 Windows 通知，避免轮询或进程重启重复弹出。`tools/notify-workbench.ps1` 使用 Windows 系统托盘通知；服务守护由 `tools/start-workbench.mjs` 对近期健康记录检测意外中断，正常关闭写入干净停机标记。点击通知只打开本机任务页。

验证：新增 3 项通知边界测试通过；通知组件、服务器和守护启动器语法检查通过；与轮次、结果核验和提交暂停边界相关的 80 项回归通过。PowerShell 脚本语法解析通过。实际桌面弹窗未做可视确认。

部署限制：正式工作台当前有一条验证码人工验证页，属于受保护执行页；本次未重启正式服务、未关闭 Chrome、未启动或修改上架。代码已纳入完整性锁 `20261017-windows-execution-notifications`，等待该人工验证页处理后再安全维护加载。正式页面的弹窗送达尚未验收。
