# Workflow Studio OSS

> 把 Dreamina CLI 变成可视化 workflow studio 的开源示例仓库

![Workflow Studio OSS 首屏插画，展示可视化工作流画布、Dreamina CLI 终端桥接和四层仓库结构](docs/illustrated-readme/2026-04-24-style-ref-readme/images/hero.png)

Workflow Studio OSS 把 Dreamina CLI 包装成一个可以在浏览器里编辑、导入、导出和运行的本地 workflow studio。仓库把 schema、执行语义、CLI 适配、最小 HTTP API 和 React Flow 画布拆成独立层，适合用来验证一套完整的本地工作流链路。

这份 README 先回答项目是什么、能解决什么，再把四层结构、运行链路、快速启动和验证入口摆清楚。文中的插画通过 Codex CLI 内置 `gpt-image-2` 生成，视觉方向参考 `style-ref/style-reference.jpg` 的蓝白拼贴版式，但内容只使用仓库中的真实事实。

## 核心亮点

- 把 Dreamina CLI 封装成可复用节点，而不是停留在终端命令层。
- 在浏览器工作台中编辑、连接、运行 workflow，并查看结果回写。
- 支持导入导出 `.workflow.json`，格式对齐 `workflow.document/v1alpha1`。
- 内置 starter workflow 与示例 workflow，便于本地快速验证。
- 登录流已切到 OAuth Device Flow，登录成功后会恢复被阻塞的动作。

## 项目价值速览

![Workflow Studio OSS 能力看板插画，展示节点化 Dreamina CLI、浏览器运行 workflow、导入导出 workflow 文件、示例流程和登录恢复能力](docs/illustrated-readme/2026-04-24-style-ref-readme/images/highlights.png)

这个仓库的核心价值不是再造一个通用流程引擎，而是把 Dreamina CLI 的可执行能力、登录状态和任务轮询真正拉进一个本地可视化工作台。对想验证 workflow 编排、Dreamina 节点封装和 UI/API/CLI 联动的人来说，这个仓库已经给出了最小而完整的骨架。

如果你只是想快速判断项目是否适合自己，先看这五个点：节点化封装、浏览器运行、标准化 workflow 文件、内置样例，以及设备登录恢复链路。

- 工作流画布建立在 `apps/studio-web`，依赖 React 19、Vite 6 和 `@xyflow/react`。
- 最小 API 位于 `apps/studio-api`，通过 Express 暴露运行、登录、上传和任务查询入口。
- Dreamina CLI 适配封装在 `packages/dreamina-adapter`，负责节点定义、登录、运行和结果查询。
- Workflow schema 与执行语义落在 `packages/workflow-core`，统一使用 `workflow.document/v1alpha1`。

## 四层结构

![Workflow Studio OSS 四层结构插画，展示 studio-web、studio-api、dreamina-adapter 和 workflow-core 的职责分工与调用方向](docs/illustrated-readme/2026-04-24-style-ref-readme/images/architecture.png)

仓库按职责拆成四层。`apps/studio-web` 负责画布、交互和状态展示；`apps/studio-api` 负责把浏览器请求编排成最小 HTTP 能力；`packages/dreamina-adapter` 负责把 Dreamina CLI 包装成节点定义与运行接口；`packages/workflow-core` 定义 schema、导入导出格式和执行语义。

这种拆法的好处是，浏览器界面、HTTP 边界、CLI 对接和 workflow 语义互相解耦。你可以单独改 schema、补 adapter 节点或替换前端表现，而不会把整个链路搅成一个应用。

- `GET /api/capabilities` 让前端拿到节点定义和系统能力。
- `POST /api/flows/run` 负责提交完整 `nodes + edges + targetNodeId` 的整链运行。
- `packages/workflow-core` 负责导入导出、兼容性检查、多输入顺序和 pending flow 恢复逻辑。
- `packages/dreamina-adapter` 暴露 `discoverNodeDefinitions()`、`login()`、`runNode()`、`queryRunResult()` 等关键能力。

## 一次请求怎么跑完

