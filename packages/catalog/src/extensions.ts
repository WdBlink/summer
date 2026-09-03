import type { ComponentRegistry } from "@summer/components";
import { WorkflowCompileError, compileWorkflow } from "@summer/compiler";
import {
  ExtensionProposalV1Schema,
  canonicalJson,
  type CompiledWorkflowV1,
  type ExtensionProposalV1,
  type RuntimeCatalogEntryV1
} from "@summer/protocol";

import {
  componentRefKey,
  workflowKey,
  type CompiledSummerCatalogV1
} from "./catalog.js";
import type { CatalogIssue } from "./errors.js";

export type RuntimeWorkflowValidator = (
  workflow: CompiledWorkflowV1
) => void;

export interface ExtensionValidationContext {
  readonly catalog: CompiledSummerCatalogV1;
  readonly registry: ComponentRegistry;
  readonly runtimeWorkflowValidators?: ReadonlyMap<
    string,
    RuntimeWorkflowValidator
  >;
}

export interface ExtensionValidationReportV1 {
  readonly schemaVersion: "summer.extension-validation/v1";
  readonly valid: boolean;
  readonly proposalId: string | null;
  readonly kind: ExtensionProposalV1["kind"] | null;
  readonly catalogDigest: string;
  readonly issues: readonly CatalogIssue[];
  readonly compiledWorkflowDigest?: string;
}

export function validateExtensionProposal(
  input: unknown,
  context: ExtensionValidationContext
): ExtensionValidationReportV1 {
  const parsed = ExtensionProposalV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaVersion: "summer.extension-validation/v1",
      valid: false,
      proposalId: null,
      kind: null,
      catalogDigest: context.catalog.catalogDigest,
      issues: parsed.error.issues.map((issue) => ({
        code: "INVALID_EXTENSION_PROPOSAL",
        message: issue.message,
        path: issue.path.map(String).join(".")
      }))
    };
  }

  const proposal = parsed.data;
  const issues: CatalogIssue[] = [];
  validateReuseAssessment(proposal, context.catalog, issues);
  if (proposal.kind === "component") {
    validateComponentProposal(proposal, context, issues);
    return {
      schemaVersion: "summer.extension-validation/v1",
      valid: issues.length === 0,
      proposalId: proposal.proposalId,
      kind: proposal.kind,
      catalogDigest: context.catalog.catalogDigest,
      issues
    };
  }

  const compiled = validateWorkflowProposal(proposal, context, issues);
  return {
    schemaVersion: "summer.extension-validation/v1",
    valid: issues.length === 0,
    proposalId: proposal.proposalId,
    kind: proposal.kind,
    catalogDigest: context.catalog.catalogDigest,
    issues,
    ...(compiled === undefined
      ? {}
      : { compiledWorkflowDigest: compiled.compiledDigest })
  };
}

function validateReuseAssessment(
  proposal: ExtensionProposalV1,
  catalog: CompiledSummerCatalogV1,
  issues: CatalogIssue[]
): void {
  const assessment = proposal.reuseAssessment;
  if (assessment.catalogDigest !== catalog.catalogDigest) {
    issues.push({
      code: "CATALOG_DIGEST_MISMATCH",
      message:
        "reuse assessment was made against a different catalog; repeat discovery before extending",
      path: "reuseAssessment.catalogDigest"
    });
  }
  const workflowIds = new Set(catalog.workflows.map((entry) => entry.workflowId));
  for (const [index, workflowId] of assessment.reviewedWorkflowIds.entries()) {
    if (!workflowIds.has(workflowId)) {
      issues.push({
        code: "UNKNOWN_REVIEWED_WORKFLOW",
        message: `reviewed workflow '${workflowId}' is not in the active catalog`,
        path: `reuseAssessment.reviewedWorkflowIds.${index}`
      });
    }
  }
  const componentKeys = new Set(
    catalog.components.map((entry) => componentRefKey(entry.component))
  );
  for (const [index, component] of assessment.reviewedComponents.entries()) {
    const key = componentRefKey(component);
    if (!componentKeys.has(key)) {
      issues.push({
        code: "UNKNOWN_REVIEWED_COMPONENT",
        message: `reviewed component '${key}' is not in the active catalog`,
        path: `reuseAssessment.reviewedComponents.${index}`
      });
    }
  }
  const expected = proposal.kind === "component" ? "add-component" : "add-workflow";
  if (assessment.conclusion !== expected) {
    issues.push({
      code: "REUSE_CONCLUSION_MISMATCH",
      message: `a ${proposal.kind} proposal must conclude '${expected}'`,
      path: "reuseAssessment.conclusion"
    });
  }
}

