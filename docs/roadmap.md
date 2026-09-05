# Summer implementation roadmap

## Version 0.1.0 — Mastra-first workflow products (implemented)

See [ADR 0003](adr/0003-mastra-first-workflow-products.md). This sequence takes
priority over adding runtime backends or production campaign infrastructure.

- [x] Recheck dynamic grants at subprocess boundaries and cancel on expiry
- [x] Reserve direct worker-call budget before dispatch, including failed attempts
- [x] Reject blank dynamic worker output with model-free regression coverage
- [x] Share worker supervision and add declared artifact acceptance
- [x] Classify native write effects before enabling safe checkpoint recovery
- [x] Native persistence, conditional branches and tested recovery
- [x] Dynamic run to candidate template, verification and explicit publication
- [x] Published-version matching and reusable workflow documentation
- [x] Research ideation v4 native conditions, bounded retries and checkpoint tests
- [x] Offline predeclared quant candidate loop with comparability/stop-policy tests

Native v2 products and research v4 implement these capabilities; existing v1
runtime limits below still apply. Host-worker descendant isolation, fully autonomous
quant discovery and a validated real Vibe-Trading backtest adapter are not claimed.
See [the 0.1 guide](workflow-products.md) for exact recovery and acceptance limits.

## Historical milestones

The milestones below record the original v1 plan. They are not a second active
roadmap: native execution and persistence follow ADR 0003, and completed native
features above do not expand the old adapter's capabilities.

### Milestone 0 — walking skeleton (implemented)

- One strict `summer.workflow/v1` source and compiled IR
- Exact-version component/schema registry with executor separation
- Deterministic source, resolved-registry, and compiled semantic digests
- Static checks for graph shape, terminal reachability, explicit joins, effects, retries, and campaign policy cycles
- Append-only in-memory campaign ledger with CAS, atomic batches, exact replay, conflicting-replay rejection, receipt schemas, and reducer validation of FrameAssessment and DecisionReceipt
- Real Mastra execution for linear bounded flows and one structured `fork → join: all`
- JSON CLI, repository-owned `$summer` Skill source and metadata, and one model-free conformance fixture

### Milestone 0.5 — controlled capability discovery (implemented)

- Complete catalog coverage for the active fixture Component Registry
- Versioned workflow, component, runtime, match-request, and extension-proposal contracts
- Explainable intent matching with hard capability/profile/runtime filters and ambiguity handling
- Explicit dispatchability and blocker reporting; fixture presence never implies executability
- Extension validation for reuse evidence, schemas, permissions, effects, retry/authorization policy, runtime conformance, and test plans
- `$summer` routing and secondary-development guidance with progressive matching/extension references

### Milestone 1 — executable bounded Flow (partially implemented; superseded)

- First production component pack: ResearchStudio Idea Spark (`research-ideation@3`)
- General live-planned Mastra Dynamic Workflow (`dynamic-agent-workflow@1`)
- Catalog promotion guarded by real runtime, executor, and schema bindings
- `NodeReceipt` emission around every Mastra node attempt
- Explicit Idea Spark phase, provider-gate, retry-decision, and retry-transition nodes
- Scoped typed execution grants with active-window enforcement
- Fail-closed provider evidence policies, subprocess heartbeat journal, and bounded termination
- Cross-invocation append-only bounded-Flow receipt journal
- CLI dispatch for available bounded workflows
- Additional production component packs and provider-neutral agent executors
- Artifact store contract and content-addressed evidence
- Typed human-gate suspend/resume
- Native conditional/failure edges and checkpoint-backed replay for idempotent effects

### Milestone 2 — durable iterative campaign (original proposal; deferred)

- Durable ledger adapter with transactions, compare-and-swap, and lease fencing
- Campaign runner that launches bounded child experiments from committed decisions
- Durable budget accounting (including wall-clock limits), wake-only triggers, recovery, and operational inspection
- Factor-discovery campaign implementation with frozen environment/evaluator identities

## Not included in 0.1.0

- LangGraph conformance adapter
- DeepSeek Harness experiment
- Scheduler/UI/observability product surfaces
- Wiki-backed experience distillation and automatic workflow improvement
- Real-provider business acceptance and a real backtest adapter

OPC import and compatibility aliases are not planned. Existing third-party OPC
installations remain separate from Summer.
