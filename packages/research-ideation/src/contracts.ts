import { isAbsolute, relative, resolve } from "node:path";

import {
  sha256Canonical,
  type ExactComponentRef,
  type ExactSchemaRef,
  type JsonValue,
  type SchemaDescriptorV1
} from "@summer/protocol";
import { z } from "zod";

export const RESEARCH_IDEATION_VERSION = "1.0.0" as const;

export const IDEA_SPARK_REQUEST_SCHEMA_REF = {
  namespace: "researchstudio",
  name: "idea-spark-request",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactSchemaRef;

export const IDEA_SPARK_PREPARED_SCHEMA_REF = {
  namespace: "researchstudio",
  name: "idea-spark-prepared",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactSchemaRef;

export const IDEA_SPARK_EXECUTION_SCHEMA_REF = {
  namespace: "researchstudio",
  name: "idea-spark-execution",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactSchemaRef;

export const IDEA_SPARK_RESULT_SCHEMA_REF = {
  namespace: "researchstudio",
  name: "idea-spark-result",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactSchemaRef;

export const IDEA_SPARK_PREPARE_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-prepare",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactComponentRef;

export const IDEA_SPARK_RUNNER_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-runner",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactComponentRef;

export const IDEA_SPARK_VERIFY_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-verify",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactComponentRef;

const AbsolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(isAbsolute, "must be an absolute path");

export const IdeaSparkRequestV1Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-request/v1"),
    query: z.string().trim().min(1).max(20_000),
    workspaceDir: AbsolutePathSchema,
    runDir: AbsolutePathSchema
  })
  .strict()
  .superRefine((request, context) => {
    const expectedRoot = resolve(request.workspaceDir, "ideaspark_run");
    const runDir = resolve(request.runDir);
    const child = relative(expectedRoot, runDir);
    if (child.length === 0 || child.startsWith("..") || isAbsolute(child)) {
      context.addIssue({
        code: "custom",
        path: ["runDir"],
        message: "runDir must name one child directory under <workspaceDir>/ideaspark_run"
      });
    }
  });

export type IdeaSparkRequestV1 = z.infer<typeof IdeaSparkRequestV1Schema>;

export const IdeaSparkPreparedV1Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-prepared/v1"),
    query: z.string().min(1).max(20_000),
    workspaceDir: AbsolutePathSchema,
    runDir: AbsolutePathSchema,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type IdeaSparkPreparedV1 = z.infer<typeof IdeaSparkPreparedV1Schema>;

export const IdeaSparkStageSchema = z.enum([
  "literature-grounding",
  "bottleneck-diagnosis",
  "candidate-generation",
  "coherence-collision",
  "quality-gauntlet",
  "package-render"
]);

export type IdeaSparkStage = z.infer<typeof IdeaSparkStageSchema>;

export const IDEA_SPARK_STAGES = Object.freeze([
  "literature-grounding",
  "bottleneck-diagnosis",
  "candidate-generation",
  "coherence-collision",
  "quality-gauntlet",
  "package-render"
] as const satisfies readonly IdeaSparkStage[]);

export const IdeaSparkNavigatorCategorySchema = z.enum([
  "phase0",
  "phase1",
  "phase2-generation",
  "phase2-coherence",
  "phase3",
  "phase4",
  "terminal"
]);

export type IdeaSparkNavigatorCategory = z.infer<
  typeof IdeaSparkNavigatorCategorySchema
>;

export const IdeaSparkTerminalStatusSchema = z.enum([
  "done",
  "do-not-generate",
  "phase-3-failed"
]);

export type IdeaSparkTerminalStatus = z.infer<
  typeof IdeaSparkTerminalStatusSchema
>;

export const IdeaSparkNavigatorSnapshotV1Schema = z
  .object({
    schemaVersion: z.literal("summer.idea-spark-navigator-snapshot/v1"),
    state: z.string().trim().min(1),
    step: z.string().trim().min(1),
    type: z.string().trim().min(1),
    category: IdeaSparkNavigatorCategorySchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    terminalStatus: IdeaSparkTerminalStatusSchema.optional()
  })
  .strict();

export type IdeaSparkNavigatorSnapshotV1 = z.infer<
  typeof IdeaSparkNavigatorSnapshotV1Schema
>;

export const IdeaSparkStageRunV1Schema = z
  .object({
    schemaVersion: z.literal("summer.idea-spark-stage-run/v1"),
    stage: IdeaSparkStageSchema,
    skipped: z.boolean(),
    before: IdeaSparkNavigatorSnapshotV1Schema,
    after: IdeaSparkNavigatorSnapshotV1Schema,
    workerMessagePath: AbsolutePathSchema.optional()
  })
  .strict();

export type IdeaSparkStageRunV1 = z.infer<typeof IdeaSparkStageRunV1Schema>;

export const IdeaSparkExecutionV1Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-execution/v1"),
    request: IdeaSparkPreparedV1Schema,
    terminalStatus: IdeaSparkTerminalStatusSchema,
    navigator: IdeaSparkNavigatorSnapshotV1Schema,
    stageRuns: z.array(IdeaSparkStageRunV1Schema).min(1)
  })
  .strict();

