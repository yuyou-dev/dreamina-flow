# Workflow JSON Format

## 顶层结构

```json
{
  "schema": "workflow.document/v1alpha1",
  "version": 1,
  "meta": {},
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [],
  "edges": [],
  "groups": []
}
```

## 设计原则

- 作者态优先，不保存运行结果
- 可读、可 diff、可手写
- 多输入句柄显式保存 `order`
- 保留 `meta.requirements`、`groups`、`viewport`

## 节点分类

- `input`
- `processor`
- `output`

## 不落盘内容

- `execution.status`
- `submitId`
- `runId`
- `artifacts`
- `error`
- `result`

## 文件名

导出文件统一使用 `.workflow.json` 后缀。
