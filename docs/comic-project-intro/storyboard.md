# Workflow Studio OSS Comic Storyboard

## Page 01

- Goal: explain what the repo is and why it exists
- Visual metaphor: a giant workflow canvas board popping out of a studio table, with the two characters introducing the system
- Grounding facts:
  - repo packages Dreamina CLI into a visual workflow studio
  - supports local editing, import/export, node run, and chain run
  - verified on macOS, Node.js 20+, npm 10+
- Exact text:
  - Title: `把 Dreamina CLI 变成可视化 Workflow Studio`
  - Subtitle: `Workflow Studio OSS 用四层结构，把登录、素材上传、节点运行和结果轮询连成一条可操作链路。`
  - Bubble A: `布布：这里不是演示海报，是能在浏览器里真正跑起来的本地工作台。`
  - Bubble B: `阿流：画布编辑 workflow，底层仍然尊重 Dreamina CLI 的真实语义。`
  - Badge 1: `macOS + Node.js 20+`
  - Badge 2: `Web 3000 / API 3100`
  - Badge 3: `starter workflow 内置`
- Output filename: `page-01-cover.png`

## Page 02

- Goal: visualize the project architecture and explain why it is split into four layers
- Visual metaphor: a four-zone architecture station with arrows moving from browser canvas to API to adapter to Dreamina CLI
- Grounding facts:
  - `workflow-core` owns schema and execution semantics
  - `dreamina-adapter` wraps CLI nodes and auth
  - `studio-api` exposes minimal HTTP routes
  - `studio-web` provides the React Flow canvas
- Exact text:
  - Title: `四层架构，各司其职`
  - Subtitle: `从画布到 CLI，不做黑盒封装，而是把每一层的职责拆开。`
  - Block 1: `1. studio-web：读取 /api/capabilities 与 /api/adapter/status，负责画布编辑、导入导出和运行交互。`
  - Block 2: `2. studio-api：只保留最小 HTTP 面，处理 assets upload、node run、flow run、task poll。`
  - Block 3: `3. dreamina-adapter：发现节点定义、校验参数、发起 login / relogin、查询结果。`
  - Block 4: `4. workflow-core：维护 workflow.document/v1alpha1、运行图解析、多输入顺序和 pending flow 恢复。`
  - Caption: `对应目录：apps/studio-web · apps/studio-api · packages/dreamina-adapter · packages/workflow-core`
- Output filename: `page-02-architecture.png`

## Page 03

- Goal: focus on the new Dreamina OAuth Device Flow login logic
- Visual metaphor: a device-login control room with URL ticket, user code card, device code strip, and an auto-resume arrow back to the canvas
- Grounding facts:
  - adapter starts `dreamina login --headless` or `dreamina relogin --headless`
  - UI reads `verification_uri`, `user_code`, `device_code`
  - backend polls `dreamina login checklogin --device_code=... --poll=0`
  - pending action resumes after login succeeds
- Exact text:
  - Title: `新的登录主线：OAuth Device Flow`
  - Subtitle: `README 现在可以直接从这里切入，因为 Studio 已经跟随新版 Dreamina CLI 调整登录逻辑。`
  - Step 1: `点击账户状态面板，发起 headless login / relogin。`
  - Step 2: `界面展示 verification URL、user code、device code，不再只依赖二维码。`
  - Step 3: `adapter 在后台轮询 dreamina login checklogin，直到本地登录状态刷新成功。`
  - Step 4: `被阻塞的 Run Node / Run Chain 会在登录成功后自动恢复一次。`
  - Footer: `兼容兜底：如果 CLI 仍输出旧 QR 标记，界面会把它作为 fallback 信息显示。`
- Output filename: `page-03-login-flow.png`

## Page 04

- Goal: show the end-to-end workflow authoring and execution loop
- Visual metaphor: a run track from prompt source to generation node to querying state to image preview, with quickstart commands around the border
- Grounding facts:
  - starter canvas ships in the repo
  - users can import `.workflow.json`
  - single node run validates before run
  - chain run submits `nodes + edges + targetNodeId`
  - `/api/tasks/:submitId` polls while status is `querying`
- Exact text:
  - Title: `从 Starter Canvas 到结果回写`
  - Subtitle: `这套仓库适合本地验证完整链路，而不只是看静态 schema。`
  - Block 1: `改 prompt，或上传 resources/workflows/*.workflow.json。`
  - Block 2: `Run Node 先校验，再提交 /api/nodes/:type/run。`
  - Block 3: `Run Chain 把 nodes + edges + targetNodeId 发给 /api/flows/run。`
  - Block 4: `任务仍在处理中时，节点保持 querying，前端继续轮询 /api/tasks/:submitId。`
  - Command Row: `npm install · npm run dev · npm run typecheck · npm run test · npm run build`
  - Closing Banner: `导出的 workflow 只保存作者态，不把 submitId、artifacts、result 落盘。`
- Output filename: `page-04-workflow-run.png`
