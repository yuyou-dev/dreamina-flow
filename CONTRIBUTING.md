# Contributing

## Local Setup

```bash
npm install
npm run ci:verify
```

日常开发使用：

```bash
npm run dev
```

默认开发端口是：

- Web: `3000`
- API: `3100`

提交变更前请先确认这两个端口空闲。

## Pull Request Expectations

- 尽量把改动控制在单一边界内
- 保持 `workflow-core` 的中性抽象，不把 Dreamina 细节泄漏进去
- Dreamina 相关逻辑放在 `dreamina-adapter`
- 当公共行为、仓库工作流或上手流程变化时，同步更新文档

## Verification Before Review

提交 PR 前请至少运行一次：

```bash
npm run ci:verify
```

如果改动涉及 UI、CLI 或示例 workflow，请补充手动验证说明或截图。

## Reporting Issues

请优先使用 issue templates 提交 bug 和 feature request，方便附带复现步骤、workflow JSON 和运行环境信息。
