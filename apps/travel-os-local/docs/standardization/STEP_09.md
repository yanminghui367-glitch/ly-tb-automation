# 第 09 步｜最小工具与接口

日期：2026-09-13。状态：本步骤制度与文档已交付；独立总复核以项目总负责人汇总为准。

## 目标与范围

完成第 09 步的可执行标准。负责人：LY00 协调，当前任务内 roles_tools 协作代理编制；复核：交项目总任务独立检查。不代表创建对应侧栏对话。

## 交付

[TOOL_ACCESS.md](../operations/TOOL_ACCESS.md)

已建立岗位工具矩阵、三级可用性说明、最小权限与新增工具登记规则；未安装无关组件。

## 输入与证据

- AGENTS.md、README.md、docs/LY00_PROJECT_CHARTER.md、docs/WORKFLOW.md。
- docs/EXTERNAL_COMPONENTS_INVENTORY_2026-09-12.md、docs/LY07_PACKAGE_GENERATION.md、docs/LY08_AUTOMATION_ENGINE.md、docs/LY11_QUALITY_RELEASE_AUDIT_2026-09-12.md。
- workbench/package.json、workbench/server.mjs 和实际技能路径/工具清单检查。

## 验收结果

node/npm/npx 命令可发现；现有 package.json 声明 Playwright；本会话 image_gen 可见；未发现 Codex 项目对话管理工具。

文档交付文件存在、正文可读；本轮仅修改本步骤与 operations 文档，未修改代码、队列、源商品包或平台状态。平台实测不在本卡完成范围。

## 卡点与限制

工具矩阵是操作约束，尚非技术访问隔离；浏览器登录/生产接入本轮未测，ComfyUI 只沿用历史候选记录。

## 下一步

执行 WORKFLOW_STANDARD.md 管理流水线的任务定义与交接。

## 对应项目任务与交接指令

侧栏对话ID：未取得；本轮实际执行者：roles_tools（当前主任务内协作代理）。拟用任务标题：LY 标准化 09｜本卡对应主题。未向侧栏对话发送消息，不伪造派发结果。

交接时先读根AGENTS、README、PROJECT_STATUS、knowledge/INDEX及本卡；核对已交付文件与未提交修改，复用已完成成果，只补本卡未解决项。任务所列产物为编辑范围，公共入口交总负责人整合。卡点先查知识库的原始来源、适用日期及既有授权；缺业务事实不得猜造。更新本卡的执行结果、验收证据与下一项动作。
