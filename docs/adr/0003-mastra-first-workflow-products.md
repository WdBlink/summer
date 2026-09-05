# ADR 0003: Mastra-first workflow products

- Status: Accepted; native 0.1 product path implemented alongside legacy v1
- Date: 2026-09-05
- Supersedes: ADR 0001's runtime-neutral expansion strategy for new development
- Compatibility: Existing v1 contracts and runs retain their current semantics

## Decision

Summer is a workflow product library with a thin Skill entry point. Mastra owns
execution state, control flow, suspension and checkpoints. Summer owns capability
resolution, grants, artifact acceptance, immutable versions and publication.
Do not add another scheduler or execution cursor in the Skill or a campaign layer.

Published and dynamically authored workflows will share an execution path. New
definitions reference registered primitives; arbitrary generated JavaScript is not
an admissible runtime input. Keep the existing compiler for compatibility and
policy validation, but do not expand it into a second general-purpose engine.

The product lifecycle is:

`dynamic run -> candidate template -> validation -> explicit publication -> reuse`

A successful process is not an accepted artifact. An accepted artifact is not a
validated reusable template. Promotion must parameterize task-specific values,
remove private data, preserve acceptance rules, expose manual interventions, and
validate at least a different normal input, an invalid input and a relevant failure
case. Published versions are immutable; running tasks retain their exact version.
Publication does not carry over execution grants from the source run.

## Migration sequence

1. Harden existing execution boundaries and preserve working v1 dispatch.
2. Share worker supervision, typed outputs and artifact acceptance.
3. Integrate native Mastra persistence and conditional execution; prove safe
   recovery before enabling automatic replay of writes.
4. Add candidate extraction, verification, publication and catalog discovery.
5. Migrate research ideation and implement a representative campaign only after
   bounded flows satisfy their acceptance and recovery contracts.

Native bounded loops require a new contract revision: v1 bounded-flow remains a
DAG. Existing journals are audit evidence, not checkpoints. Old runs must never
be silently translated into a new graph or resumed under a different definition.

## Current boundary (0.1 implementation)

Dynamic subprocesses now recheck grants before and after each call and receive an
expiry cancellation signal. Direct worker attempts reserve budget before awaiting
execution, including attempts that fail. Empty worker output is rejected.

Native products now have artifact acceptance, LibSQL checkpoints, failed-call
receipts and draft/verify/publish/reuse commands. Research v4 uses native conditional
and loop control. The offline quant loop composes published experiments and freezes
comparison identities; its policy tests use synthetic evidence, not a real backtest.

Strict descendant accounting inside shell-capable workers is not claimed.
Nonempty text is not proof of task completion. The legacy dynamic write-idempotent
descriptor is not a replay guarantee. Recovery of arbitrary host writes remains
blocked for reconciliation; tested automatic repair is limited to linear read and
atomic-text-write graphs. Quant successor automation and a live Vibe adapter remain
separate work, not hidden production capabilities.

No additional runtime backend, distributed scheduler, UI or plugin marketplace
is required for this migration.
