# 网站核验入口修复：独立上线复核

结论：上线核验通过，仅针对代码安装与运行版本；不代表洪都拉斯已取得平台核验结果。

复核者 `/root/submitted_recovery_qa` 独立读取当前磁盘、HTTP 健康接口、进程启动时间，以及 9 份冷备份和当前生产数据库（SQLite 只读连接）。完整结果见 `installation-qa.json`，复核脚本为 `installation-review.py`。

- 磁盘和 HTTP kernel 一致：`ok=true / files=84 / revision=20261018-website-verify-r1 / changed=[]`。
- 新 PID `47768`，进程启动时间 `2026-10-18 23:57:15.617 +08:00`。
- 两个安装文件均与候选 manifest 一致；运行文件 SHA256=`3364bcc6ac5be7945479dc7df5e36d7f5da7d128db45008172a9fda568d36018`；测试文件 SHA256=`5628643ea6f3c9e2aaefb2242f3f7c3eed1f9595a6ebd045da6ea01f6f792f07`。
- 生产锁与候选锁完全一致，SHA256=`00e588aa8ded8cfeef63614d3c3fdd21a9ec9e9606e5a7ac25dc954d3b0f2336`。
- 独立重新比较全部 9 库 211 表：209 表逐行内容相同；2 表变化与安装报告一致。`round_items` 仅当前洪都拉斯的 `updated` 时间改变；`round_events` 仅追加 seq1848 的原断点 RESULT_UNKNOWN 同步事件。没有删除旧事件，没有变更原 run、提交事件、队列、历史成功、额度或 attempts。**不能表述成全库不变或全表字节一致。**
- 9 份备份 SHA256 均与备份清单一致，安装前后配置快照与状态快照相同。
- 当前计划任务状态只读复核：KeepAlive、环球 10 分钟看守启用；五洲 30 分钟看守保持禁用。

维修前浏览器证据由主负责人采集，`maintenance-browser.json` 记录仅有环球商家首页、无发布/成功页/验证码；独立 QA 没有重新控制或操作浏览器，因此不把该记录冒称自己的现场浏览器核验。

复核全程没有业务 POST、没有核验/跳过/恢复/发布商品、没有启动或关闭浏览器、没有启停服务和计划任务。现有 RESULT_UNKNOWN 仍须通过网站原商品核验取得真实证据后才能继续，灰色跳过保护未取消。
