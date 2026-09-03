import type { ComponentRegistry } from "@summer/components";
import {
  SummerCatalogV1Schema,
  parseCompiledWorkflowV1,
  sha256Canonical,
  type CompiledWorkflowV1,
  type ComponentCatalogEntryV1,
  type ComponentDescriptorV1,
  type RuntimeCatalogEntryV1,
  type SummerCatalogV1,
  type WorkflowCatalogEntryV1
} from "@summer/protocol";

import { CatalogCompileError, type CatalogIssue } from "./errors.js";

export interface CompiledWorkflowCatalogEntryV1
  extends WorkflowCatalogEntryV1 {
  readonly compiledWorkflowDigest: string;
  readonly components: readonly string[];
  readonly componentCapabilities: readonly string[];
}

export interface CompiledComponentCatalogEntryV1
  extends ComponentCatalogEntryV1 {
  readonly descriptor: ComponentDescriptorV1;
}

export interface CompiledSummerCatalogV1 {
  readonly schemaVersion: "summer.compiled-catalog/v1";
  readonly catalogId: string;
  readonly componentCoverage: SummerCatalogV1["componentCoverage"];
  readonly registryDigest: string;
  readonly catalogDigest: string;
  readonly workflows: readonly CompiledWorkflowCatalogEntryV1[];
  readonly components: readonly CompiledComponentCatalogEntryV1[];
  readonly runtimes: readonly RuntimeCatalogEntryV1[];
}

