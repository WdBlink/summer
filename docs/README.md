# Summer documentation

[Repository README](../README.md)

Start with [Workflow products (0.1)](workflow-products.md) for native dynamic planning,
reusable releases, checkpoints, research v4 and the offline quantitative loop.
See the [0.1.0 changelog](../CHANGELOG.md) for additions, upgrade notes and limits.

## Getting started

Use Node.js `>=22.13.0` and pnpm `11.2.2`. From the repository root:

```bash
pnpm install
pnpm validate
pnpm --silent summer catalog
```

`catalog` compiles the repository catalog against the active registry and workflow sources. To select a workflow without running it:

```bash
pnpm --silent summer match-intent "generate a literature-grounded research idea"
pnpm --silent summer match-intent "use a dynamic multi-model workflow for this repository task"
```

Matching returns explainable JSON and never starts execution. Before running anything, follow the workflow-specific guide and create its complete typed request:

- [Native research ideation v4](workflow-products.md#native-research-ideation-v4) — requires Idea Spark, `python3`, and `codex`; native branches and suspended-checkpoint resume.
- [Native dynamic planning](workflow-products.md#dynamic-planning) — requires a product brief, a granted host Codex planner and configured worker CLIs; the generated product uses native execution.
- [Offline factor tuning](workflow-products.md#offline-factor-tuning) — composes published experiments with frozen comparison identities; no bundled backtest engine.

Model workflows may invoke providers and write files. Grants validate request shape and declared scope at the application layer; they do not create an OS sandbox.

## Manual

- [Workflow products](workflow-products.md) — native contracts, worked example, publication and recovery.

1. [Core concepts](core-concepts.md) — legacy v1 protocol layers and authority; native development follows ADR 0003.
2. [CLI reference](cli.md) — all commands, JSON output, exit codes, and safe examples.
3. [Legacy research ideation workflow](workflows/research-ideation.md) — shared request contract and provider gates; v3 graph and application-layer resume.
4. [Legacy dynamic agent workflow](workflows/dynamic-agent-workflow.md) — v1 request, graph, worker policy and limitations.
5. [Legacy extension development](extensions.md) — catalog-first v1 component and workflow additions.

## Design and implementation references

- [ADR 0001: one workflow IR and one campaign authority](adr/0001-summer-workflow-v1.md)
- [ADR 0002: capability catalog and extension gate](adr/0002-capability-catalog-and-extension-gate.md)
- [ADR 0003: Mastra-first workflow products](adr/0003-mastra-first-workflow-products.md) — current development direction.
- [Mastra adapter support matrix](../packages/runtime-mastra/README.md)
- [Conformance fixtures](../fixtures/README.md)
- [Historical extension proposals](../proposals/README.md)
- [Implementation roadmap](roadmap.md)
- [MIT license](../LICENSE)

ADR 0001's first-fixture list is historical decision context, not the current fixture inventory. The files under `proposals/` are also historical and intentionally fail against the current catalog digest.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build all TypeScript project references |
| `pnpm typecheck` | Type-check without pretty output |
| `pnpm test` | Run the Vitest suite once |
| `pnpm skill:validate` | Validate the repository-owned Summer Skill |
| `pnpm validate` | Run type checking, tests, and Skill validation |

For workflow, catalog, matching, execution, resume, and extension commands, see the [CLI reference](cli.md).
