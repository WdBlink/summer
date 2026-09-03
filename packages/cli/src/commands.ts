import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  matchCatalog,
  validateExtensionProposal,
  type CompiledSummerCatalogV1,
  type ExtensionValidationReportV1,
  type SummerMatchResultV1
} from "@summer/catalog";
import { WorkflowCompileError, compileWorkflow } from "@summer/compiler";
import {
  parseWorkflowSpecV1,
  type CompiledWorkflowV1,
  type NodeReceiptV1,
  type WorkflowSpecV1
} from "@summer/protocol";
import type { ResearchIdeationRegistryOptions } from "@summer/research-ideation";
import {
  SummerMastraEnvelopeV1Schema,
  createMastraWorkflow,
  type MastraAdapterPlanV1,
  type SummerMastraEnvelopeV1
} from "@summer/runtime-mastra";

import {
  FIXTURE_CONFORMANCE_REGISTRY_ID,
  createFixtureConformanceRegistry
} from "./conformance-registry.js";
import { FIXTURE_WORKFLOWS } from "./fixtures.js";
import {
  REPOSITORY_REGISTRY_ID,
  compileRepositoryCatalog,
  createRepositoryRegistry,
  repositoryRuntimeValidators
} from "./repository-catalog.js";

export { FIXTURE_WORKFLOWS } from "./fixtures.js";

export interface WorkflowValidationResult {
  readonly ok: true;
  readonly command: "validate";
  readonly file: string;
  readonly workflow: {
    readonly schemaVersion: WorkflowSpecV1["schemaVersion"];
    readonly workflowId: string;
    readonly revision: number;
    readonly profile: WorkflowSpecV1["profile"]["kind"];
    readonly nodeCount: number;
    readonly edgeCount: number;
  };
}

export interface WorkflowCompilationResult {
  readonly ok: true;
  readonly command: "compile";
  readonly file: string;
  readonly registry: {
    readonly id: string;
    readonly registryDigest: string;
    readonly executorBindings: boolean;
  };
  readonly workflow: CompiledWorkflowV1;
}

export interface WorkflowRunResult {
  readonly ok: true;
  readonly command: "run";
  readonly workflowId: string;
  readonly revision: number;
  readonly inputFile: string;
  readonly runId: string;
  readonly compiledWorkflowDigest: string;
  readonly registryDigest: string;
  readonly plan: MastraAdapterPlanV1;
  readonly result: SummerMastraEnvelopeV1;
}

export interface FixtureCompilationSummary {
  readonly file: string;
  readonly workflowId: string;
  readonly revision: number;
  readonly profile: WorkflowSpecV1["profile"]["kind"];
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly sourceDigest: string;
  readonly registryDigest: string;
  readonly compiledDigest: string;
}

export interface FixtureCompilationResult {
  readonly ok: true;
  readonly command: "fixtures";
  readonly registry: {
    readonly id: typeof FIXTURE_CONFORMANCE_REGISTRY_ID;
    readonly registryDigest: string;
    readonly executorBindings: false;
  };
  readonly fixtureCount: number;
  readonly fixtures: readonly FixtureCompilationSummary[];
}

export interface CatalogInspectionResult {
  readonly ok: true;
  readonly command: "catalog";
  readonly catalog: CompiledSummerCatalogV1;
}

export interface CatalogMatchCommandResult {
  readonly ok: true;
  readonly command: "match";
  readonly file: string;
  readonly result: SummerMatchResultV1;
}

export interface CatalogIntentMatchCommandResult {
  readonly ok: true;
  readonly command: "match-intent";
  readonly result: SummerMatchResultV1;
}

export interface ExtensionCheckCommandResult {
  readonly ok: boolean;
  readonly command: "extension-check";
  readonly file: string;
  readonly result: ExtensionValidationReportV1;
}

