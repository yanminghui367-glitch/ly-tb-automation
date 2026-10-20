# 星途内核发布手册（Step 0.5）

核验日期：2026-10-18。项目：`C:/Users/Administrator/Documents/ChatGPT/旅游 上架自动化`。依据：用户本轮“只做 Step 0.5，不进入 Step 1”、外部《星途-Codex实施工作单.md》v2，以及以下实际源码和历史发布证据。

**本轮仅交付发布流程、文件影响清单与隔离验证。没有修改正式内核、锁、数据库、尝试额度，没有重启或启动商品。后文的正式安装步骤供后续获准模块使用，本轮没有执行。**

## 1. 已确认的基线与门禁

| 核对项 | 2026-10-18 实测 |
|---|---|
| 冻结文件数 | **84，不是 86**；附录逐项列全 |
| `kernel.revision` | `20261017-single-item-direct-retry3` |
| `kernel.baseline` / `baselineCommit` | `25a47febfe08f8af6bfade20198d787354b76bff`，历史锚点，不是当前源码提交 |
| 磁盘 `verifyKernel()` | `ok=true, files=84, changed=[]` |
| 正式 `GET /api/v1/health` | PID `40776`；同一 revision；`ok=true, files=84, changed=[]` |
| Git HEAD | `4d4b93bb999e7f429efab92aecfb1f6060dee7e0` |
| 84 项与 Git HEAD 的字节对照 | 3 项一致，21 项已跟踪但字节不同，**60 项未跟踪**；包含换行在内按原始字节计算 |

实现：[kernel-integrity.mjs](../workbench/kernel-integrity.mjs) 每次重新读取锁和已登记文件，计算原始字节 SHA-256；文件缺失也记入 `changed`。它**不核对 Git、不自动递增版本、不检查 QA 结论、不自动发现新文件，也不验证 review 字段**。锁本身不在 84 项内。这些是现行能力边界，本轮不改实现。

