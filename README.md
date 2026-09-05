# Summer

Summer turns repeatable agent work into versioned workflow products. A thin Skill helps you choose a workflow; Mastra executes registered components; artifact checks decide whether the result is acceptable. Successful dynamic runs can become reviewed drafts, validated releases, and reusable workflows.

Version 0.1.0 adds a Mastra-native product path alongside legacy v1 compatibility. See the [release changelog](CHANGELOG.md) for additions and limits, or start with the [workflow product guide](docs/workflow-products.md). Packages are not published to npm; source licensing is MIT.

## Why Summer

Use Summer when an agent task should become a repeatable, inspectable workflow instead of a growing prompt or an improvised script.

- **Turn successful runs into reusable products.** Review a parameterized draft, verify it on new inputs and failure cases, then explicitly publish an immutable version.
- **Plan new tasks within known capabilities.** The host-preferred Codex planner can build a bounded workflow using registered Codex, MiniMax and file tools.
- **Check deliverables, not just process exits.** Declared artifact checks decide acceptance separately from model output.
- **Resume with explicit boundaries.** Mastra owns checkpoints and control flow; Summer owns grants, acceptance and publication. Unknown shell effects require reconciliation.
- **Discover without dispatching.** Catalog and matching expose native workflows, published products and legacy capabilities without starting a run.

## Current status

| New capability | Entry point | Boundary |
| --- | --- | --- |
| Native dynamic planning | `summer dynamic <brief> <request>` | Registered tools, frozen acceptance, granted host-preferred planner |
| Reusable workflow products | `run-draft`, `promote`, `verify`, `publish`, `run-product` | Explicit publication; immutable versions |
| Durable native execution | `resume-product`, `recover-product` | LibSQL checkpoints; unknown shell effects never automatically replayed |
| Native research ideation v4 | `summer run research-ideation@4 <request>` | Native conditions/retries; retains Idea Spark compatibility adapter |
| Offline factor tuning | `quant-loop`, `quant-resume` | Published experiment workflows; no live trading or holdout optimization |

The quant loop is a control-policy implementation, not a validated backtest engine. No Vibe-Trading adapter or real-factor performance claim is bundled. Arbitrary host workers require explicit scope-risk opt-in; direct-call budgets do not bound hidden descendants.

### Legacy compatibility

The current catalog contains 27 component entries: 7 `available` and 20 `fixture`. Its two available, dispatchable bounded flows are:

| Workflow | Purpose | Entry input → `result.current` | Resume |
| --- | --- | --- | --- |
| `research-ideation@3` | Run the canonical Idea Spark stages with explicit provider gates and bounded retries | `summer.research-ideation-request/v2` → `summer.research-ideation-result/v2` | Typed application-layer resume |
| `dynamic-agent-workflow@1` | Generate and validate an invocation-specific linear worker graph, then run bounded Codex/MiniMax workers | `summer.dynamic-task-request/v1` → `summer.dynamic-task-result/v1` | Not supported |

`available` means that catalog, workflow, runtime, schema, and executor bindings compile. It does not prove live provider credentials or guarantee that a model-generated plan will validate.

`summer-core-v0` remains fixture-only. Legacy v1 workflows do not gain native checkpoints through an implicit migration. The new v2 product path supports native persistence and explicit human approval; there is no distributed scheduler or trading executor.

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
pnpm --silent summer run research-ideation@4 /absolute/path/to/request.json
```

This workflow requires Idea Spark's `SKILL.md` and `scripts/run.py`, plus `python3` and `codex`. Version 4 uses native branches and checkpoints; resume a suspended run with a fresh grant:

```bash
pnpm --silent summer resume research-ideation@4 /absolute/path/to/run-dir /absolute/path/to/fresh-grant.json
```

### Dynamic agent example

For a new bounded task, create a [native product brief and request](docs/workflow-products.md#dynamic-planning). Declare inputs, acceptance, providers, models and budget before planning:

```bash
pnpm --silent summer dynamic /absolute/path/to/brief.json /absolute/path/to/request.json
```

The planner uses the highest-priority visible model according to the host Codex catalog at its highest supported effort; its exact model must be granted. Live generation uses a finite mapping/tool sequence. Authored products also support native branches, parallel steps and bounded loops. Codex workers require explicit host-scope opt-in; MiniMax workers have no tools.

Existing unversioned `run research-ideation` and `run dynamic-agent-workflow` commands still select legacy paths. Use the explicit native commands above for new work; old runs are never silently migrated.

## Architecture

```text
Skill -> catalog / published products -> typed request + grant
dynamic plan or published definition -> native Mastra graph -> tools -> artifact acceptance
accepted dynamic run -> reviewed draft -> verification -> immutable publication -> reuse

legacy workflow/v1 -> legacy compiler / adapter (compatibility only)
```

The main package boundaries are:

| Package | Responsibility |
| --- | --- |
| `packages/protocol` | Serializable workflow, catalog, event, and receipt contracts |
| `packages/components` | Versioned descriptors, schemas, executors, and registry |
| `packages/compiler` | Static compilation and semantic digests |
| `packages/catalog` | Capability discovery, matching, and extension validation |
| `packages/runtime-mastra` | Native product execution, planning, publication, quant policy and legacy adapter |
| `packages/core` | Legacy campaign reducer, ledger interface, and campaign-only facade |
| `packages/research-ideation` | Idea Spark component pack, native v4 and legacy compatibility |
| `packages/cli` | JSON command-line interface |

Legacy v1 invariants (new product boundaries are in the [product guide](docs/workflow-products.md)):

- Serialized workflows contain no functions or arbitrary source code.
- Nodes bind exact component versions; multiple incoming edges require `join: all` or `join: any`.
- Runtime bindings must match the compiled descriptors, schemas, executors, and `registryDigest`.
- Only a compiler-verified `iterative-campaign` may be started by `SummerCore`; bounded flows run through adapters.
- Frame checks produce evidence; only the decision policy may commit a campaign transition.

See [ADR 0003](docs/adr/0003-mastra-first-workflow-products.md) and the [product guide](docs/workflow-products.md) for current boundaries. [Core concepts](docs/core-concepts.md) documents the legacy v1 model.

## Runtime boundaries

The following paragraphs describe legacy v1 paths only. See the product guide for native v2 grants, checkpoints, failed-effect handling and receipts. Nonempty model text alone never proves a v2 product's acceptance.

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

`pnpm validate` runs type checking, the test suite, and Skill validation. See the [CLI reference](docs/cli.md) for native and legacy commands and their exit behavior.

## Documentation

- [User manual and getting started](docs/README.md)
- [Changelog and upgrade notes](CHANGELOG.md)
- [Native workflow products](docs/workflow-products.md)
- [Core concepts, architecture, and boundaries](docs/core-concepts.md)
- [CLI reference](docs/cli.md)
- [Research ideation workflow](docs/workflows/research-ideation.md)
- [Dynamic agent workflow](docs/workflows/dynamic-agent-workflow.md)
- [Extension development](docs/extensions.md)
- [ADR 0001: workflow IR and campaign authority](docs/adr/0001-summer-workflow-v1.md)
- [ADR 0002: catalog and extension gate](docs/adr/0002-capability-catalog-and-extension-gate.md)
- [ADR 0003: Mastra-first workflow products](docs/adr/0003-mastra-first-workflow-products.md)
- [Mastra adapter support matrix](packages/runtime-mastra/README.md)
- [Implementation roadmap](docs/roadmap.md)

## License

[MIT](LICENSE) © 2026 WdBlink.
