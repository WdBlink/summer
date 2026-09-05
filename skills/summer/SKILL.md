---
name: summer
description: Select, execute, verify and publish reusable Summer workflow products; use native dynamic planning for new tasks and registered components for extensions.
---

# Summer

Summer is a thin interaction layer over a Mastra-native workflow product library.
The runtime owns execution state and acceptance. Do not keep a Skill-owned cursor,
manually advance research stages, rewrite receipts, or infer authority from task text.

## Locate and discover

Locate the repository (normally /Users/wdblink/summer), then inspect real capabilities:

```bash
SUMMER_REPO=/absolute/path/to/summer
pnpm --silent --dir "$SUMMER_REPO" summer catalog
pnpm --silent --dir "$SUMMER_REPO" summer match-intent "the user's request"
pnpm --silent --dir "$SUMMER_REPO" summer contracts
```

Read both legacy catalog results and the new `products` / `nativeWorkflows` fields.
A fixture is not executable. Matching recommends capabilities; it does not authorize
execution. Published definitions are pinned by exact version for each run.

## Route the request

- Prefer a published product whose stated purpose, inputs and acceptance fit.
- For new research ideation, prefer explicit `research-ideation@4`; preserve v3
  for existing v3 runs. Read [references/research-ideation.md](references/research-ideation.md).
- If the user explicitly asks for dynamic planning, or no specialized workflow fits
  but registered tools suffice, use native `summer dynamic`.
- If a required executor is absent, describe the missing component and design an
  extension. Dynamic planning cannot invent an executor.
- Preserve ambiguity when multiple candidates fit; explain the distinction and ask.
  Keyword scores are retrieval evidence, not semantic confidence.
- Never automatically fall back from a failed specialized workflow to an unrestricted
  agent chain or silently weaken provider/acceptance rules.

For native product execution, planning, promotion, verification, publication or
recovery, read [references/workflow-products.md](references/workflow-products.md).
Use `summer contracts` as the source for exact schemas.

## Reuse and productize

```bash
pnpm --silent --dir "$SUMMER_REPO" summer run-product product-id@1 request.json
pnpm --silent --dir "$SUMMER_REPO" summer dynamic brief.json request.json
pnpm --silent --dir "$SUMMER_REPO" summer status /absolute/run-dir
pnpm --silent --dir "$SUMMER_REPO" summer promote /absolute/run-dir candidate.json
pnpm --silent --dir "$SUMMER_REPO" summer verify /absolute/draft.json suite.json
pnpm --silent --dir "$SUMMER_REPO" summer publish /absolute/draft.json
```

A satisfied user can request promotion. Parameterize task-specific content, remove
private literals and undocumented manual interventions, preserve acceptance, and
present the draft changes. One success creates a candidate, not a release.
Verification executes real tools and needs appropriately scoped grants. Publish only
when requested, after verification; local publication does not authorize git push.

## Boundaries

- A grant must reflect the user's request, scope, providers and actual authority.
  It is not an OS sandbox. Do not manufacture approval for a blocked operation.
- Codex host workers require explicit `allowUnrestrictedHostWorker` opt-in; hidden
  descendant calls are not strictly counted. MiniMax workers have no tools.
- Pause/resume uses native checkpoints and fresh grants. Unknown host write effects
  require reconciliation; never recreate the plan on resume.
- Fixed graphs may contain parameterized branches and bounded loops. Fixed means
  stable contracts, not identical model text.
- The offline quant loop needs published experiment products and frozen evidence
  identities. It has no bundled Vibe-Trading backtest adapter, live trading, or
  autonomous candidate optimizer. Do not present synthetic tests as factor evidence.
- Never register or forward an OPC compatibility alias.

## Secondary development and legacy support

Use existing registered primitives first. Native products use `summer.product/v2`
and `validate-product`; adding a primitive requires its executor, exact ID, scope/
effect handling, schema and failure tests together. Do not introduce generated code
into a serialized graph.

Legacy v1 compiler or extension work still uses
[references/extensions.md](references/extensions.md),
[references/matching.md](references/matching.md) and
[references/protocol.md](references/protocol.md).
Legacy dynamic requests use
[references/dynamic-agent-workflow.md](references/dynamic-agent-workflow.md).
Do not apply v1 DAG assumptions to native v2 products or migrate old runs implicitly.