[product-api.mjs:166–191](../workbench/product-api.mjs#L166) 在开始/恢复前检查内核、运行空闲、店铺登录和原清单；[health 路由](../workbench/product-api.mjs#L464) 直接调用当前的完整性检查。内核不通过时不能通过刷新全部哈希、删除锁项或修改业务库来放行。

**Git 脏但健康为绿的原因已确认：当前 84 项磁盘字节均与锁吻合，锁没有落后于这 84 项。** 这不证明未登记文件安全、不证明全部修改经过审核，也不证明当前 Node 进程已加载刚改的文件。HTTP 健康检查读取磁盘，运行模块可能仍是重启前版本。

## 2. 后续改动的文件边界

v2 正文后续实施为 **Step 1–8**，本手册覆盖这 8 步。“9 个 Step”如计入 Step 0.5 则并无额外步骤；Step 1 中“转 Step 9”与正文编号不一致，本手册按正文将离线素材预检理解为 **Step 8**，不据此增加步骤。

下表是代码位置核对后的最小候选范围，**不是本轮改动授权**。后续每个 Step 开始前应冻结实际候选清单；“按需”文件只有证明确需改动才纳入，并重新审查。附录中“—”表示当前计划不修改，不表示可以绕过联动测试。

| 后续步骤 | 主要候选文件 | 条件性联动与约束 |
|---|---|---|
| 1 详情素材等待 | `taobao-publisher.mjs`、`publishing-materials.mjs` | 如结构化上下文无法原样留存，再考虑 `source-workflow.mjs` / `execution-steps.mjs`；不动次数、轮次、提交逻辑 |
| 2 错误分类 | `listing-round.mjs`、`source-workflow.mjs` | 按需调整上游错误码、只读显示；不改变状态枚举和尝试计数语义；不能把所有超时一概视作安全重试 |
| 3 受控重入 | 新独立接口模块；复核 `product-api.mjs`、`round-selection.mjs`、`round-item-retry.mjs`、`round-item-attempts.mjs` 的复用边界 | 可能涉及 `batch-store.mjs`、`listing-round.mjs`；现行已有人工补额与单条重试，不能重新造一套次数账本；**另行确认业务口径后才实施** |
| 4 子步骤断点 | `source-workflow.mjs`、`execution-steps.mjs`、`taobao-publisher.mjs` | `source-store.mjs`、`publishing-materials.mjs`、`round-material-binding.mjs` 仅在现有结构不足时联动；先复用已有断点和详情前缀恢复 |
| 5 匀速节流 | `listing-round.mjs` 与新增配置模块 | `execution-timing.mjs` 按需；不重排任务、不改租约和 gate，不因换版本清零额度 |
| 6 汇报输出 | 新增只读报告导出模块 | 默认无需修改既有冻结项；只有需要接入执行完成事件时才联动 `listing-round.mjs` / `execution-steps.mjs`；不回写历史事件 |
| 7 幂等认领 | `source-workflow.mjs`、`result-reconciliation.mjs`、`listing-verification.mjs`、`round-verification.mjs` | `taobao-publisher.mjs`、`listing-round.mjs` 按需；匹配标题不足以单独证明本次提交成功，须保留同店、原提交及商品核验依据；未知结果不自动重提 |
| 8 离线素材测量 | 新增离线脚本和配置 | 条件触发；默认不改执行器、不上传、不自动修改图片；复用当前导入格式 |

新建且会影响执行/恢复/额度的运行文件或配置，须在候选清单中明确标为新增，并登记到锁；不能利用“原先没列入 84 项”规避校验。测试和说明通常不纳入运行锁，但仍进入候选清单与审查。只读离线脚本是否纳入锁由该步骤范围确定，不能擅自把整个仓库加锁。

当前未冻结但可能联动的现有文件包括 `workbench/product-state.mjs`、`workbench/task-view-model.mjs` 和 `tools/start-workbench.mjs`。若后续真的修改，应明确其证据和冻结覆盖决定，不能把 84 项理解成全部项目文件。

## 3. revision 如何递增

现行程序把 revision 当作**不透明字符串**，只比较是否相等，不做数字递增或版本大小排序。历史既有 `rNN`，也有日期加功能名；`single-item-direct-retry3` 中的 `3` 表示人工追加次数功能，不是通用“第三次发布”。

后续本工作单采用明确约定：`YYYYMMDD-stepN-英文功能短名-rK`，例如 `20261018-step1-detail-ready-r1`。这是**后续命名约定，不是本次已发布版本**。同一候选重新修改字节后重新测试、重新 QA；正式安装一个新候选使用一个从未使用的 revision，同日修订为 `r2` 等。每个步骤独立发布，不提前把后续修改混入本次锁。

- 只改本手册，不递增正式 revision。
- 修改冻结运行代码或执行配置并发布，必须递增 revision，同时更新对应哈希。
- `baselineCommit` 保留历史含义，不为消除 Git 差异伪造新锚点。
- 回退要恢复原代码与原锁，回到原 revision，并另留回退记录；不能只改字符串。

## 4. 基线、候选与 review 的格式

### 4.1 基线保存

安装前把**当时的正式 `workbench/kernel-lock.json` 原始字节**保存为：

`docs/kernel-baselines/YYYYMMDD-before-stepN-功能短名-rK.json`

同名文件已存在就停止，或核对完全同字节后复用；不得覆盖历史快照。快照是旧锁，**不是旧代码备份**。另在本机发布证据目录保存本次允许修改文件的原始字节、安装前哈希、原文件是否存在，以及完整候选清单。新增文件的 `baselineSha256` 为 `null`。

已核实的例子：

- [旧锁快照](kernel-baselines/20261017-before-single-item-direct-retry3.json)：revision 为 `20261017-windows-execution-notifications`，84 项。
- 该快照到当前锁只改变了 7 个运行文件的哈希，review 同时绑定 14 项候选（7 项运行文件、7 项测试）。
- 顶层 `previousManifest` 仍指向 10 月 13 日历史快照，**不能把它视为当前版本的直接前驱**。新 review 自己记录 `previousManifest`、`fromRevision`、`toRevision` 和 `beforeLockSha256`；旧字段作为历史原样保留。

建议后续每步使用独立本机目录 `output/kernel-release/<revision>/`，保存 `source-before/`、`candidate-manifest.json`、`qa/`、安装清单、健康检查前后结果与回退记录。运行/业务备份留在本机受保护目录，不进入 Git；不备份、读取或迁移浏览器登录资料。

### 4.2 候选清单

字段例子（尖括号必须替换成真实值；不是已通过候选）：

```json
{
  "at": "<实际 ISO 时间>",
  "scope": "Step 1：仅详情素材就绪判据与对应测试",
  "runtimeFiles": ["workbench/taobao-publisher.mjs", "workbench/publishing-materials.mjs"],
  "files": [
    {"path": "workbench/taobao-publisher.mjs", "baselineSha256": "<安装前哈希>", "sha256": "<审查候选哈希>"},
    {"path": "workbench/publishing-materials.mjs", "baselineSha256": "<安装前哈希>", "sha256": "<审查候选哈希>"},
    {"path": "<实际测试文件>", "baselineSha256": null, "sha256": "<审查候选哈希>"}
  ]
}
```

`candidateManifestSha256` 是**已落盘 candidate-manifest.json 全文件原始字节**的 SHA-256，不是 `files` 子对象的哈希。换行/排版改变也必须重新签验。QA 后不再重写候选清单或候选代码。

### 4.3 review 与独立 QA

当前真实样例 `kernel-lock.json.singleItemDirectRetryReview`：

```json
{
  "at": "2026-10-17T16:00:09.860Z",
  "qaAgent": "/root/single_retry_qa",
  "evidence": "output/single-item-direct-retry-20261017/qa/independent-qa.md",
  "candidateManifestSha256": "9ef9598b65947f462dfacf508266282215525af72b8c69dfeb55ebb5fece1a19",
  "scope": "Seven reviewed runtime files: one-click original-item retry, three audited manual additions, proven detail-prefix recovery; original records and fresh publish gates preserved"
}
```

已重新计算历史 manifest 哈希，与该 review 一致；历史 QA 报告明确限定候选范围、独立测试与生产未执行的边界。

新步骤在锁中追加唯一的 `stepN功能名Review`，保留所有旧字段。至少包含 `at`、`qaAgent`（真实复核者）、`evidence`（真实独立 QA 报告路径）、`candidateManifestSha256`、`scope`。另补 `previousManifest`、`beforeLockSha256`、`fromRevision`、`toRevision` 以明确前驱。独立 QA 的机器可读结果应绑定相同 manifest 哈希和逐文件哈希，并写明 PASS/退回/阻塞。

这里的 QA 通过是**发布流程要求**，现行 `verifyKernel` 不会替人检查。执行者的自测不能签为独立 QA；历史 QA 也不能套用于新候选。只有相同候选字节才可沿用对应验收。

`output/` 被 Git 忽略。因此提交 PR 前，应把**不含业务数据和登录资料**的候选清单、独立 QA、测试摘要与变更说明另存于可追踪的 `docs/release-evidence/<revision>/`，新 review 指向可随代码交付的报告；本机原始证据路径保留在说明中。不能为提交证据取消整个 `output/` 忽略规则。

## 5. 可照做的发布顺序

### A. 记录基线与准备候选

在项目根目录执行以下只读检查，保留结果：

```powershell
Set-Location -LiteralPath 'C:/Users/Administrator/Documents/ChatGPT/旅游 上架自动化'
node --input-type=module -e "import {verifyKernel} from './workbench/kernel-integrity.mjs'; console.log(JSON.stringify(await verifyKernel(),null,2));"
Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/v1/health' | ConvertTo-Json -Depth 8
git status --short
```

1. 磁盘与 HTTP 都为绿、版本一致后，记录正式锁 SHA-256、PID、84 项源码哈希、当前全部店铺执行状态。内核红灯时先核对变更归属，不能一键重算掩盖差异。
2. 在独立的**纯源码候选副本**开发；继承当前磁盘已核实的源码，不能直接用落后的 Git HEAD。副本需含测试依赖的非冻结源码，不能只拷贝 84 项冒充完整工程；不复制 `.runtime`、登录目录或账户资料。生产仍使用原文件和原锁。
3. 完成该 Step 的修复、必要测试和候选清单，绑定独立 QA。为本次唯一 revision 准备基线快照、源码回退包和部署白名单。
4. 基线快照记录的是**安装前**正式锁。如果多人协作期间正式锁或任一候选基线文件变了，停止安装并重新合并/签验，不覆盖别人的更新。

### B. 生成新锁，只改已签验项

可复用的算法（在候选目录生成 `kernel-lock.next.json`，不直接覆盖正式锁）：

```js
// 输入必须来自该 Step 的真实发布包；所有 sha256 均按原始文件字节计算。
const next = structuredClone(oldLock);
for (const file of candidate.runtimeFiles) {
  // 校验 file 在发布白名单、候选 files 和 QA files 中各出现一次；禁止绝对路径、.. 和符号链接。
  // 验证候选字节哈希 === candidate.files[file].sha256 === qa.files[file]。
  // 验证正式旧字节 === baselineSha256；新增文件必须原先不存在。
  next.files[file] = reviewedCandidateHash(file);
}
// 非本次 runtimeFiles 的旧锁键与哈希必须逐项保持；禁止遗漏或删除旧键。
next.revision = uniqueReleaseRevision;
next[uniqueReviewKey] = actualReview;
// 先验证完整候选目录 verifyKernel(candidateRoot, nextLockPath)，通过后才进入维护。
```

上面是生成原则，不是已有的通用发布命令。现仓库核实到的是每次发布专用的维护脚本；例如 [10 月 17 日维护脚本](../output/single-item-direct-retry-20261017/maintenance.mjs) 的 `prepare → reload → verify` 有完整实现，但它**硬编码旧候选、14 个文件和旧版本，只能作为参考，不能用它安装新步骤**。后续每步的发布包必须带绑定本步候选的维护脚本，不能让使用者手工猜该更新哪些哈希。

文件数判据：只改现有项时仍为 `84`；新增 `k` 个已审查运行文件时为 `84+k`（以后以安装前数量为起点）。当前步骤不允许悄悄删除旧冻结项。

### C. 正常维护安装

1. 逐个确认店铺 `active` 和 `round.active` 均为空/false，并无属性读取、导入或其他写入。暂停状态不能仅凭页面文案判断。保留原清单、任务、attempts、checkpoint、设置及业务库逐表摘要；SQLite 备份使用其备份接口，不直接复制正在写入的单个 `.sqlite` 文件。
2. 核对执行 Chrome 与所有保留页面：有未落盘的提交结果、验证码或登录待人工处理、不可重建的表单上下文时先保留现场，**不以维护为名关闭现场**。正常关闭服务会调用 `browserEnvironment.closeAll()`，不能声称它“仅刷新网页、浏览器不受影响”。
3. 满足维护条件后，使用正常关闭入口，并确认 4318 监听关闭及原进程退出；不使用强杀。仅调用启动器而服务还在，会复用旧进程，不能达到加载新代码的目的。

```powershell
# 仅在本节维护条件和候选审查全部满足后运行；Step 0.5 本轮不运行。
$base = 'http://127.0.0.1:4318'
Invoke-RestMethod -Method Post -Uri "$base/api/program/shutdown" -Headers @{ Origin = $base } -ContentType 'application/json' -Body '{}'
```

4. 服务完全停止后，再核对安装前哈希及锁，原字节存档旧锁和允许改动的源码；安装已审查候选文件，逐项校验安装哈希；**最后**以同目录临时文件加重命名方式替换锁。不要边运行边覆盖内核。若发现保活或另一操作者重新启动了服务，暂停安装。
5. 启动前运行磁盘 `verifyKernel()`，应为绿。再正常启动：

```powershell
node tools/start-workbench.mjs --no-open
Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/v1/health' | ConvertTo-Json -Depth 8
```

6. 保存新进程身份及启动证据；通常 PID 与安装前不同，仍应核对启动日志/新进程开始时间，不单凭 PID 判定。逐项比对正式源码、HTTP 交付资源与审查候选哈希；刷新网页后进行该模块的网站操作验收。业务库、任务状态、原尝试次数及设置应保持；如有预期 migration，必须另有允许变更清单及回退说明。
7. 不自动点击开始/继续商品。网站加载验证与真实发布验收分开记录；后者沿用适用授权及原闸门。

源码依据：[正常关闭](../workbench/server.mjs#L768)、[启动器](../tools/start-workbench.mjs)、[已执行的历史维护方案](../output/single-item-direct-retry-20261017/maintenance.mjs)。未来任一步仍按此完成独立测试、QA、基线/锁/revision/review、加载检查和 change note，不能只交修改的业务代码。

### D. 健康检查应看到什么

| 时点 | `kernel.ok` | `kernel.files` | `kernel.revision` / `changed` |
|---|---|---|---|
| 本轮正式服务（前后） | true | 84 | `20261017-single-item-direct-retry3` / `[]` |
| 隔离副本改 1 项、未更新锁 | false | 84 | 原 revision / 仅该文件 |
| 审查候选精确更新锁后 | true | 安装前数量＋新增登记数 | 新 revision / `[]` |
| 正式正常重载完成 | true | 与候选预期完全相等 | 与发布包新 revision 完全相等 / `[]` |

`ok=true` 但版本还是旧的，或文件数不对，均不算本次交付成功。`ok=false` 可以返回 HTTP 200，判断时必须查看 JSON 内 `kernel.ok`。健康绿也不等于已登录、额度可用、恢复检查通过或上架成功。

### E. 失败回退

安装中失败时保持服务停止，依据安装日志只恢复本次白名单中的原代码字节和原锁；本次新增文件只有在路径、候选哈希和归属均确认后才移除。不要 `git reset --hard`、清空输出或用旧锁覆盖整个新工作区。

恢复后先核对旧 revision、原文件数、`changed=[]`，再正常启动，核对业务数据与暂停状态。若新版本启动后已有业务写入，不恢复旧业务库抹掉历史；先判断兼容性，涉及 schema 的步骤另按已审查 migration 回退。任何回退都保留候选、失败原因和操作审计。

## 6. 旧轮次如何接受新 revision

这是**现行预期行为，不需新增版本确认弹窗**，但发生在网站已有“开始/继续”的请求中，不是健康检查、锁更新或重启时自动改库。

1. `ProductApi` 检查执行许可、完整性、店铺、清单、当前窗口等条件；新建轮次要求传入版本等于当前内核版本。恢复已有轮次时，由服务端把新检查得到的 `kernel.revision` 交给 `ListingRound.start/resume`。
2. [listing-round.mjs:267–293](../workbench/listing-round.mjs#L267) 校验空闲、清单/窗口、历史成功内容及人工阻塞；只有 `READY/STOPPED/SYSTEM_BLOCKED/PAUSED/WAITING_HUMAN/RESULT_UNKNOWN` 等允许状态可接受不同版本。
3. 版本不同则更新 `rounds.repair_version`，追加 `REPAIR_VERSION_UPDATED`，含 `from`、`to`、原 `authorizationHash` 和 `attemptsPreserved:true`。**该分支不重置、不增加 attempts，也不改 max_attempts。** 后续真正 claim 一个商品时仍按现行逻辑扣次，不能把两者混淆。
4. 版本更新后执行仍可能因预算、资料、验证码或提交结果不明被阻止。换 revision 不是额度解锁，不能解决序号 12 的预算不足。

核验时对照更新前后的 `repair_version`、版本审计事件与尝试次数；不能直接 SQL 修改版本来绕过恢复检查。本轮没有调用 start/resume，因此没有制造新版本事件。

另纠正 v2 一处表述：[gate()](../workbench/listing-round.mjs#L549) 的闸门保存在 **每条固定清单 `rounds` 记录**上，不是店铺永久只过一次。首个 `NEW_SUCCESS` 后 gate=1 并持久暂停，第 5 个后 gate=5；创建新固定清单可能重新经过闸门。后续 Step 5 保持该实现，本轮不改为店铺全局。

### 6.1 复现验收与追加额度必须分别明确（2026-10-18补充）

“使用原现场复现”“重新验收”不自动构成人工加额或真实提交授权。先区分离线/mock复现、只填写与真实重跑，再核对实际claim是否扣次；不得默认DRY_RUN不消耗额度，也不得由“尚有可加次数”推导操作者同意加额。

若验收必须消耗已耗尽原任务的真实额度，验收单须明确：店铺、原任务/商品、允许追加的次数（例如“授权原任务加额+1”）、复跑范围和是否允许最终提交。既有会话已明确覆盖这些事实时直接沿用并记录来源，不重复索取同一授权；只有“复现”字样而无所需加额授权时，先完成隔离验证，再补齐该项。

追加必须走原接口、原任务与现行硬上限，保留加额前后attempts/max_attempts/extra_attempts、requestId、审计事件和具体确认原文或可追溯来源。不得重建任务、直接改库或清空审计来获取次数；不得把审查建议、执行方判断和操作者确认混写成同一授权。

本次序号12的第二次加额依据是后续结构化回复“修复验收后原任务再加1次复测”，不是此前“建议认损”或“同一现场复现”的段落。来源说明与原请求ID见本机`output/run1-first175-20261018/authorization-provenance.md`；历史请求和审计原样保留。本补充只修正文档规则，不改变正在运行的17–191样本、执行器、预算或采集口径。

## 7. 隔离验收与 Git 交付条件

本轮使用**实际 `verifyKernel` 和实际 `ProductApi.handle` 的 health 路由**，给它们注入隔离目录；临时 HTTP 服务器只接受 GET。未构造业务 API 实例、未打开业务库、未连接执行 Chrome。

复现命令（在项目根目录；仅写忽略的本机 `output/`，正式网站只读 GET）：

```powershell
node docs/release-evidence/20261018-step05/rehearsal.mjs
```

结果：**6 项通过**。原锁绿；改 1 项红；错误哈希仍红；仅更新候选该项后绿；未登记文件不会自动纳入校验；原文件加原锁成对回退后绿。

证据：[可交付结果摘要](release-evidence/20261018-step05/result-summary.json)、[隔离脚本](release-evidence/20261018-step05/rehearsal.mjs)、[复现说明](release-evidence/20261018-step05/README.md)。归档版脚本独立再运行一次，仍为 6 项通过；原始结果在 `output/kernel-release-step05-20261018/runs/2026-10-18T03-21-29-176Z/result.json`。正式锁及 84 项文件前后逐字节一致，PID 仍为 40776；生产 POST=0、重启=0、提交=0。隔离 revision `20261018-step05-isolated-rehearsal-r1` **未写入正式目录**。这证明完整性与健康路由流程，不是正式维护或平台上架。另见[独立复核报告](release-evidence/20261018-step05/independent-qa.md)，其结论仅适用于本手册及演练证据，不代替未来代码候选的 QA。

工作单要求每步独立 PR。当前 **60 项冻结文件未被 Git 跟踪**，直接从旧 HEAD 提交 Step 1 的两个文件不能形成可运行的完整交付。后续发布前应先单独核对并记录当前有效源码基线，再在该基线上做每步精确 diff/PR，或提供完整、已审查的源代码基线包及其来源；不可 `git add .` 把账户运行资料一并带入。本轮仅完成本地 Step 0.5 文档与隔离证据，**未提交 Git、未创建 PR、未同步远端**；这项交付限制不能被健康绿替代。

Step 0.5 的完成边界：七个问题均有源码/历史证据和实际隔离验证；后续改动按本手册形成候选与发布包。**Step 1 尚未开始，真实上传故障也不在本轮宣称已修复。**

## 附录 A：当前锁完整 84 项

“主”表示该步骤主要候选，“需”表示条件性联动。所有行在本轮都保持原字节；无标注行当前计划不改。路径来源为 `workbench/kernel-lock.json.files`，不是手工挑选的局部清单。

| # | 锁定路径 | 后续步骤影响 |
|---|---|---|
| 1 | `workbench/taobao-publisher.mjs` | 主 1、4；需 2、7 |
| 2 | `workbench/source-workflow.mjs` | 主 2、4、7；需 1 |
| 3 | `workbench/source-store.mjs` | 需 4 |
| 4 | `engine/v2/adapter.py` | — |
| 5 | `engine/v2/heat_queue_adapter.py` | — |
| 6 | `engine/v2/pool_adapter.py` | — |
| 7 | `workbench/batch-workflow.mjs` | — |
| 8 | `workbench/batch-store.mjs` | 需 3 |
| 9 | `workbench/session-guard.mjs` | —；保护规则保留 |
| 10 | `workbench/browser-environment.mjs` | —；保护规则保留 |
| 11 | `workbench/publishing-attributes.mjs` | — |
| 12 | `workbench/task-screenshot.mjs` | —；优先复用 |
| 13 | `workbench/result-reconciliation.mjs` | 主 7 |
| 14 | `workbench/batch-policy.mjs` | — |
| 15 | `workbench/publishing-materials.mjs` | 主 1；需 2、4 |
| 16 | `workbench/publishing-pages.mjs` | — |
| 17 | `workbench/listing-round.mjs` | 主 2、5；需 3、6、7 |
| 18 | `workbench/listing-identity.mjs` | —；保护规则保留 |
| 19 | `workbench/listing-verification.mjs` | 主 7 |
| 20 | `workbench/round-verification.mjs` | 主 7 |
| 21 | `workbench/product-api.mjs` | 需 3 |
| 22 | `workbench/server.mjs` | —；复用既有正常维护入口 |
| 23 | `workbench/kernel-integrity.mjs` | —；复用校验，不放宽 |
| 24 | `workbench/publishing-content-review.mjs` | — |
| 25 | `workbench/round-windows.mjs` | — |
| 26 | `workbench/page-protection.mjs` | —；保护规则保留 |
| 27 | `workbench/page-ownership.mjs` | —；保护规则保留 |
| 28 | `workbench/publishing-address.mjs` | — |
| 29 | `workbench/round-item-attempts.mjs` | 需 3 |
| 30 | `workbench/round-manual-skip.mjs` | — |
| 31 | `workbench/round-item-api.mjs` | — |
| 32 | `workbench/round-item-host.mjs` | — |
| 33 | `workbench/round-item-host-api.mjs` | — |
| 34 | `workbench/round-item-verify.mjs` | — |
| 35 | `workbench/round-item-verify-api.mjs` | — |
| 36 | `workbench/round-item-candidates.mjs` | — |
| 37 | `workbench/round-execution-attempts.mjs` | —；保留账本语义 |
| 38 | `workbench/round-item-retry.mjs` | 需 3 |
| 39 | `workbench/round-item-retry-api.mjs` | —；不挪用为受控重入接口 |
| 40 | `workbench/operations-api.mjs` | — |
| 41 | `workbench/operations-catalog.mjs` | — |
| 42 | `workbench/round-selection.mjs` | 需 3 |
| 43 | `workbench/travel-os.js` | — |
| 44 | `workbench/round-item-detail.js` | — |
| 45 | `workbench/ui-copy.js` | 需 2；仅在新增错误需中文显示时 |
| 46 | `workbench/shop-execution.mjs` | — |
| 47 | `workbench/shop-scope.js` | — |
| 48 | `workbench/setup-flow.mjs` | — |
| 49 | `workbench/setup-ui.js` | — |
| 50 | `workbench/travel-os-api.mjs` | — |
| 51 | `workbench/publishing-rules-ui.js` | — |
| 52 | `workbench/operations-catalog-ui.js` | — |
| 53 | `workbench/static-files.mjs` | — |
| 54 | `workbench/destination-catalog.mjs` | — |
| 55 | `workbench/travel-os.html` | — |
| 56 | `workbench/material-library.mjs` | — |
| 57 | `workbench/shop-identity.mjs` | — |
| 58 | `workbench/setup-files.js` | — |
| 59 | `workbench/travel-os-store.mjs` | — |
| 60 | `workbench/setup-adapter.py` | — |
| 61 | `workbench/setup-template-v2.json` | — |
| 62 | `workbench/content-preparation.mjs` | — |
| 63 | `workbench/content-preflight-budget.mjs` | — |
| 64 | `workbench/content-review-ui.js` | — |
| 65 | `workbench/image-review-policy.mjs` | — |
| 66 | `workbench/material-replacement.mjs` | — |
| 67 | `workbench/material-editor.js` | — |
| 68 | `workbench/publishing-rules.mjs` | — |
| 69 | `workbench/travel-os.css` | — |
| 70 | `workbench/package.json` | —；不新增浏览器依赖 |
| 71 | `workbench/package-lock.json` | —；不新增浏览器依赖 |
| 72 | `workbench/round-material-binding.mjs` | 需 4 |
| 73 | `workbench/tasks.css` | — |
| 74 | `workbench/execution-orb.js` | — |
| 75 | `workbench/execution-orb.tsx` | — |
| 76 | `workbench/components/orbkit/orbkit-core.tsx` | — |
| 77 | `workbench/components/orbkit/shdr-12.tsx` | — |
| 78 | `workbench/components/orbkit/LICENSE` | — |
| 79 | `tools/build-execution-orb.mjs` | — |
| 80 | `workbench/components/orbkit/UPSTREAM.md` | — |
| 81 | `workbench/execution-timing.mjs` | 需 5 |
| 82 | `workbench/execution-steps.mjs` | 主 4；需 1、6 |
| 83 | `workbench/execution-evidence-policy.mjs` | —；保留取证规则 |
| 84 | `workbench/execution-notifications.mjs` | —；保留通知规则 |
