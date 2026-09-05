# Summer documentation

[Repository README](../README.md)

This manual covers the repository as it exists now: two executable bounded workflows, a JSON CLI, a strict workflow/catalog protocol, and an in-memory campaign-core fixture.

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

- [Research ideation](workflows/research-ideation.md) — requires Idea Spark, `python3`, and `codex`; supports typed application-layer resume.
- [Dynamic agent workflow](workflows/dynamic-agent-workflow.md) — requires the host Codex model catalog and the configured local worker CLIs; no resume.

Both workflows invoke models and may write files. Their grants validate request shape and declared scope at the application layer; they do not create an OS sandbox.

## Manual

1. [Core concepts](core-concepts.md) — protocol layers, authority, invariants, architecture, safety, and persistence.
2. [CLI reference](cli.md) — all commands, JSON output, exit codes, and safe examples.
3. [Research ideation workflow](workflows/research-ideation.md) — request contract, graph, gates, retries, artifacts, and resume.
4. [Dynamic agent workflow](workflows/dynamic-agent-workflow.md) — request contract, generated graph, worker policy, artifacts, and limitations.
5. [Extension development](extensions.md) — catalog-first component and workflow additions.

## Design and implementation references

- [ADR 0001: one workflow IR and one campaign authority](adr/0001-summer-workflow-v1.md)
- [ADR 0002: capability catalog and extension gate](adr/0002-capability-catalog-and-extension-gate.md)
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
