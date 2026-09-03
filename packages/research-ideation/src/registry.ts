import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  ComponentRegistry,
  type ComponentExecutor
} from "@summer/components";
import {
  type ComponentDescriptorV1,
  type JsonValue
} from "@summer/protocol";

import {
  IDEA_SPARK_EXECUTION_SCHEMA_REF,
  IDEA_SPARK_PREPARED_SCHEMA_REF,
  IDEA_SPARK_PREPARE_COMPONENT_REF,
  IDEA_SPARK_REQUEST_SCHEMA_REF,
  IDEA_SPARK_RESULT_SCHEMA_REF,
  IDEA_SPARK_RUNNER_COMPONENT_REF,
  IDEA_SPARK_VERIFY_COMPONENT_REF,
  IdeaSparkExecutionV1Schema,
  IdeaSparkPreparedV1Schema,
  IdeaSparkResultV1Schema,
  RESEARCH_IDEATION_SCHEMA_BINDINGS,
  RESEARCH_IDEATION_SCHEMA_DESCRIPTORS,
  prepareIdeaSparkRequest,
  type IdeaSparkArtifactV1,
  type IdeaSparkTerminalStatus
} from "./contracts.js";
import {
  CodexIdeaSparkDriver,
  ResearchIdeationExecutionError,
  executeIdeaSparkStages,
  type IdeaSparkDriver
} from "./driver.js";

export const RESEARCH_IDEATION_COMPONENT_DESCRIPTORS = Object.freeze([
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_PREPARE_COMPONENT_REF,
    kind: "validator",
    inputSchema: IDEA_SPARK_REQUEST_SCHEMA_REF,
    outputSchema: IDEA_SPARK_PREPARED_SCHEMA_REF,
    capabilities: ["research.ideation.prepare"],
    permissions: [],
    effect: "none",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_RUNNER_COMPONENT_REF,
    kind: "nested-workflow",
    inputSchema: IDEA_SPARK_PREPARED_SCHEMA_REF,
    outputSchema: IDEA_SPARK_EXECUTION_SCHEMA_REF,
    capabilities: ["research.ideation.idea-spark.execute"],
    permissions: [
      "filesystem.research-artifact.write",
      "network.research.retrieve",
      "process.codex.exec"
    ],
    effect: "write-idempotent",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_VERIFY_COMPONENT_REF,
    kind: "validator",
    inputSchema: IDEA_SPARK_EXECUTION_SCHEMA_REF,
    outputSchema: IDEA_SPARK_RESULT_SCHEMA_REF,
    capabilities: ["research.ideation.idea-spark.verify"],
    permissions: ["filesystem.research-artifact.read"],
    effect: "read",
    supportsFanout: false
  }
] as const satisfies readonly ComponentDescriptorV1[]);

export interface ResearchIdeationRegistryOptions {
  readonly driver?: IdeaSparkDriver;
  readonly bindExecutors?: boolean;
}

export function registerResearchIdeationComponents(
  registry: ComponentRegistry,
  options: ResearchIdeationRegistryOptions = {}
): ComponentRegistry {
  for (const [index, descriptor] of RESEARCH_IDEATION_SCHEMA_DESCRIPTORS.entries()) {
    const binding = RESEARCH_IDEATION_SCHEMA_BINDINGS[index]?.[1];
    if (binding === undefined) {
      throw new Error(`missing schema binding for ${descriptor.ref.name}`);
    }
    registry.registerSchema(descriptor, binding);
  }
  for (const descriptor of RESEARCH_IDEATION_COMPONENT_DESCRIPTORS) {
    registry.registerDescriptor(descriptor);
  }

  if (options.bindExecutors !== false) {
    const driver = (): IdeaSparkDriver =>
      options.driver ?? new CodexIdeaSparkDriver();
    registry.bindExecutor(IDEA_SPARK_PREPARE_COMPONENT_REF, prepareExecutor);
    registry.bindExecutor(
      IDEA_SPARK_RUNNER_COMPONENT_REF,
      createRunnerExecutor(driver)
    );
    registry.bindExecutor(IDEA_SPARK_VERIFY_COMPONENT_REF, verifyExecutor);
  }
  return registry;
}

const prepareExecutor: ComponentExecutor = (input) =>
  prepareIdeaSparkRequest(input) as unknown as JsonValue;

function createRunnerExecutor(
  driver: () => IdeaSparkDriver
): ComponentExecutor {
  return async (input, context) => {
    const request = IdeaSparkPreparedV1Schema.parse(input);
    const execution = await executeIdeaSparkStages(
      request,
      driver(),
      context.signal
    );
    return IdeaSparkExecutionV1Schema.parse({
      schemaVersion: "summer.research-ideation-execution/v1",
      request,
      ...execution
    }) as unknown as JsonValue;
  };
}

const verifyExecutor: ComponentExecutor = (input) =>
  verifyIdeaSparkExecution(input) as unknown as JsonValue;

export function verifyIdeaSparkExecution(input: unknown) {
  const execution = IdeaSparkExecutionV1Schema.parse(input);
  if (
    execution.navigator.category !== "terminal" ||
    execution.navigator.terminalStatus !== execution.terminalStatus
  ) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_TERMINAL_MISMATCH",
      "execution result and navigator disagree about the terminal state"
    );
  }

  const artifacts = expectedArtifacts(
    execution.request.runDir,
    execution.terminalStatus
  ).map(({artifactId, uri}) => digestArtifact(artifactId, uri));

  return IdeaSparkResultV1Schema.parse({
    schemaVersion: "summer.research-ideation-result/v1",
    status: execution.terminalStatus,
    requestDigest: execution.request.requestDigest,
    runDir: execution.request.runDir,
    navigator: execution.navigator,
    stageRuns: execution.stageRuns,
    artifacts
  });
}

function expectedArtifacts(
  runDir: string,
  status: IdeaSparkTerminalStatus
): readonly {readonly artifactId: string; readonly uri: string}[] {
  if (status === "done") {
    return [
      {artifactId: "idea-std-zh", uri: resolve(runDir, "phase4", "idea.std.zh.md")},
      {artifactId: "idea-std-en", uri: resolve(runDir, "phase4", "idea.std.en.md")},
      {artifactId: "idea-detail-en", uri: resolve(runDir, "phase4", "idea.detail.en.md")}
    ];
  }
  if (status === "do-not-generate") {
    return [
      {artifactId: "do-not-generate", uri: resolve(runDir, "do_not_generate.md")}
    ];
  }
  return [
    {artifactId: "phase-3-failed", uri: resolve(runDir, "phase_3_failed.md")}
  ];
}

function digestArtifact(artifactId: string, uri: string): IdeaSparkArtifactV1 {
  let content: Buffer;
  try {
    const stat = statSync(uri);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error("artifact is not a non-empty regular file");
    }
    content = readFileSync(uri);
  } catch (error) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_ARTIFACT_INVALID",
      `required terminal artifact '${uri}' is missing or invalid`,
      {message: error instanceof Error ? error.message : String(error)}
    );
  }
  return {
    artifactId,
    uri,
    digest: createHash("sha256").update(content).digest("hex"),
    mediaType: "text/markdown"
  };
}

export type {IdeaSparkDriver} from "./driver.js";
export type {IdeaSparkExecutionV1} from "./contracts.js";