export function componentRefKey(ref: {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

export function workflowKey(workflow: {
  readonly workflowId: string;
  readonly revision: number;
}): string {
  return `${workflow.workflowId}@${workflow.revision}`;
}

export function compileCatalog(
  input: unknown,
  registry: ComponentRegistry,
  workflowInputs: readonly unknown[]
): CompiledSummerCatalogV1 {
  const parsed = SummerCatalogV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new CatalogCompileError(
      parsed.error.issues.map((issue) => ({
        code: "INVALID_CATALOG",
        message: issue.message,
        path: issue.path.map(String).join(".")
      }))
    );
  }

  const source = parsed.data;
  const issues: CatalogIssue[] = [];
  const workflows: CompiledWorkflowV1[] = [];
  for (const [index, workflowInput] of workflowInputs.entries()) {
    try {
      workflows.push(parseCompiledWorkflowV1(workflowInput));
    } catch (error) {
      issues.push({
        code: "INVALID_COMPILED_WORKFLOW",
        message:
          error instanceof Error ? error.message : "invalid compiled workflow",
        path: `workflowInputs.${index}`
      });
    }
  }

  const workflowByKey = uniqueIndex(
    workflows,
    workflowKey,
    "DUPLICATE_COMPILED_WORKFLOW",
    "workflowInputs",
    issues
  );
  const runtimeById = uniqueIndex(
    source.runtimes,
    (runtime) => runtime.runtimeId,
    "DUPLICATE_RUNTIME_ID",
    "runtimes",
    issues
  );
  uniqueIndex(
    source.workflows,
    workflowKey,
    "DUPLICATE_WORKFLOW_ENTRY",
    "workflows",
    issues
  );
  const catalogComponentByKey = uniqueIndex(
    source.components,
    (entry) => componentRefKey(entry.component),
    "DUPLICATE_COMPONENT_ENTRY",
    "components",
    issues
  );

  const snapshot = registry.snapshot();
  const descriptorByKey = new Map(
    snapshot.components.map((descriptor) => [
      componentRefKey(descriptor.ref),
      descriptor
    ])
  );

  if (source.componentCoverage === "complete") {
    for (const key of descriptorByKey.keys()) {
      if (!catalogComponentByKey.has(key)) {
        issues.push({
          code: "UNCATALOGED_REGISTRY_COMPONENT",
          message: `registry component '${key}' is missing from a complete catalog`,
          path: "components"
        });
      }
    }
    for (const key of catalogComponentByKey.keys()) {
      if (!descriptorByKey.has(key)) {
        issues.push({
          code: "CATALOG_COMPONENT_NOT_REGISTERED",
          message: `catalog component '${key}' is not present in the active registry`,
          path: "components"
        });
      }
    }
  }

  const compiledComponents: CompiledComponentCatalogEntryV1[] = [];
  for (const [index, entry] of source.components.entries()) {
    const key = componentRefKey(entry.component);
    const descriptor = descriptorByKey.get(key);
    if (descriptor === undefined) {
      issues.push({
        code: "CATALOG_COMPONENT_NOT_REGISTERED",
        message: `catalog component '${key}' is not present in the active registry`,
        path: `components.${index}.component`
      });
      continue;
    }
    validateRuntimeReferences(
      entry.runtimeIds,
      runtimeById,
      `components.${index}.runtimeIds`,
      issues,
      (runtime) => {
        if (!runtime.supportedComponentKinds.includes(descriptor.kind)) {
          return `does not support component kind '${descriptor.kind}'`;
        }
        if (!runtime.supportedEffects.includes(descriptor.effect)) {
          return `does not support effect '${descriptor.effect}'`;
        }
        return undefined;
      }
    );
    if (entry.status === "available") {
      const executableRuntime = entry.runtimeIds.some((runtimeId) => {
        const runtime = runtimeById.get(runtimeId);
        return runtime?.status === "available" && runtime.executorBindings;
      });
      if (!executableRuntime) {
        issues.push({
          code: "AVAILABLE_COMPONENT_NOT_EXECUTABLE",
          message: `available component '${key}' has no available runtime with executor bindings`,
          path: `components.${index}.runtimeIds`
        });
      }
      if (!registry.hasExecutor(entry.component)) {
        issues.push({
          code: "AVAILABLE_COMPONENT_EXECUTOR_MISSING",
          message: `available component '${key}' has no executor binding in the active registry`,
          path: `components.${index}.component`
        });
      }
      for (const schemaRef of [descriptor.inputSchema, descriptor.outputSchema]) {
        if (!registry.hasSchemaBinding(schemaRef)) {
          issues.push({
            code: "AVAILABLE_COMPONENT_SCHEMA_BINDING_MISSING",
            message: `available component '${key}' has no runtime binding for schema '${componentRefKey(schemaRef)}'`,
            path: `components.${index}.component`
          });
        }
      }
    }
    compiledComponents.push({ ...entry, descriptor });
  }

  const compiledWorkflows: CompiledWorkflowCatalogEntryV1[] = [];
  for (const [index, entry] of source.workflows.entries()) {
    const key = workflowKey(entry);
    const workflow = workflowByKey.get(key);
    if (workflow === undefined) {
      issues.push({
        code: "CATALOG_WORKFLOW_NOT_COMPILED",
        message: `catalog workflow '${key}' has no supplied compiled workflow`,
        path: `workflows.${index}`
      });
      continue;
    }
    if (workflow.profile.kind !== entry.profile) {
      issues.push({
        code: "WORKFLOW_PROFILE_MISMATCH",
        message: `catalog declares '${entry.profile}', compiled workflow is '${workflow.profile.kind}'`,
        path: `workflows.${index}.profile`
      });
    }
    validateRuntimeReferences(
      entry.runtimeIds,
      runtimeById,
      `workflows.${index}.runtimeIds`,
      issues,
      (runtime) =>
        runtime.supportedProfiles.includes(entry.profile)
          ? undefined
          : `does not support profile '${entry.profile}'`
    );

    const componentCapabilities = new Set<string>();
    const componentRefs = new Set<string>();
    for (const node of workflow.nodes) {
      const componentKey = componentRefKey(node.component);
      componentRefs.add(componentKey);
      if (!catalogComponentByKey.has(componentKey)) {
        issues.push({
          code: "WORKFLOW_COMPONENT_NOT_CATALOGED",
          message: `workflow '${key}' uses uncataloged component '${componentKey}'`,
          path: `workflows.${index}`
        });
      } else if (
        entry.status === "available" &&
        catalogComponentByKey.get(componentKey)?.status !== "available"
      ) {
        issues.push({
          code: "AVAILABLE_WORKFLOW_USES_UNAVAILABLE_COMPONENT",
          message: `available workflow '${key}' uses component '${componentKey}' that is not available`,
          path: `workflows.${index}`
        });
      }
      for (const capability of node.resolvedComponent.capabilities) {
        componentCapabilities.add(capability);
      }
    }
    compiledWorkflows.push({
      ...entry,
      compiledWorkflowDigest: workflow.compiledDigest,
      components: [...componentRefs].sort(),
      componentCapabilities: [...componentCapabilities].sort()
    });
  }

  if (issues.length > 0) throw new CatalogCompileError(issues);

  const stable = {
    schemaVersion: "summer.compiled-catalog/v1" as const,
    catalogId: source.catalogId,
    componentCoverage: source.componentCoverage,
    registryDigest: registry.digest(),
    workflows: [...compiledWorkflows].sort((left, right) =>
      workflowKey(left).localeCompare(workflowKey(right))
    ),
    components: [...compiledComponents].sort((left, right) =>
      componentRefKey(left.component).localeCompare(componentRefKey(right.component))
    ),
    runtimes: [...source.runtimes].sort((left, right) =>
      left.runtimeId.localeCompare(right.runtimeId)
    )
  };
  return Object.freeze({
    ...stable,
    catalogDigest: sha256Canonical(stable)
  });
}

function uniqueIndex<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  code: string,
  path: string,
  issues: CatalogIssue[]
): Map<string, T> {
  const result = new Map<string, T>();
  for (const [index, value] of values.entries()) {
    const key = keyOf(value);
    if (result.has(key)) {
      issues.push({
        code,
        message: `'${key}' appears more than once`,
        path: `${path}.${index}`
      });
    } else {
      result.set(key, value);
    }
  }
  return result;
}

function validateRuntimeReferences(
  runtimeIds: readonly string[],
  runtimeById: ReadonlyMap<string, RuntimeCatalogEntryV1>,
  path: string,
  issues: CatalogIssue[],
  validate: (runtime: RuntimeCatalogEntryV1) => string | undefined
): void {
  for (const runtimeId of runtimeIds) {
    const runtime = runtimeById.get(runtimeId);
    if (runtime === undefined) {
      issues.push({
        code: "UNKNOWN_RUNTIME",
        message: `runtime '${runtimeId}' is not cataloged`,
        path
      });
      continue;
    }
    const incompatibility = validate(runtime);
    if (incompatibility !== undefined) {
      issues.push({
        code: "RUNTIME_INCOMPATIBLE",
        message: `runtime '${runtimeId}' ${incompatibility}`,
        path
      });
    }
  }
}
