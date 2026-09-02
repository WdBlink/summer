# Conformance fixtures

These are Summer-owned, model-free fixtures. They preserve architectural behavior without copying runtime state or claiming wire compatibility with another project.

- `research-ideation.v1.json` is derived from the local `autoresearch-ideation` adapter's observable branch order and terminal binding. Its structured NextAction and terminal contracts are local adaptations, not public ResearchStudio APIs.
- `factor-strategy-experiment.v1.json` freezes one offline experiment as a bounded child Flow.
- `factor-discovery-tuning.v1.json` exercises the iterative-campaign topology, its two-experiment budget, Frame Check, and six closed decision routes. Factor Loop inspired the separate core tests for plan-before-mutation, receipt, replay, and authority invariants, but its private store, SQLite state, lease schema, and unpublished GenerationPlan schema are neither read nor copied.

The workflow fixtures validate Summer's compiler and adapter planning. They do not contain event transcripts, emit real receipts, call models, perform backtests, prove research quality, or make trading decisions.
