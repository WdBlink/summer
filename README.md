# Summer

Summer is a protocol-first workflow orchestrator for bounded agent tasks and iterative research campaigns.

The project is an independent implementation inspired by useful Flow/Loop ideas in OPC and by artifact-first workflow engineering. It is not an OPC fork, replacement command, or compatibility layer.

## Status

Summer now has its first executable bounded Flow: `research-ideation@2`, a typed Mastra wrapper around ResearchStudio Idea Spark's canonical navigator. It includes production executor/schema bindings, six isolated execution stages, terminal artifact verification, and a `NodeReceipt` for every Mastra node. The factor workflows remain conformance fixtures. Durable campaign storage, a campaign daemon, scheduler, human-gate suspension, and live trading are not implemented.

## Architectural invariants

- `bounded-flow` and `iterative-campaign` use the same `summer.workflow/v1` source contract and compile to `summer.compiled-workflow/v1`.
- A campaign ledger is the sole authority for research state and terminal decisions.
- Child runs may own local execution state but never a second campaign cursor, posterior, or terminal state.
- Components use exact version references and closed, typed transitions; arbitrary JavaScript is not part of serialized workflows.
- Nodes with multiple incoming edges declare `join: all` or `join: any`; the compiler never guesses whether arrivals synchronize.
- Frame checks produce evidence. A decision policy is the only component allowed to commit the next campaign edge.
- Runtime-specific types remain behind adapters.

## Workspace

```text
packages/protocol        Serializable contracts and receipts
packages/components      Versioned component and schema registry
packages/compiler        Static workflow compiler and invariant checks
packages/catalog         Capability catalog, matching, and extension validation
packages/core            Event reducer, campaign ledger, and public facade
packages/runtime-mastra  Mastra adapter boundary
packages/research-ideation  Executable Idea Spark component pack
packages/cli             Stable command-line entrypoint
skills/summer            Thin Codex skill
catalog                  Discoverable workflow/component/runtime metadata
fixtures                  Model-free conformance inputs
```

## Development

Requires Node.js 22.13 or newer and pnpm 11.

```bash
pnpm install
pnpm validate
pnpm --silent summer fixtures
pnpm --silent summer catalog
pnpm --silent summer match-intent "生成经过审计的研究构思"
pnpm --silent summer compile workflows/research-ideation.v2.json
pnpm --silent summer run research-ideation /absolute/path/to/request.json
```

`validate` checks the strict source contract. `compile` additionally resolves the repository exact-version registry and checks graph, effect, retry, join, campaign-policy, and terminal-path invariants. The semantic digests are deterministic; `compiledAt` is observational, does not participate in `compiledDigest`, and may differ between compilations.

The Mastra v0 adapter executes linear bounded flows and one structured `fork → join: all`. It deliberately rejects campaign control, `join: any`, failure routing, human suspension, and non-idempotent writes instead of weakening their semantics. See [`packages/runtime-mastra/README.md`](packages/runtime-mastra/README.md).

The CLI exposes `catalog`, `match-intent`, typed `match`, `run`, and `extension-check` in addition to `validate`, `compile`, and `fixtures`. Matching is deterministic and explainable; it reports ambiguity, capability gaps, and whether a result is actually dispatchable. An `available` component now fails catalog compilation unless its runtime, executor, and schema bindings really exist.

`extension-check` forces secondary development through the same catalog, exact-version schemas, component descriptors, permission/effect contracts, runtime validators, and conformance fixtures. A valid proposal is design input, not an installed component. The Mastra adapter emits node receipts but is not wired to the campaign ledger. `SummerCore.start()` accepts only verified `iterative-campaign` manifests; bounded flows execute directly through a runtime adapter.

See [the research-ideation Flow guide](docs/workflows/research-ideation.md) for its request contract, execution boundary, resume behavior, and dependencies.

See [ADR 0001](docs/adr/0001-summer-workflow-v1.md) for the unified workflow protocol and [ADR 0002](docs/adr/0002-capability-catalog-and-extension-gate.md) for controlled matching and secondary-development boundaries.