export class SummerCliOperationError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SummerCliOperationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function readWorkflowFile(filePath: string): {
  readonly absolutePath: string;
  readonly workflow: WorkflowSpecV1;
} {
  const absolutePath = resolve(filePath);
  let source: string;
  try {
    source = readFileSync(absolutePath, "utf8");
  } catch (error) {
    throw new SummerCliOperationError(
      "FILE_READ_FAILED",
      `Could not read workflow file '${absolutePath}'`,
      nodeErrorDetails(error)
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new SummerCliOperationError(
      "INVALID_JSON",
      `Workflow file '${absolutePath}' is not valid JSON`,
      nodeErrorDetails(error)
    );
  }

  try {
    return { absolutePath, workflow: parseWorkflowSpecV1(value) };
  } catch (error) {
    throw new SummerCliOperationError(
      "INVALID_WORKFLOW",
      `Workflow file '${absolutePath}' does not match summer.workflow/v1`,
      validationErrorDetails(error)
    );
  }
}

export function readJsonFile(filePath: string): {
  readonly absolutePath: string;
  readonly value: unknown;
} {
  const absolutePath = resolve(filePath);
  let source: string;
  try {
    source = readFileSync(absolutePath, "utf8");
  } catch (error) {
    throw new SummerCliOperationError(
      "FILE_READ_FAILED",
      `Could not read JSON file '${absolutePath}'`,
      nodeErrorDetails(error)
    );
  }
  try {
    return { absolutePath, value: JSON.parse(source) as unknown };
  } catch (error) {
    throw new SummerCliOperationError(
      "INVALID_JSON",
      `File '${absolutePath}' is not valid JSON`,
      nodeErrorDetails(error)
    );
  }
}

export function validateWorkflowFile(filePath: string): WorkflowValidationResult {
  const { absolutePath, workflow } = readWorkflowFile(filePath);
  return {
    ok: true,
    command: "validate",
    file: absolutePath,
    workflow: {
      schemaVersion: workflow.schemaVersion,
      workflowId: workflow.workflowId,
      revision: workflow.revision,
      profile: workflow.profile.kind,
      nodeCount: workflow.nodes.length,
      edgeCount: workflow.edges.length
    }
  };
}

export function compileWorkflowFile(filePath: string): WorkflowCompilationResult {
  const { absolutePath, workflow } = readWorkflowFile(filePath);
  const registry = createRepositoryRegistry();

  try {
    const compiled = compileWorkflow(workflow, registry);
    return {
      ok: true,
      command: "compile",
      file: absolutePath,
      registry: {
        id: REPOSITORY_REGISTRY_ID,
        registryDigest: registry.digest(),
        executorBindings: compiled.nodes.every((node) =>
          registry.hasExecutor(node.component)
        )
      },
      workflow: compiled
    };
  } catch (error) {
    if (error instanceof WorkflowCompileError) {
      throw new SummerCliOperationError(
        error.code,
        `Workflow file '${absolutePath}' failed compilation`,
        error.issues
      );
    }
    throw error;
  }
}

export async function runRepositoryWorkflow(
  projectRoot: string,
  workflowId: string,
  inputFilePath: string,
  registryOptions: ResearchIdeationRegistryOptions = {}
): Promise<WorkflowRunResult> {
  const { absolutePath, value } = readJsonFile(inputFilePath);
  const catalog = compileRepositoryCatalog(projectRoot);
  const entry = catalog.workflows.find(
    (candidate) => candidate.workflowId === workflowId
  );
  if (entry === undefined) {
    throw new SummerCliOperationError(
      "WORKFLOW_NOT_FOUND",
      `Workflow '${workflowId}' is not present in the repository catalog`
    );
  }
  const runtimeById = new Map(
    catalog.runtimes.map((runtime) => [runtime.runtimeId, runtime])
  );
  const executable =
    entry.status === "available" &&
    entry.profile === "bounded-flow" &&
    entry.runtimeIds.includes("mastra-v0") &&
    runtimeById.get("mastra-v0")?.status === "available" &&
    runtimeById.get("mastra-v0")?.executorBindings === true;
  if (!executable) {
    throw new SummerCliOperationError(
      "WORKFLOW_NOT_DISPATCHABLE",
      `Workflow '${workflowId}@${entry.revision}' is cataloged but not dispatchable`,
      {status: entry.status, runtimeIds: entry.runtimeIds}
    );
  }

  const registry = createRepositoryRegistry(registryOptions);
  const source = readWorkflowFile(resolve(projectRoot, entry.sourcePath)).workflow;
  let compiled: CompiledWorkflowV1;
  try {
    compiled = compileWorkflow(source, registry);
  } catch (error) {
    if (error instanceof WorkflowCompileError) {
      throw new SummerCliOperationError(
        error.code,
        `Workflow '${workflowId}@${entry.revision}' failed compilation`,
        error.issues
      );
    }
    throw error;
  }
  if (compiled.compiledDigest !== entry.compiledWorkflowDigest) {
    throw new SummerCliOperationError(
      "CATALOG_WORKFLOW_DIGEST_MISMATCH",
      `Workflow '${workflowId}@${entry.revision}' differs from its compiled catalog entry`
    );
  }

  const observedReceipts: NodeReceiptV1[] = [];
  const binding = createMastraWorkflow(compiled, registry, {
    onReceipt: (receipt) => {
      observedReceipts.push(receipt);
    }
  });
  const runId = `run-${randomUUID()}`;
  const run = await binding.workflow.createRun({runId});
  const execution = await run.start({
    inputData: {
      schemaVersion: "summer.mastra-run-input/v1",
      input: value
    }
  });
  if (execution.status !== "success") {
    throw new SummerCliOperationError(
      "WORKFLOW_EXECUTION_FAILED",
      `Workflow '${workflowId}@${entry.revision}' did not complete successfully`,
      execution.status === "failed"
        ? {
            status: execution.status,
            error: nodeErrorDetails(execution.error),
            receipts: observedReceipts
          }
        : {status: execution.status}
    );
  }

  return {
    ok: true,
    command: "run",
    workflowId: compiled.workflowId,
    revision: compiled.revision,
    inputFile: absolutePath,
    runId,
    compiledWorkflowDigest: compiled.compiledDigest,
    registryDigest: compiled.registryDigest,
    plan: binding.plan,
    result: SummerMastraEnvelopeV1Schema.parse(execution.result)
  };
}

export function compileFixtureWorkflows(projectRoot: string): FixtureCompilationResult {
  const registry = createFixtureConformanceRegistry();
  const fixtures = FIXTURE_WORKFLOWS.map(({ fileName, workflowId }) => {
    const file = resolve(projectRoot, "fixtures", "workflows", fileName);
    const loaded = readWorkflowFile(file);
    if (loaded.workflow.workflowId !== workflowId) {
      throw new SummerCliOperationError(
        "FIXTURE_ID_MISMATCH",
        `Fixture '${fileName}' declared workflowId '${loaded.workflow.workflowId}', expected '${workflowId}'`
      );
    }

    let compiled: CompiledWorkflowV1;
    try {
      compiled = compileWorkflow(loaded.workflow, registry);
    } catch (error) {
      if (error instanceof WorkflowCompileError) {
        throw new SummerCliOperationError(
          error.code,
          `Fixture '${fileName}' failed compilation`,
          error.issues
        );
      }
      throw error;
    }

    return {
      file,
      workflowId: compiled.workflowId,
      revision: compiled.revision,
      profile: compiled.profile.kind,
      nodeCount: compiled.nodes.length,
      edgeCount: compiled.edges.length,
      sourceDigest: compiled.sourceDigest,
      registryDigest: compiled.registryDigest,
      compiledDigest: compiled.compiledDigest
    };
  });

  return {
    ok: true,
    command: "fixtures",
    registry: {
      id: FIXTURE_CONFORMANCE_REGISTRY_ID,
      registryDigest: registry.digest(),
      executorBindings: false
    },
    fixtureCount: fixtures.length,
    fixtures
  };
}

export function inspectRepositoryCatalog(
  projectRoot: string
): CatalogInspectionResult {
  return {
    ok: true,
    command: "catalog",
    catalog: compileRepositoryCatalog(projectRoot)
  };
}

export function matchRepositoryCatalog(
  projectRoot: string,
  filePath: string
): CatalogMatchCommandResult {
  const { absolutePath, value } = readJsonFile(filePath);
  const catalog = compileRepositoryCatalog(projectRoot);
  try {
    return {
      ok: true,
      command: "match",
      file: absolutePath,
      result: matchCatalog(value, catalog)
    };
  } catch (error) {
    throw new SummerCliOperationError(
      "INVALID_MATCH_REQUEST",
      `Match request '${absolutePath}' does not match summer.match-request/v1`,
      validationErrorDetails(error)
    );
  }
}

export function matchRepositoryIntent(
  projectRoot: string,
  intent: string
): CatalogIntentMatchCommandResult {
  const catalog = compileRepositoryCatalog(projectRoot);
  try {
    return {
      ok: true,
      command: "match-intent",
      result: matchCatalog(
        {
          schemaVersion: "summer.match-request/v1",
          intent,
          target: "all"
        },
        catalog
      )
    };
  } catch (error) {
    throw new SummerCliOperationError(
      "INVALID_MATCH_REQUEST",
      "Natural-language match intent is invalid",
      validationErrorDetails(error)
    );
  }
}

export function checkRepositoryExtension(
  projectRoot: string,
  filePath: string
): ExtensionCheckCommandResult {
  const { absolutePath, value } = readJsonFile(filePath);
  const catalog = compileRepositoryCatalog(projectRoot);
  const result = validateExtensionProposal(value, {
    catalog,
    registry: createRepositoryRegistry(),
    runtimeWorkflowValidators: repositoryRuntimeValidators()
  });
  return {
    ok: result.valid,
    command: "extension-check",
    file: absolutePath,
    result
  };
}

function validationErrorDetails(error: unknown): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { readonly issues?: unknown }).issues)
  ) {
    return (error as { readonly issues: readonly unknown[] }).issues.map((issue) => {
      if (typeof issue !== "object" || issue === null) return { message: String(issue) };
      const value = issue as {
        readonly code?: unknown;
        readonly message?: unknown;
        readonly path?: unknown;
      };
      return {
        code: String(value.code ?? "validation_error"),
        message: String(value.message ?? "Validation failed"),
        path: Array.isArray(value.path) ? value.path.map(String).join(".") : ""
      };
    });
  }
  return nodeErrorDetails(error);
}

function nodeErrorDetails(error: unknown): { readonly message: string; readonly code?: string } {
  if (!(error instanceof Error)) return { message: String(error) };
  const code =
    "code" in error && typeof (error as { readonly code?: unknown }).code === "string"
      ? (error as { readonly code: string }).code
      : undefined;
  return {
    message: error.message,
    ...(code === undefined ? {} : { code })
  };
}
