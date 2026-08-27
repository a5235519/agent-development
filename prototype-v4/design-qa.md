# Design QA — Agent Workbench V4 Interaction Optimization

source visual truth path: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/audit-01-workspace-before.png`

implementation screenshot path: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/audit-06-workspace-after.png`

comparison evidence: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/qa-comparison-v3.png`

viewport: 1280 × 720 CSS px

source pixels: 1280 × 720; implementation pixels: 1280 × 720; CSS viewport: 1280 × 720; deviceScaleFactor: 1; density normalization: none required.

state: EP01 / 分镜准备 / S13 缺失；优化前后均为深色制作工作区。优化后有意增加任务目标条，并保留默认图片 Inspector。

## Full-view comparison

- Information architecture: intentional change. Current blocker and minimum repair action move from the low-salience bottom strip into a persistent task bar.
- Layout rhythm: stage rail, infinite canvas and right Inspector remain aligned to the source shell. The new task bar uses existing panel, border, radius and type tokens.
- Fonts and typography: Inter + Noto Sans SC preserved; hierarchy remains compact. New task title is 12 px/600 and does not compete with project or node titles.
- Colors and tokens: existing blue action, red failure, green pass, amber warning and dark panel tokens are reused.
- Image quality: all visible images use the original generated raster assets; no placeholder, CSS drawing or handcrafted SVG was introduced.
- Copy/content: new copy names the blocking Gate, repair scope, original Run snapshot, automatic Validator rerun and AI-inference confirmation rule.

## Focused region comparisons

- Asset/script Inspector: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/audit-07-script-after.png` verifies image, structured script and continuity views share one context.
- Repair preflight: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/audit-08-repair-after.png` verifies S13-only scope and automatic coverage recheck.
- Admin overview: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/audit-09-admin-overview-after.png` verifies management navigation lands on real content.
- Skill gate: `/Users/dandan/Documents/work/:/AI/agent-development/prototype-v4/audit-10-skill-gate-after.png` verifies unconfirmed inference blocks the next step.

## Comparison history

### Iteration 1

- P1: Default full-canvas mode removed the large direct image preview, conflicting with the core asset-review scenario.
- Fix: restored `ARTIFACT_COLLECTION` Inspector as the default state while retaining the task-first bar.
- Post-fix evidence: `audit-06-workspace-after.png` shows current goal, node graph and a readable image preview at the same time.

### Iteration 2

- No actionable P0/P1/P2 visual or interaction issues found in the tested 1280 × 720 states.
- Remaining P3: very small text inside zoomed-out nodes is expected at fit-view scale; node details remain available through selection and Inspector.

## Primary interactions tested

- Open multi-asset modal and inspect role/duplicate analysis.
- Open artifact Inspector; switch image → corresponding script → continuity.
- Open S13-only repair preflight.
- Switch production/admin workspaces and navigate to management overview.
- Run Skill static analysis; verify next step disabled at 0/2 and enabled at 2/2 confirmations.

## Browser console

- No runtime errors observed.
- One React Flow hot-module-reload warning remained in retained dev logs; `nodeTypes` is already defined outside the component and the warning did not recur after source stabilization.

## Follow-up polish

- P3: verify 200% browser zoom and screen-reader labels in a dedicated accessibility pass.
- P3: test node legibility and task-bar wrapping below the current 1180 px minimum desktop width.

final result: passed
