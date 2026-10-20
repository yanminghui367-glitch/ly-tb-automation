# 持续运行修复候选

运行改动仅三个文件：主图/详情空 iframe 等待、来源异常有界恢复、同次执行一次干净页重填。预算、次数、提交、验证码、身份、页面保护保持原边界。

候选与本地回归绑定见 final-regression-binding.json；安装清单见 INSTALLATION-PLAN.md；独立结论见 qa/。watchdog Step 1.5 已生效，本包不更改策略或熔断记录。

生产复跑、PID、数据库备份与人工现场确认仅保存在本轮 output 根，不混入源码审计候选。
