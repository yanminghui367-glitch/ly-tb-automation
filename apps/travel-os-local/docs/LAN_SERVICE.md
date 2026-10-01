# 内部局域网与后台保活

配置日期：2026-09-24。用户授权恢复 4318 并作为持续运行的内部局域网工作台。

- 本机：http://127.0.0.1:4318/
- 当前以太网地址：http://192.168.1.3:4318/
- Windows 任务：`TravelOS-Internal-KeepAlive`，当前用户登录时运行，并每分钟检查一次；通过隐藏窗口的 VBS 启动器启动独立 Node 进程。
- 关闭网页、Codex 或终端不关闭服务。服务异常退出后，下一轮检查重新启动；不会因此自动开始或继续发布任务。
- 本机配置：`.runtime/launcher/service.json`，`enabled=true`、`lanInterface=以太网`。没有此配置时仍为仅本机访问。
- 防火墙规则：`TravelOS-Internal-4318`，只允许当前 Node 程序、以太网、TCP 4318、192.168.1.0/24。当前以太网被 Windows 标为 Public，因此规则使用 Any 网络类型，但仍限制接口与网段；未改变网络类型、开放调试端口或配置公网映射。
- 服务同时校验客户端网段、Host 和 POST Origin；来源仅接受本机及指定本机局域网地址。它是供可信同网段设备访问的内部工作台，没有新增账户权限系统。

## 使用边界

电脑需保持开机且 Windows 用户已登录；锁屏可用，关机、注销或断网期间不可用。登录触发器已配置，未通过实际重启/注销验收。本机现有自动睡眠和自动休眠超时均为 0，本轮未修改电源设置。

局域网地址若因 DHCP 变化，启动器会在下次启动时读取该接口的新地址。同一子网内的新地址可沿用防火墙规则；网段变化需调整规则。其他设备访问本机地址 127.0.0.1 无效，应使用以太网地址。

保活模式下，工作台“暂停并退出程序”会关闭当前进程，但随后会自动重新启动。需长期停止时，先在工作台暂停正在运行的任务，再在 Windows 任务计划程序中禁用 `TravelOS-Internal-KeepAlive`，并将本机 service.json 的 enabled 改为 false，然后退出工作台。仅关闭局域网访问时可将 lanInterface 置空，停用 `TravelOS-Internal-4318` 防火墙规则，并在空闲时重启服务。

## 原故障与修复范围

`.runtime/launcher/2026-09-23T14-32-47-543Z.error.log` 记录 Node 堆内存耗尽，进程退出，约运行 19 小时。此次修复服务恢复、局域网访问和退出后的自动拉起；内存持续增长的根因尚未确认，没有通过调高内存上限掩盖问题。分钟级恢复不等于零停机，也不能恢复断电期间服务。

## 验证

- 本机与本机经局域网 IP 请求均返回 HTTP 200，冻结内核 10 文件哈希一致。
- 16 项网络策略与静态资源测试通过；允许同网段地址，拒绝外部网段/非法 Host/外部 POST Origin。
- 19 项产品 API/状态回归通过，共 35 项；语法和 Git diff 空白检查通过。
- LAN Origin 的无效测试 API 返回 404，外部 Origin 返回 403；未用真实业务写入测试网络。
- 自动恢复测试仅在执行开关 false、IDLE、active=null 时发起优雅关闭；结果见 `../output/lan-service-20260924/recovery.json`。未执行商品发布。
- 实测无需手动启动：PID 43660 退出后，计划任务约 28.1 秒内恢复为 PID 46660，恢复后局域网主页 HTTP 200，执行仍关闭、active=null。
- 没有第二台局域网设备可控，跨设备访问待使用者实测。

实现：`workbench/network-access.mjs`、`workbench/server.mjs`、`tools/start-workbench.mjs`、`tools/keep-workbench-running.vbs`。测试：`workbench/scripts/network-access.test.mjs`。
