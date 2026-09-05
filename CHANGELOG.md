# Changelog

## 0.1.0 — 2026-09-05

Summer is now a Mastra-native workflow product library with a thin Skill entry
point. This developer release adds an execution and productization path alongside
the existing v1 compiler and workflows. It is a source release under MIT, not an
npm package release or a claim of production business validation.

### Added

- **Native workflow products.** `summer.product/v2` definitions bind registered
  primitives and mandatory artifact acceptance. Authored graphs support mappings,
  tools, parallel steps, conditional branches and budgeted tool loops. Arbitrary
  generated JavaScript and unregistered executors are rejected.
- **Live native planning.** `summer dynamic` discovers the host-preferred visible
  Codex model and uses its highest supported effort. Input contracts, acceptance
  and grants are supplied before planning. The generated graph is frozen before
  execution; planning and failed attempts consume the direct-call budget.
- **Codex and MiniMax primitives.** Native products can invoke granted models,
  read workspace text, atomically replace text, or suspend for explicit approval.
  MiniMax uses a configured Claude CLI with tools disabled. Codex host workers
  require explicit scope-risk opt-in.
- **Artifact acceptance.** Nonempty-file, JSON-required-key and required-text
  checks distinguish successful processes from accepted deliverables.
- **Workflow product lifecycle.** `promote`, `verify`, `publish`, `run-product`
  and `select` support reviewed parameterization, different normal inputs,
  invalid-input and expected-failure cases, immutable releases, exact-version
  execution and default-version rollback. Source provenance uses digests;
  publication never copies source execution grants.
- **Native persistence and recovery.** LibSQL-backed Mastra checkpoints support
  suspended-run resume with a fresh grant. Recovery after repair is restricted to
  linear read/atomic-text-write graphs. Unknown shell effects are not replayed.
- **Cross-invocation audit.** Frozen run manifests, append-only call events,
  per-invocation grants, worker heartbeats, acceptance results and separate failure
  reports retain identity and cumulative direct-call accounting.
- **Research ideation v4.** Explicit `research-ideation@4` runs Idea Spark phases,
  provider gates, candidate retries and bottleneck re-diagnosis using native
  Mastra branches and a bounded loop, with persistent checkpoints.
- **Offline factor-tuning loop.** `quant-loop` composes predeclared candidates
  through exact published experiment versions. Frozen data, environment,
  evaluator and baseline identities constrain comparisons. A single declared
  parameter change, validation-only evidence, incumbent tracking and stop policies
  keep runtime faults separate from research results. `quant-resume` preserves
  the plan and cumulative budget across suspended invocations.
- **Discovery and Skill routing.** Catalog and intent output now include native
  capabilities and locally published products. The repository Skill documents
  native execution, promotion, verification, publication and safe recovery.
- **User documentation.** A complete native product guide, expanded CLI reference
  and ADR 0003 document current contracts and the Mastra-first architecture.

### Changed and fixed

- Mastra owns native execution state and control flow. Summer owns capability
  admission, grants, artifact acceptance and product publication. The Skill does
  not own a scheduler, execution cursor or second state machine.
- Shared subprocess supervision enforces timeout/expiry, emits heartbeats and
  terminates POSIX process groups on cancellation. Dynamic workers recheck grants,
  reserve call budget before dispatch and reject blank output.
- Codex worker arguments select the applicable approval or sandbox mode without
  combining the incompatible `--approve-for-me` and `--sandbox` flags.
- README and manual examples distinguish native entry points from legacy
  unversioned commands; the original campaign roadmap is marked historical.

### Upgrade notes

- Use `summer dynamic <brief.json> <request.json>` for new native planning;
  `summer run dynamic-agent-workflow <request.json>` remains legacy v1.
- Use `summer run research-ideation@4 <request.json>` for new native research.
  Unversioned `research-ideation` still selects v3 for compatibility.
- Existing v1 definitions, journals and runs are not silently migrated. A native
  resume needs the same frozen definition/input/scope and a fresh active grant.
- Product schema versions, research workflow versions and the package release
  number are separate: Summer 0.1.0 includes product v2 and research v4.
- `summer publish` publishes a workflow to the local product library, not GitHub
  or npm. Review private task literals before sharing a product definition.

### Validation and limits

- Local `pnpm validate`: 132 tests in 13 files, type checks and Skill validation
  passed. Native product CLI execution has also passed a model-free local smoke
  test. Model-free tests do not establish real-provider business quality.
- Live planning currently generates finite mapping/tool sequences. Authored
  products and research v4 can use native branches and bounded loops.
- Research still depends on the installed Idea Spark compatibility adapter and
  external provider access. It is not a standalone replacement for Idea Spark.
- The quantitative evaluator in tests is synthetic. No Vibe-Trading backtest
  adapter, real-factor performance validation, live trading, autonomous candidate
  proposer or automatic successor campaign is bundled.
- Grants are application checks, not OS sandboxes. Direct-call budgets do not
  provide strict descendant, token or monetary-cost accounting. Arbitrary host
  write effects and crashed quant effects require reconciliation.
- Artifact checks establish declared file contracts, not scientific truth.
  Product verification is not yet a comparative business-quality benchmark.
- Wiki integration, experience distillation, automatic workflow improvement,
  distributed scheduling and additional runtime backends are not included.
- No OPC compatibility alias is installed or planned.

See [Workflow products](docs/workflow-products.md) for runnable examples and
[ADR 0003](docs/adr/0003-mastra-first-workflow-products.md) for the architecture decision.
