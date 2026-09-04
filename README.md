# Summer

Summer is a protocol-first orchestrator for agent workflows that need to be inspected before they run. Workflows are versioned JSON, components and schemas are exact-version references, compilation is deterministic, and runtimes must prove their bindings instead of interpreting an underspecified graph.

The repository is a TypeScript/pnpm monorepo marked private for package publishing. It currently runs two bounded workflows through the Mastra v0 adapter; the iterative-campaign core remains a model-free, in-memory fixture.

## Why Summer

- **Inspect before execution.** `summer.workflow/v1` sources compile to `summer.compiled-workflow/v1` only after graph, effect, retry, join, policy, schema, and registry checks pass.
- **Discover without dispatching.** The compiled catalog and matcher explain candidates, capability gaps, runtime support, and dispatchability without starting a run.
- **Fail closed at runtime.** Execution resolves the exact descriptors, schemas, executors, and registry digest captured by compilation.
- **Keep authority explicit.** Bounded flows belong to runtime adapters. Campaign transitions and terminal decisions belong to the Summer campaign ledger and decision policy.

## Current status

The current catalog contains 27 component entries: 7 `available` and 20 `fixture`. Its two available, dispatchable bounded flows are:

| Workflow | Purpose | Entry input → `result.current` | Resume |
| --- | --- | --- | --- |
| `research-ideation@3` | Run the canonical Idea Spark stages with explicit provider gates and bounded retries | `summer.research-ideation-request/v2` → `summer.research-ideation-result/v2` | Typed application-layer resume |
| `dynamic-agent-workflow@1` | Generate and validate an invocation-specific linear worker graph, then run bounded Codex/MiniMax workers | `summer.dynamic-task-request/v1` → `summer.dynamic-task-result/v1` | Not supported |

`available` means that catalog, workflow, runtime, schema, and executor bindings compile. It does not prove live provider credentials or guarantee that a model-generated plan will validate.

`summer-core-v0` is fixture-only: it has no executor bindings and uses an in-memory campaign ledger. There is no durable workflow checkpoint, durable campaign store, lease fencing, scheduler, campaign worker, or human-gate suspension.

## Quick start

Requires Node.js `>=22.13.0` and pnpm `11.2.2`.

```bash
pnpm install
pnpm validate
pnpm --silent summer catalog
pnpm --silent summer match-intent "generate a literature-grounded research idea"
```

The CLI prints one JSON value per invocation. Matching is read-only; running a workflow invokes local model tooling and writes under the request's absolute `runDir`.

### Research ideation example

Create a request using the complete [`summer.research-ideation-request/v2` example](docs/workflows/research-ideation.md#request-and-execution-grant), update its paths, grant ID, and active timestamps, then run:

```bash
pnpm --silent summer run research-ideation /absolute/path/to/request.json
```

This workflow requires Idea Spark's `SKILL.md` and `scripts/run.py`, plus `python3` and `codex`. Only this workflow exposes application-layer resume:

```bash
pnpm --silent summer resume research-ideation /absolute/path/to/run-dir /absolute/path/to/fresh-grant.json
```

### Dynamic agent example

For a bounded repository task such as inspection, implementation, and review, create the complete [`summer.dynamic-task-request/v1` example](docs/workflows/dynamic-agent-workflow.md#request), update its paths, grant ID, active timestamps, providers, models, and worker budget, then run:

```bash
pnpm --silent summer run dynamic-agent-workflow /absolute/path/to/request.json
```

The planner uses the highest-priority visible model according to the host Codex catalog. Generated mapping/tool graphs must alternate, end in a worker, and stay within `maxWorkerCalls` (`1`–`16`).

## Architecture

```text
workflow JSON -> protocol validation -> exact-version registry -> compiler -> compiled IR
catalog + compiled IR -------------------------------------------> explainable match
compiled bounded flow + typed input -> Mastra adapter -> executors -> local receipts
compiled iterative campaign --------> SummerCore -> in-memory ledger (fixture only)
```

The main package boundaries are:

| Package | Responsibility |
| --- | --- |
| `packages/protocol` | Serializable workflow, catalog, event, and receipt contracts |
| `packages/components` | Versioned descriptors, schemas, executors, and registry |
| `packages/compiler` | Static compilation and semantic digests |
| `packages/catalog` | Capability discovery, matching, and extension validation |
| `packages/runtime-mastra` | Bounded-flow runtime adapter and receipt journal |
| `packages/core` | Campaign reducer, ledger interface, and campaign-only facade |
| `packages/research-ideation` | Executable Idea Spark component pack |
| `packages/cli` | JSON command-line interface |

Core invariants:

- Serialized workflows contain no functions or arbitrary source code.
- Nodes bind exact component versions; multiple incoming edges require `join: all` or `join: any`.
- Runtime bindings must match the compiled descriptors, schemas, executors, and `registryDigest`.
- Only a compiler-verified `iterative-campaign` may be started by `SummerCore`; bounded flows run through adapters.
- Frame checks produce evidence; only the decision policy may commit a campaign transition.

See [Core concepts and boundaries](docs/core-concepts.md) for the complete authority, runtime, safety, and persistence model.

## Runtime boundaries

Mastra v0 supports success-only linear bounded flows and one structured fork with linear branches converging at `join: all`. It rejects campaigns, `join: any`, failure routes, human suspension, multiple fan-outs, and non-idempotent writes.

Execution grants are typed application-level validation envelopes, not OS sandboxes. Research Codex processes start in `runDir`; dynamic Codex workers start in `workspaceDir`; both use `--approve-for-me`. Host process and filesystem permissions remain authoritative.

Every outer node attempt produces `summer.node-receipt/v1`. The run-local `.summer/receipts.jsonl` survives process exit and rejects conflicting duplicate receipt IDs, but it is not a runtime checkpoint or campaign ledger. Research resume reconstructs a new invocation from verified artifacts; dynamic workflow resume is unsupported. Dynamic worker records live separately in `.summer/dynamic-worker-receipts.jsonl`.

## Development

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm skill:validate
pnpm validate
```

`pnpm validate` runs type checking, the test suite, and Skill validation. See the [CLI reference](docs/cli.md) for all nine commands and their exit behavior.

## Documentation

- [User manual and getting started](docs/README.md)
- [Core concepts, architecture, and boundaries](docs/core-concepts.md)
- [CLI reference](docs/cli.md)
- [Research ideation workflow](docs/workflows/research-ideation.md)
- [Dynamic agent workflow](docs/workflows/dynamic-agent-workflow.md)
- [Extension development](docs/extensions.md)
- [ADR 0001: workflow IR and campaign authority](docs/adr/0001-summer-workflow-v1.md)
- [ADR 0002: catalog and extension gate](docs/adr/0002-capability-catalog-and-extension-gate.md)
- [Mastra adapter support matrix](packages/runtime-mastra/README.md)
- [Implementation roadmap](docs/roadmap.md)

## License

[MIT](LICENSE) © 2026 WdBlink.
