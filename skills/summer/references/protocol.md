# Summer protocol quick reference

## Authority chain

```text
Workflow source
  -> Summer compiler
  -> CompiledWorkflowV1
  -> runtime adapter
  -> typed receipts and events
  -> campaign ledger
```

The serialized source and compiled IR never contain executor functions. Component descriptors are versioned data; executor bindings live only in the runtime registry.

`SummerCore.start()` is the trusted campaign-start boundary: it recompiles the supplied manifest against the active registry and accepts only `iterative-campaign`. Callers cannot append their own `campaign-started` event. A `bounded-flow` executes through a runtime adapter and returns a child result; it is not opened as a campaign ledger.

## Profiles

`bounded-flow` must be a finite DAG with an explicit entry and terminal nodes. It may fan out into independent branches. Each child run terminates with a receipt bound to its compiled workflow, component, inputs, outputs, run, node, and attempt.

Any node with more than one incoming edge must declare its join semantics. Use `join: all` when every branch must finish and `join: any` when alternative temporal/control paths can activate the node. Runtime adapters may support only a subset and must reject the rest explicitly.

`iterative-campaign` may contain typed cycles. Each cycle must cross the declared budget, Frame Check, and Decision Policy nodes. The Decision Policy must declare exactly one outgoing edge for each closed campaign decision:

- `replicate`
- `repair-runtime`
- `run-next-experiment`
- `recompile-hypothesis`
- `wait`
- `stop`

An optimizer proposes the next plan or convergence evidence. A Frame Check emits an assessment. The Decision Policy alone commits the next legal edge. Every decision cites that assessment as evidence; a hypothesis recompile also freezes the next experiment identity and plan digest before advancing frame and hypothesis versions.

The profile names one `experimentNodeId`, which must resolve to a `nested-workflow` component and must be distinct from the five policy-role nodes. Experiment-scoped node receipts may target only that node; that campaign-node receipt binds the bounded child Flow result into the experiment ledger. `replicate`, `repair-runtime`, `run-next-experiment`, and `recompile-hypothesis` route directly to it; `stop` routes to a declared terminal, while `wait` must re-enter Frame Check before another decision.

`campaign-started` freezes the workflow profile, node/component/attempt/idempotency contracts, and the Frame Check and Decision Policy digests. Every `FrameAssessment` carries both its domain evaluator digest and its Frame Check policy digest. Every experiment-scoped node receipt carries the active experiment attempt identity. Transient node retries are dense within that scope, retain the first input digest and compiled idempotency key, and may follow only a retryable failure. The in-memory reducer enforces experiment starts, attempts per experiment, and the optional total-node-execution budget. Durable wall-clock enforcement belongs to a later ledger adapter.

## Failure boundaries

Keep these identities separate:

- a transient attempt retry keeps the experiment identity;
- runtime repair or replay does not update the research posterior;
- the next experiment receives a new experiment identity;
- replicate and next-experiment freeze the assessed experiment as baseline;
- recompile creates a new frame and hypothesis version, freezes the new experiment and plan identities, and resets the comparison baseline;
- resource exhaustion is not research convergence.

Runtime metadata such as Mastra run or checkpoint identifiers is opaque operational data. It must not participate in semantic digests or campaign decisions.
