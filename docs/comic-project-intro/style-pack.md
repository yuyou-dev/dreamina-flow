# Workflow Studio OSS Comic Style Pack

## Visual Direction

- Ratio: `16:9` for every final page
- Language: Simplified Chinese
- Mood: editorial comic board, playful technical walkthrough, clean but dense
- Reference cues from `style-ref/style-reference.jpg`: oversized cobalt-blue typography, pale gray background, rounded white panels, collage layout, sticker-like callouts, halftone texture, bold subject in the foreground
- Do not mimic the reference brand, logo, or characters directly

## Characters

- Character A: `布布`
  - Role: workflow host / repo guide
  - Look: round plush mascot inspired by the repo's black-outline logo language, cream-white body, bold cobalt accessories, energetic gestures
  - Props: mini workflow cards, file tabs, neon connectors
- Character B: `阿流`
  - Role: adapter engineer / CLI operator
  - Look: short-haired engineer in mint jacket and cobalt headset, carries a terminal tablet and device-login card
  - Props: verification URL ticket, user-code badge, terminal window, arrows showing request flow

## Background Language

- Use cream, pale gray, mint, and cobalt as the base palette
- Keep black outlines and rounded borders similar to the repo UI language
- Mix UI fragments, architecture arrows, badges, and stickers into one board
- Prefer one dominant foreground object per page and 3-5 supporting info blocks

## Typography

- Large, clean, legible Simplified Chinese
- Bold editorial titles, smaller caption blocks, short file badges
- Avoid long code snippets; use file paths, route labels, and command badges instead

## Grounding Facts

- Project name: `Workflow Studio OSS`
- Core layers:
  - `packages/workflow-core`
  - `packages/dreamina-adapter`
  - `apps/studio-api`
  - `apps/studio-web`
- Key commands:
  - `npm install`
  - `npm run dev`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
- Key routes:
  - `GET /api/capabilities`
  - `GET /api/adapter/status`
  - `POST /api/adapter/login`
  - `POST /api/nodes/:type/run`
  - `POST /api/flows/run`
  - `GET /api/tasks/:submitId`
- Login flow facts:
  - `dreamina login --headless`
  - `dreamina relogin --headless`
  - `dreamina login checklogin --device_code=... --poll=0`
  - UI reads `verification_uri`, `user_code`, and `device_code`
  - blocked action resumes after login succeeds

## Asset List

- `character-sheet.png`
- `page-01-cover.png`
- `page-02-architecture.png`
- `page-03-login-flow.png`
- `page-04-workflow-run.png`
- `contact-sheet.png`