export type IdeaSparkExecutionV1 = z.infer<typeof IdeaSparkExecutionV1Schema>;

export const IdeaSparkArtifactV1Schema = z
  .object({
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    uri: AbsolutePathSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().trim().min(1)
  })
  .strict();

export type IdeaSparkArtifactV1 = z.infer<typeof IdeaSparkArtifactV1Schema>;

export const IdeaSparkResultV1Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-result/v1"),
    status: IdeaSparkTerminalStatusSchema,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    runDir: AbsolutePathSchema,
    navigator: IdeaSparkNavigatorSnapshotV1Schema,
    stageRuns: z.array(IdeaSparkStageRunV1Schema).min(1),
    artifacts: z.array(IdeaSparkArtifactV1Schema).min(1)
  })
  .strict();

export type IdeaSparkResultV1 = z.infer<typeof IdeaSparkResultV1Schema>;

export function prepareIdeaSparkRequest(input: unknown): IdeaSparkPreparedV1 {
  const request = IdeaSparkRequestV1Schema.parse(input);
  return IdeaSparkPreparedV1Schema.parse({
    schemaVersion: "summer.research-ideation-prepared/v1",
    query: request.query,
    workspaceDir: resolve(request.workspaceDir),
    runDir: resolve(request.runDir),
    requestDigest: sha256Canonical(request as unknown as JsonValue)
  });
}

function objectSchema(
  id: string,
  required: readonly string[],
  properties: Record<string, JsonValue>
): Record<string, JsonValue> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    type: "object",
    additionalProperties: false,
    required: [...required],
    properties
  };
}

const stringProperty = { type: "string", minLength: 1 } as const;

export const RESEARCH_IDEATION_SCHEMA_DESCRIPTORS: readonly SchemaDescriptorV1[] =
  Object.freeze([
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: IDEA_SPARK_REQUEST_SCHEMA_REF,
      jsonSchema: objectSchema(
        "summer.research-ideation-request/v1",
        ["schemaVersion", "query", "workspaceDir", "runDir"],
        {
          schemaVersion: { const: "summer.research-ideation-request/v1" },
          query: {...stringProperty, maxLength: 20_000},
          workspaceDir: stringProperty,
          runDir: stringProperty
        }
      )
    },
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: IDEA_SPARK_PREPARED_SCHEMA_REF,
      jsonSchema: objectSchema(
        "summer.research-ideation-prepared/v1",
        ["schemaVersion", "query", "workspaceDir", "runDir", "requestDigest"],
        {
          schemaVersion: { const: "summer.research-ideation-prepared/v1" },
          query: stringProperty,
          workspaceDir: stringProperty,
          runDir: stringProperty,
          requestDigest: {type: "string", pattern: "^[a-f0-9]{64}$"}
        }
      )
    },
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: IDEA_SPARK_EXECUTION_SCHEMA_REF,
      jsonSchema: objectSchema(
        "summer.research-ideation-execution/v1",
        ["schemaVersion", "request", "terminalStatus", "navigator", "stageRuns"],
        {
          schemaVersion: { const: "summer.research-ideation-execution/v1" },
          request: {type: "object"},
          terminalStatus: {enum: ["done", "do-not-generate", "phase-3-failed"]},
          navigator: {type: "object"},
          stageRuns: {type: "array", minItems: 1}
        }
      )
    },
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: IDEA_SPARK_RESULT_SCHEMA_REF,
      jsonSchema: objectSchema(
        "summer.research-ideation-result/v1",
        ["schemaVersion", "status", "requestDigest", "runDir", "navigator", "stageRuns", "artifacts"],
        {
          schemaVersion: { const: "summer.research-ideation-result/v1" },
          status: {enum: ["done", "do-not-generate", "phase-3-failed"]},
          requestDigest: {type: "string", pattern: "^[a-f0-9]{64}$"},
          runDir: stringProperty,
          navigator: {type: "object"},
          stageRuns: {type: "array", minItems: 1},
          artifacts: {type: "array", minItems: 1}
        }
      )
    }
  ]);

export const RESEARCH_IDEATION_SCHEMA_BINDINGS = Object.freeze([
  [IDEA_SPARK_REQUEST_SCHEMA_REF, IdeaSparkRequestV1Schema],
  [IDEA_SPARK_PREPARED_SCHEMA_REF, IdeaSparkPreparedV1Schema],
  [IDEA_SPARK_EXECUTION_SCHEMA_REF, IdeaSparkExecutionV1Schema],
  [IDEA_SPARK_RESULT_SCHEMA_REF, IdeaSparkResultV1Schema]
] as const);
