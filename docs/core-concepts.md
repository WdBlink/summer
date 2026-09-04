# Core concepts

[Documentation](README.md) · [Repository README](../README.md)

Summer separates portable workflow meaning from runtime execution. The compiler, catalog, core, and adapters each have one authority boundary; none is allowed to silently reinterpret another layer.

## Protocol and compilation

A source workflow is strict `summer.workflow/v1` JSON with one of two profiles:

- `bounded-flow` is a finite graph executed through a compatible runtime adapter.
- `iterative-campaign` is a campaign topology whose cross-round state and decisions belong to Summer Core.

Compilation resolves every exact component and schema version, validates the graph and profile invariants, and emits `summer.compiled-workflow/v1`. `sourceDigest`, `registryDigest`, and `compiledDigest` bind the source and resolved registry subset. `compiledAt` is observational and is excluded from `compiledDigest`.

Conditions are a closed tagged union: `always`, `node-succeeded`, `node-failed`, and `decision-is`. Nodes with multiple incoming edges must explicitly choose `join: all` or `join: any`; the compiler does not infer synchronization.

Serialized workflows contain data, not executable functions. Component executors stay in the registry and runtime layer.

## Catalog, registry, and matching

The component registry is authoritative for schema descriptors, component descriptors, permissions, effects, and executor bindings. The catalog is a discoverability index compiled against that registry and the referenced workflows.

Catalog matching applies hard capability, profile, component-kind, and runtime filters before ranking text evidence. It reports reasons, blockers, ambiguity, and dispatchability. It never runs a workflow.

An `available` workflow proves that its current catalog, workflow, runtime, schema, and executor bindings compile. It does not prove provider credentials or guarantee valid output from a live model planner.

The current catalog contains 27 component entries: 7 `available` and 20 `fixture`. Only `research-ideation@3` and `dynamic-agent-workflow@1` are available bounded flows on `mastra-v0`. `summer-core-v0` is fixture-only and has no executor bindings.

## Authority and invariants

- Components bind exact versions and declare their input/output schemas, effects, permissions, and fan-out support.
- The compiler validates structure, terminal reachability, joins, retries, effects, schema compatibility, and campaign policy topology before a runtime sees the graph.
- Runtime adapters must resolve executors and schema bindings whose descriptors and registry subset match the compiled `registryDigest`.
- `SummerCore.start()` accepts only an active-registry recompilation of a compiler-verified `iterative-campaign`.
- Child bounded runs may own a local cursor and terminal result. They may not own the campaign cursor, posterior, cross-round backlog, or campaign terminal state.
- Frame checks emit evidence. Only the decision policy can commit the next campaign edge.

## Execution paths

```text
source workflow -> protocol parser -> compiler + exact registry -> compiled workflow
                                                            |
                         bounded-flow -> runtime adapter ----+
                 iterative-campaign -> Summer Core + ledger -+
```

The Mastra v0 adapter executes only success-path bounded flows. It supports a linear graph or one structured fork whose branches are linear and converge at `join: all`. It rejects:

- `iterative-campaign` profiles;
- `join: any` and failure/decision routes;
- more than one fan-out;
- human-gate suspension;
- non-idempotent writes.

An idempotent write must have an explicit idempotency key. See the [adapter support matrix](../packages/runtime-mastra/README.md).

The dynamic workflow has two levels. Its outer Summer graph is one node. That component asks the highest-priority visible model according to the host Codex catalog for an invocation-specific Mastra definition, validates the linear alternating mapping/tool graph and worker budget, then registers and runs it. The generated graph is not another serialized Summer workflow.

## Safety boundary

Workflow inputs contain typed execution grants. These are application-level validation envelopes, not OS sandboxes or guaranteed filesystem/network access controls.

For `research-ideation@3`, grant paths must match the request, all required permissions must be declared, and network/provider policies are validated. The grant is rechecked before privileged stages, and stage processes receive an expiry-bound abort signal. Research Codex processes start in `runDir` with `--approve-for-me`; host permissions may allow access beyond that directory.

For `dynamic-agent-workflow@1`, request/grant paths, permissions, providers, model allowlists, and `maxWorkerCalls` are validated. Grant activity is checked when `runDynamicTask` begins, not again before each worker. Codex workers start in `workspaceDir` with `--approve-for-me`. MiniMax workers use the configured Claude-compatible CLI with tools disabled. These launch settings do not replace host isolation.

## Persistence and resume

Every outer Summer node attempt emits `summer.node-receipt/v1`. The CLI appends these receipts to `<runDir>/.summer/receipts.jsonl`. Existing exact receipts are idempotent; a conflicting duplicate `receiptId` fails. The file survives process exit, but it is execution evidence—not a Mastra checkpoint, workflow cursor, or campaign ledger.

`research-ideation@3` also persists an immutable digest-bound request manifest, invocation grants, navigator/domain artifacts, provider-status evidence, and heartbeats. Its `resume` command verifies those artifacts and starts a new invocation with a fresh grant. This is artifact/navigator-driven application resume, not checkpoint resume.

`dynamic-agent-workflow@1` stores its generated planner schema and workflow under `<runDir>/.summer/dynamic/<run-id>/`. Worker outputs are appended separately to `<runDir>/.summer/dynamic-worker-receipts.jsonl`; they are not outer `summer.node-receipt/v1` records. Dynamic workflow resume is unsupported.

The current campaign ledger is in memory. There is no durable campaign storage, lease fencing, scheduler, or campaign worker.

