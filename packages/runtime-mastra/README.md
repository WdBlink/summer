# `@summer/runtime-mastra`

This package is Summer's dependency-isolated Mastra adapter. It does not own
campaign scheduling, campaign state, frame checks, decision policy, or leases.
Those remain Summer core responsibilities. It emits protocol-valid node
attempt receipts to a caller-provided observer. `AppendOnlyReceiptJournal`
provides a durable JSONL sink for that observer: it reloads prior invocations,
treats exact replay as idempotent, and rejects conflicting receipt identities.
It is execution evidence, not a Mastra checkpoint or campaign ledger.

## v0 support matrix

| IR feature | v0 behavior |
| --- | --- |
| `bounded-flow` | Supported |
| Linear success path | Supported |
| One structured fork/join | Supported |
| `join: all` | Supported for that structured fork/join |
| `join: any` | Rejected |
| `node-failed` / decision routing | Rejected |
| `iterative-campaign` | Rejected; execute its bounded child flow instead |
| Non-idempotent writes | Rejected until durable replay guards exist |
| Human-gate suspend/resume | Not represented by v0 |
| Mastra Dynamic Workflow | Supported by `dynamic-agent-workflow@1` for a validated linear mapping/tool graph |

The supported fork branches must each be linear. Ordinary edges use `node-succeeded`; fan-out edges use `always`. Any `write-idempotent` node must carry an explicit idempotency key.

Every Summer node becomes a real Mastra step whose implementation resolves the
exact component executor and input/output schema bindings from the
`ComponentRegistry`. The adapter uses an envelope so intermediate outputs keep
their node identity and receipts survive downstream execution and branch joins.
A node with static `input` receives that value; otherwise a
linear node receives its predecessor output. After `join: all`, the join node
receives an object keyed by branch-tail node ID.

Unsupported structures throw `MastraAdapterError`; the adapter never silently
turns them into a different control flow.

`dynamic-agent-workflow@1` discovers the current Codex model catalog on every
invocation, selects its highest-priority visible model at that model's maximum
supported reasoning effort, and asks it to produce a fresh JSON workflow
definition. Summer validates the definition and worker/model grant before
registering it with `Mastra.addDynamicWorkflow()`. Codex workers may operate in
the granted workspace; MiniMax workers run through the locally configured
Claude-compatible CLI without tools.
