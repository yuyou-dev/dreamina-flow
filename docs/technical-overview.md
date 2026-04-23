# 技术概览

## 运行链路

1. `studio-web` 读取 `/api/capabilities` 得到节点定义，并读取 `/api/adapter/status` 形成系统状态展示
2. 用户在画布上编辑 workflow，并把输入素材上传到 `/api/assets/upload`
3. 单节点运行时，前端先调用 `/api/nodes/:type/validate`，再调用 `/api/nodes/:type/run`
4. Run Chain 时，前端提交完整 `nodes + edges + targetNodeId` 到 `/api/flows/run`
5. 如果系统状态显示尚未登录，前端会引导 headless 登录，并在成功后继续执行原本的生成动作
6. API 通过 `workflow-core` 解析上游 processor chain，再调用 `dreamina-adapter`
7. 如果 Dreamina 仍在处理中，节点保持 `querying`，前端用 `/api/tasks/:submitId` 轮询

## Core

`workflow-core` 提供：

- `WORKFLOW_SCHEMA = workflow.document/v1alpha1`
- `NodeDefinition` / `WorkflowDocument` / `WorkflowRunResult`
- starter workflow
- workflow 导入导出与兼容性检查
- 多输入边顺序处理
- pending flow 恢复逻辑

## Adapter

`dreamina-adapter` 提供：

- `discoverNodeDefinitions()`
- `getAdapterStatus()`
- `getAccountStatus()`
- `login()`
- `relogin()`
- `validateNodeRun()`
- `runNode()`
- `queryRunResult()`
- `collectArtifacts()`

补充说明：

- 8 个生成命令都会把可选 `session` 参数透传给 Dreamina CLI
- 对 CLI 明确支持“留空即走默认值”的模型/分辨率参数，catalog 会保留为空而不是预先填死
- 登录会话现在走 OAuth Device Flow：先执行 `dreamina login --headless` / `dreamina relogin --headless`，再用 `dreamina login checklogin --device_code=...` 轮询完成授权
- `list_task`、`session` 管理子命令目前只记录在本地 CLI 对齐文档中，不暴露到 API / UI

## API

`studio-api` 只保留：

- `GET /api/capabilities`
- `GET /api/adapter/status`
- `POST /api/adapter/login`
- `GET /api/adapter/login/:sessionId`
- `POST /api/assets/upload`
- `POST /api/nodes/:type/validate`
- `POST /api/nodes/:type/run`
- `POST /api/flows/run`
- `GET /api/tasks/:submitId`
