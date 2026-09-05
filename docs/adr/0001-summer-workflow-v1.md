# ADR 0001: One workflow IR and one campaign authority

- Status: Accepted
- Native 0.1 direction: [ADR 0003](0003-mastra-first-workflow-products.md) supersedes runtime-neutral expansion; this ADR still describes legacy v1 contracts.
- Date: 2026-09-03

## Context

Flow and Loop are useful user-facing concepts, but implementing them as nested products creates overlapping retry, backlog, cursor, budget, and terminal semantics. Model-generated JavaScript externalizes planning without proving that the plan is valid, comparable, safe, or reproducible.

## Decision

Summer defines one serializable `summer.workflow/v1` source format. `bounded-flow` and `iterative-campaign` are authoring profiles that compile into one `CompiledWorkflowV1` representation.

The compiler resolves exact component versions and performs structural, capability, effect, topology, and profile invariant checks. Conditions are a closed tagged union. Multiple incoming edges require an explicit `all` or `any` join policy. Serialized workflows never contain functions or arbitrary source code.

Summer Core owns the campaign ledger schema, append protocol, reducer, semantic identities, receipts, and terminal rules. A runtime adapter may persist and execute that ledger, but its checkpoint identifiers are opaque operational metadata and cannot decide research semantics.

Only a compiler-verified `iterative-campaign` may open the campaign ledger. Bounded child flows execute through runtime adapters and return bound results; they do not acquire an otherwise unterminatable campaign record.

A child run may have a local node cursor, transient retries, and a child terminal receipt. Only the campaign ledger may own cross-round retry/backlog, the research cursor, posterior updates, or campaign termination.

Frame evaluation is separated from state transition:

```text
FRAME_CHECK -> FrameAssessment -> DECISION_POLICY -> DecisionReceipt -> typed edge
```

Optimizers propose plans or convergence evidence. They cannot commit a transition.

## Runtime choice

Mastra is the first adapter target. LangGraph remains a conformance/fallback target, and DeepSeek Harness remains experimental. No runtime-specific type may appear in protocol, compiler, components, or core packages.

## First conformance fixtures

1. ResearchStudio IdeaSpark as a `bounded-flow` DAG with fan-out, validators, aggregation, and a terminal-receipt component contract.
2. A factor-strategy experiment as a bounded child Flow.
3. A factor-discovery campaign topology with a two-experiment budget and all six typed decision routes.

Model-free core tests, rather than the workflow JSON fixtures themselves, cover a two-generation event history, plan-before-mutation, receipt identity, exact replay, conflicting replay, frame assessment, decision receipts, and typed stop reasons. Durable lease fencing remains a later storage milestone.

## Non-goals for the walking skeleton

- Production model calls or unrestricted code execution
- A database, scheduler, server, UI, or observability platform
- Live trading or real alpha claims
- OPC import, `/opc` aliasing, or migration of OPC state
- LangGraph or DeepSeek production adapters
- Compatibility with private Factor Loop stores or unpublished GenerationPlan schemas