function validateComponentProposal(
  proposal: Extract<ExtensionProposalV1, { readonly kind: "component" }>,
  context: ExtensionValidationContext,
  issues: CatalogIssue[]
): void {
  const key = componentRefKey(proposal.component.ref);
  const snapshot = context.registry.snapshot();
  const existingComponentKeys = new Set(
    snapshot.components.map((descriptor) => componentRefKey(descriptor.ref))
  );
  if (existingComponentKeys.has(key)) {
    issues.push({
      code: "COMPONENT_ALREADY_REGISTERED",
      message: `component '${key}' already exists; propose a new exact version or reuse it`,
      path: "component.ref"
    });
  }
  if (componentRefKey(proposal.catalogEntry.component) !== key) {
    issues.push({
      code: "COMPONENT_CATALOG_IDENTITY_MISMATCH",
      message: "catalogEntry.component must equal component.ref",
      path: "catalogEntry.component"
    });
  }
  if (proposal.catalogEntry.status !== "candidate") {
    issues.push({
      code: "EXTENSION_STATUS_NOT_CANDIDATE",
      message: "an unmerged component extension must have candidate status",
      path: "catalogEntry.status"
    });
  }
  if (!proposal.catalogEntry.runtimeIds.includes(proposal.implementation.runtimeId)) {
    issues.push({
      code: "IMPLEMENTATION_RUNTIME_NOT_CATALOGED",
      message: "implementation.runtimeId must be declared by catalogEntry.runtimeIds",
      path: "implementation.runtimeId"
    });
  }
  for (const capability of proposal.requestedCapabilities) {
    if (!proposal.component.capabilities.includes(capability)) {
      issues.push({
        code: "REQUESTED_CAPABILITY_NOT_PROVIDED",
        message: `component does not declare requested capability '${capability}'`,
        path: "component.capabilities"
      });
    }
  }

  const existingSchemas = new Map(
    snapshot.schemas.map((schema) => [componentRefKey(schema.ref), schema])
  );
  const proposedSchemas = new Map<string, (typeof proposal.schemas)[number]>();
  for (const [index, schema] of proposal.schemas.entries()) {
    const schemaKey = componentRefKey(schema.ref);
    if (existingSchemas.has(schemaKey)) {
      issues.push({
        code: "SCHEMA_ALREADY_REGISTERED",
        message: `schema '${schemaKey}' is already registered and should be referenced, not re-declared`,
        path: `schemas.${index}.ref`
      });
    } else if (proposedSchemas.has(schemaKey)) {
      issues.push({
        code: "DUPLICATE_PROPOSED_SCHEMA",
        message: `schema '${schemaKey}' is proposed more than once`,
        path: `schemas.${index}.ref`
      });
    } else {
      proposedSchemas.set(schemaKey, schema);
    }
  }
  for (const [path, ref] of [
    ["component.inputSchema", proposal.component.inputSchema],
    ["component.outputSchema", proposal.component.outputSchema]
  ] as const) {
    const schemaKey = componentRefKey(ref);
    if (!existingSchemas.has(schemaKey) && !proposedSchemas.has(schemaKey)) {
      issues.push({
        code: "UNRESOLVED_PROPOSED_SCHEMA",
        message: `schema '${schemaKey}' is neither registered nor proposed`,
        path
      });
    }
  }

  const runtimes = runtimeById(context.catalog);
  for (const [index, runtimeId] of proposal.catalogEntry.runtimeIds.entries()) {
    const runtime = runtimes.get(runtimeId);
    if (runtime === undefined) {
      issues.push({
        code: "UNKNOWN_RUNTIME",
        message: `runtime '${runtimeId}' is not in the active catalog`,
        path: `catalogEntry.runtimeIds.${index}`
      });
    } else {
      validateComponentRuntime(
        runtime,
        proposal.component,
        issues,
        `catalogEntry.runtimeIds.${index}`
      );
    }
  }

  if (
    proposal.component.effect.startsWith("write-") &&
    proposal.component.permissions.length === 0
  ) {
    issues.push({
      code: "WRITE_PERMISSION_REQUIRED",
      message: "write-effect components must declare at least one permission",
      path: "component.permissions"
    });
  }
  if (proposal.component.effect === "write-non-idempotent") {
    if (proposal.controls.retryPolicy !== "forbidden") {
      issues.push({
        code: "NON_IDEMPOTENT_RETRY_FORBIDDEN",
        message: "non-idempotent writes must forbid automatic retry",
        path: "controls.retryPolicy"
      });
    }
    if (proposal.controls.humanAuthorization !== "before-execution") {
      issues.push({
        code: "NON_IDEMPOTENT_AUTHORIZATION_REQUIRED",
        message: "non-idempotent writes require authorization before execution",
        path: "controls.humanAuthorization"
      });
    }
  }
  if (
    proposal.component.effect === "write-idempotent" &&
    proposal.verification.idempotencyCases.length === 0
  ) {
    issues.push({
      code: "IDEMPOTENCY_CASE_REQUIRED",
      message: "idempotent write components require an idempotency verification case",
      path: "verification.idempotencyCases"
    });
  }
}

