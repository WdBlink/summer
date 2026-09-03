# Summer implementation roadmap

## Milestone 0 — walking skeleton (implemented)

- One strict `summer.workflow/v1` source and compiled IR
- Exact-version component/schema registry with executor separation
- Deterministic source, resolved-registry, and compiled semantic digests
- Static checks for graph shape, terminal reachability, explicit joins, effects, retries, and campaign policy cycles
- Append-only in-memory campaign ledger with CAS, atomic batches, exact replay, conflicting-replay rejection, receipt schemas, and reducer validation of FrameAssessment and DecisionReceipt
- Real Mastra execution for linear bounded flows and one structured `fork → join: all`
- JSON CLI, repository-owned `$summer` Skill source and metadata, and three model-free conformance fixtures

## Milestone 0.5 — controlled capability discovery (implemented)

- Complete catalog coverage for the active fixture Component Registry
- Versioned workflow, component, runtime, match-request, and extension-proposal contracts
- Explainable intent matching with hard capability/profile/runtime filters and ambiguity handling
- Explicit dispatchability and blocker reporting; fixture presence never implies executability
- Extension validation for reuse evidence, schemas, permissions, effects, retry/authorization policy, runtime conformance, and test plans
- `$summer` routing and secondary-development guidance with progressive matching/extension references

## Milestone 1 — executable bounded Flow

- Production component packs and provider-neutral agent executors
- Promote catalog entries from `fixture` to `available` only with real executor bindings
- NodeReceipt emission around every adapter execution
- Artifact store contract and content-addressed evidence
- Typed human-gate suspend/resume
- Failure routes and safe replay for idempotent effects

## Milestone 2 — durable iterative campaign

- Durable ledger adapter with transactions, compare-and-swap, and lease fencing
- Campaign runner that launches bounded child experiments from committed decisions
- Durable budget accounting (including wall-clock limits), wake-only triggers, recovery, and operational inspection
- Factor-discovery campaign implementation with frozen environment/evaluator identities

## Explicitly later

- LangGraph conformance adapter
- DeepSeek Harness experiment
- Scheduler/UI/observability product surfaces
- OPC import or compatibility aliases