![Workflow Studio OSS 运行链路插画，展示画布编辑、节点运行、OAuth Device Flow 登录恢复与任务结果回写](docs/illustrated-readme/2026-04-24-style-ref-readme/images/workflow.png)

实际运行时，前端先读取 `/api/capabilities` 和 `/api/adapter/status` 建立画布与系统状态，再根据操作场景触发单节点运行或整链运行。若当前 Dreamina CLI 尚未登录，前端会引导 headless 设备登录，并把 `verification_uri`、`user_code`、`device_code` 直接展示在界面里。

登录成功后，之前被阻塞的运行会自动恢复。提交成功的任务继续通过 `/api/tasks/:submitId` 轮询，节点保持 `querying`，直到结果和产物回写到输出节点。

- 单节点路径：先调用 `/api/nodes/:type/validate`，再调用 `/api/nodes/:type/run`。
- 整链路径：提交完整 workflow 到 `/api/flows/run`，由 API 解析 processor chain 并调用 adapter。
- 设备登录使用 `dreamina login --headless` / `dreamina relogin --headless`，再用 `dreamina login checklogin --device_code=...` 轮询。
- 登录 UI 优先覆盖 OAuth Device Flow，如果 CLI 输出旧 QR 形式，界面会按兼容信息显示。

## 快速开始

![Workflow Studio OSS 快速开始插画，展示安装 Dreamina CLI、npm install、npm run dev、默认端口和环境要求](docs/illustrated-readme/2026-04-24-style-ref-readme/images/quick-start.png)

当前仓库只在 `macOS` 上验证，默认端口固定为 `3000`（Web）和 `3100`（API）。在本地环境满足 `Node.js 20+`、`npm 10+` 和可用 `python3` 之后，可以直接按下面的顺序启动。

先安装 Dreamina CLI：

```bash
curl -fsSL https://jimeng.jianying.com/cli | bash
```

安装完成后，建议先确认 CLI 可用：

```bash
dreamina version
dreamina login -h
dreamina relogin -h
dreamina session -h
dreamina query_result -h
dreamina user_credit
```

然后在仓库根目录执行：

```bash
npm install
npm run dev
```

启动成功后：

- Web 地址：`http://127.0.0.1:3000`
- API 地址：`http://127.0.0.1:3100`
- 启动前请先确认端口 `3000` 与 `3100` 空闲。
- 如果 `dreamina` 命令不可用，请先检查 Dreamina CLI 是否已进入 `PATH`。

## 第一次操作流程

1. 打开 `http://127.0.0.1:3000`
2. 进入默认的 starter canvas
3. 查看左上角账户状态卡，确认 Dreamina CLI 是否可用
4. 如果需要登录，点击状态卡并发起 headless 设备登录
5. 在画布中修改 starter workflow 的 prompt，或导入示例 workflow
6. 点击节点上的 `Run Node`，或点击链路上的 `Run Chain`
7. 等待结果回写到输出节点

## 示例 workflow 与验证入口

仓库已经提供了可直接导入的示例 workflow，路径位于 `resources/workflows/`。如果你想先验证导入导出、分支运行和多素材链路，可以直接从这些文件开始。

- `resources/workflows/fanout-image-derivatives.workflow.json`
- `resources/workflows/three-image-branching.workflow.json`
- `resources/workflows/three-image-reference-video.workflow.json`

完成依赖安装后，建议至少跑一次类型检查、测试、构建和 schema 校验，确保当前改动没有破坏既有链路。

```bash
npm run typecheck
npm run test
npm run build
node ./scripts/migrate-workflow-schema.mjs --check
npm run audit:cli-help
```

## 说明

- 当前仓库定位为本地开源源码仓库，不包含远程部署、账号托管或云端服务。
- 登录、积分、设备授权信息和运行状态都通过本地 Dreamina CLI 驱动。
- 更多实现细节可继续参考 [docs/technical-overview.md](docs/technical-overview.md) 与 [docs/workflow-json-format.md](docs/workflow-json-format.md)。
- 贡献方式请参考 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
