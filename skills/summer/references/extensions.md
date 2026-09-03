# Extension design

Use this mode only after catalog matching shows that reuse or composition is insufficient.

## Required sequence

1. Run `summer catalog` and retain its current `catalogDigest`.
2. Match the user request and review relevant workflow/component candidates.
3. Decide whether the gap needs one new atomic component or a new workflow composed from registered components.
4. Create one strict `summer.extension-proposal/v1` artifact.
5. Run `summer extension-check <proposal.json>` and resolve every issue.
6. Implement schemas, descriptor, executor, registry/catalog changes, runtime conformance, and tests as one reviewed change.

Validation success means the design is compatible with the current catalog and protocol. It does not register or execute the proposal.

## Component proposal

Include:

- exact component and schema versions;
- requested and provided capabilities;
- catalog discovery metadata and runtime binding target;
- repository-relative implementation paths under `packages/`;
- explicit permissions and effect classification;
- human authorization and retry policy;
- contract, failure, conformance, and—when applicable—idempotency cases;
- a reuse assessment tied to the current `catalogDigest`.

Write effects require declared permissions. A non-idempotent write must forbid automatic retry and require authorization before execution. An idempotent write must include an idempotency verification case.

## Workflow proposal

A workflow proposal must use only registered exact-version components. If a required component is missing, validate and implement that component first.

The catalog entry, workflow identity, revision, profile, source path, capability claims, and runtime set must agree. `extension-check` compiles the graph and runs the registered runtime conformance validator; a profile-compatible runtime can still reject an unsupported graph shape.

New workflow sources belong under `workflows/`; conformance-only fixtures belong under `fixtures/workflows/`. Candidate catalog entries become `available` only after real executor bindings and acceptance tests exist.
