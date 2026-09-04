# Extension development

[Documentation](README.md) · [Repository README](../README.md) · [ADR 0002](adr/0002-capability-catalog-and-extension-gate.md)

Summer extensions begin with reuse evidence, not implementation. A proposal is a machine-checkable design input; validation does not install or promote anything.

## 1. Inspect and match

Compile the current catalog and look for an existing capability first:

```bash
pnpm --silent summer catalog
pnpm --silent summer match-intent "describe the capability you need"
```

Use the returned `catalog.catalogDigest` in the proposal's `reuseAssessment`. Record the existing workflow IDs and exact component references reviewed, then choose `add-component` or `add-workflow` with a justification.

## 2. Write a proposal

Both proposal kinds use `summer.extension-proposal/v1` and require:

- a stable `proposalId`, rationale, and requested capabilities;
- a reuse assessment bound to the current catalog digest;
- contract, failure, conformance-fixture, and—when applicable—idempotency verification cases.

A component proposal also supplies exact schema descriptors, one exact component descriptor, a `candidate` catalog entry, repository-relative implementation paths under `packages/`, one implementation runtime, and authorization/retry controls. Effects, permissions, component kind, schemas, runtime support, and retry policy must agree.

A workflow proposal supplies a strict `summer.workflow/v1`, a matching `candidate` workflow catalog entry, and a source path under `workflows/` or `fixtures/workflows/`. It may reference only registered exact component versions. Its catalog/runtime identities must match, and every selected runtime must have a conformance validator that accepts the compiled graph.

The protocol definitions in `packages/protocol/src/extensions.ts` are the authoritative field schemas. [ADR 0002](adr/0002-capability-catalog-and-extension-gate.md) explains why the catalog and registry remain the control plane.

## 3. Validate before implementation

```bash
pnpm --silent summer extension-check /absolute/path/to/proposal.json
```

The JSON report uses `summer.extension-validation/v1` and lists every issue. A valid workflow proposal also reports its `compiledWorkflowDigest`. Fix the proposal until the command exits `0`; then implement only the accepted paths and contracts.

## 4. Integrate through existing authorities

For a component, add its schemas, descriptor, executor binding, catalog entry, and focused verification through the existing registry/package pattern. For a workflow, add the workflow source and catalog entry, then confirm both Summer compilation and runtime validation.

Finish with:

```bash
pnpm --silent summer catalog
pnpm validate
```

The files under [`proposals/`](../proposals/README.md) document an older `research-ideation@2` design. Their frozen catalog digests and component versions are intentionally stale; do not use them as passing templates.
