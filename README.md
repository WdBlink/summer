# Summer

Summer is a protocol-first workflow orchestrator for bounded agent tasks and iterative research campaigns.

The project is an independent implementation inspired by useful Flow/Loop ideas in OPC and by artifact-first workflow engineering. It is not an OPC fork, replacement command, or compatibility layer.

## Status

Summer is at the walking-skeleton stage. The first milestone freezes one serializable workflow source format and one compiled IR, deterministic semantic digests, an append-only in-memory campaign ledger, a tested Mastra adapter for bounded child flows, and model-free conformance fixtures. It does not yet provide a production agent catalog, durable database, campaign daemon, scheduler, or live trading system.

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
packages/core            Event reducer, campaign ledger, and public facade
packages/runtime-mastra  Mastra adapter boundary
packages/cli             Stable command-line entrypoint
skills/summer            Thin Codex skill
fixtures                  Model-free conformance inputs
```

## Development

Requires Node.js 22.13 or newer and pnpm 11.

```bash
pnpm install
pnpm validate
pnpm --silent summer fixtures
pnpm --silent summer compile fixtures/workflows/research-ideation.v1.json
```

`validate` checks the strict source contract. `compile` additionally resolves the fixture-only exact-version registry and checks graph, effect, retry, join, campaign-policy, and terminal-path invariants. The semantic digests are deterministic; `compiledAt` is observational, does not participate in `compiledDigest`, and may differ between compilations.

The Mastra v0 adapter executes linear bounded flows and one structured `fork → join: all`. It deliberately rejects campaign control, `join: any`, failure routing, human suspension, and non-idempotent writes instead of weakening their semantics. See [`packages/runtime-mastra/README.md`](packages/runtime-mastra/README.md).

The CLI currently exposes only `validate`, `compile`, and `fixtures`. The fixture registry has schema and component descriptors but no executors. The Mastra adapter is a library boundary: it is not yet wired to the campaign ledger and does not yet emit `NodeReceipt` records. `SummerCore.start()` accepts only verified `iterative-campaign` manifests; bounded flows execute directly through a runtime adapter and cannot be stranded in the campaign ledger.

See [ADR 0001](docs/adr/0001-summer-workflow-v1.md) for the protocol decision and explicit non-goals.