function validateComponentRuntime(
  runtime: RuntimeCatalogEntryV1,
  component: Extract<ExtensionProposalV1, { kind: "component" }>["component"],
  issues: CatalogIssue[],
  path: string
): void {
  if (!runtime.supportedComponentKinds.includes(component.kind)) {
    issues.push({
      code: "RUNTIME_COMPONENT_KIND_UNSUPPORTED",
      message: `runtime '${runtime.runtimeId}' does not support '${component.kind}' components`,
      path
    });
  }
  if (!runtime.supportedEffects.includes(component.effect)) {
    issues.push({
      code: "RUNTIME_EFFECT_UNSUPPORTED",
      message: `runtime '${runtime.runtimeId}' does not support effect '${component.effect}'`,
      path
    });
  }
}

function validateWorkflowProposal(
  proposal: Extract<ExtensionProposalV1, { readonly kind: "workflow" }>,
  context: ExtensionValidationContext,
  issues: CatalogIssue[]
): CompiledWorkflowV1 | undefined {
  const key = workflowKey(proposal.workflow);
  if (context.catalog.workflows.some((entry) => workflowKey(entry) === key)) {
    issues.push({
      code: "WORKFLOW_ALREADY_CATALOGED",
      message: `workflow '${key}' already exists; use a new revision or reuse it`,
      path: "workflow"
    });
  }
  const entry = proposal.catalogEntry;
  if (
    entry.workflowId !== proposal.workflow.workflowId ||
    entry.revision !== proposal.workflow.revision ||
    entry.profile !== proposal.workflow.profile.kind
  ) {
    issues.push({
      code: "WORKFLOW_CATALOG_IDENTITY_MISMATCH",
      message: "catalogEntry identity and profile must match the proposed workflow",
      path: "catalogEntry"
    });
  }
  if (entry.sourcePath !== proposal.implementation.sourcePath) {
    issues.push({
      code: "WORKFLOW_SOURCE_PATH_MISMATCH",
      message: "catalogEntry.sourcePath must equal implementation.sourcePath",
      path: "implementation.sourcePath"
    });
  }
  if (entry.status !== "candidate") {
    issues.push({
      code: "EXTENSION_STATUS_NOT_CANDIDATE",
      message: "an unmerged workflow extension must have candidate status",
      path: "catalogEntry.status"
    });
  }
  if (!sameStringSet(entry.runtimeIds, proposal.implementation.runtimeIds)) {
    issues.push({
      code: "WORKFLOW_RUNTIME_SET_MISMATCH",
      message: "catalogEntry.runtimeIds and implementation.runtimeIds must match",
      path: "implementation.runtimeIds"
    });
  }
  for (const capability of proposal.requestedCapabilities) {
    if (!entry.capabilities.includes(capability)) {
      issues.push({
        code: "REQUESTED_CAPABILITY_NOT_PROVIDED",
        message: `workflow catalog entry does not declare requested capability '${capability}'`,
        path: "catalogEntry.capabilities"
      });
    }
  }

  let compiled: CompiledWorkflowV1 | undefined;
  try {
    compiled = compileWorkflow(proposal.workflow, context.registry);
  } catch (error) {
    if (error instanceof WorkflowCompileError) {
      for (const issue of error.issues) {
        issues.push({
          code: `WORKFLOW_${issue.code}`,
          message: issue.message,
          ...(issue.path === undefined ? {} : { path: `workflow.${issue.path}` })
        });
      }
    } else {
      issues.push({
        code: "WORKFLOW_COMPILE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        path: "workflow"
      });
    }
  }

  const runtimes = runtimeById(context.catalog);
  for (const [index, runtimeId] of proposal.implementation.runtimeIds.entries()) {
    const runtime = runtimes.get(runtimeId);
    if (runtime === undefined) {
      issues.push({
        code: "UNKNOWN_RUNTIME",
        message: `runtime '${runtimeId}' is not in the active catalog`,
        path: `implementation.runtimeIds.${index}`
      });
      continue;
    }
    if (!runtime.supportedProfiles.includes(proposal.workflow.profile.kind)) {
      issues.push({
        code: "RUNTIME_PROFILE_UNSUPPORTED",
        message: `runtime '${runtimeId}' does not support profile '${proposal.workflow.profile.kind}'`,
        path: `implementation.runtimeIds.${index}`
      });
      continue;
    }
    if (compiled === undefined) continue;
    const validator = context.runtimeWorkflowValidators?.get(runtimeId);
    if (validator === undefined) {
      issues.push({
        code: "RUNTIME_VALIDATOR_MISSING",
        message: `no workflow conformance validator is registered for runtime '${runtimeId}'`,
        path: `implementation.runtimeIds.${index}`
      });
      continue;
    }
    try {
      validator(compiled);
    } catch (error) {
      issues.push({
        code: "RUNTIME_WORKFLOW_INCOMPATIBLE",
        message:
          error instanceof Error
            ? error.message
            : `runtime '${runtimeId}' rejected the workflow`,
        path: `implementation.runtimeIds.${index}`
      });
    }
  }
  return compiled;
}

function runtimeById(
  catalog: CompiledSummerCatalogV1
): Map<string, RuntimeCatalogEntryV1> {
  return new Map(catalog.runtimes.map((runtime) => [runtime.runtimeId, runtime]));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return canonicalJson([...left].sort()) === canonicalJson([...right].sort());
}
