import { z } from "zod";

import { ComponentDescriptorV1Schema, ExactComponentRefSchema } from "./descriptors.js";
import { sha256Canonical } from "./canonical.js";
import {
  IdentifierSchema,
  JsonObjectSchema,
  JsonValueSchema,
  Sha256DigestSchema,
  TimestampSchema
} from "./primitives.js";

export const WORKFLOW_SCHEMA_VERSION = "summer.workflow/v1" as const;
export const COMPILED_WORKFLOW_SCHEMA_VERSION =
  "summer.compiled-workflow/v1" as const;

export const DecisionKindSchema = z.enum([
  "replicate",
  "repair-runtime",
  "run-next-experiment",
  "recompile-hypothesis",
  "wait",
  "stop"
]);

export type DecisionKind = z.infer<typeof DecisionKindSchema>;

export const EdgeConditionV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }).strict(),
  z.object({ kind: z.literal("node-succeeded") }).strict(),
  z.object({ kind: z.literal("node-failed") }).strict(),
  z
    .object({
      kind: z.literal("decision-is"),
      decision: DecisionKindSchema
    })
    .strict()
]);

export type EdgeConditionV1 = z.infer<typeof EdgeConditionV1Schema>;

export const NodeDispatchSchema = z.enum(["route", "fanout"]);
export const NodeJoinSchema = z.enum(["all", "any"]);

export const WorkflowNodeV1Schema = z
  .object({
    id: IdentifierSchema,
    component: ExactComponentRefSchema,
    input: JsonValueSchema.optional(),
    join: NodeJoinSchema.optional(),
    dispatch: NodeDispatchSchema.default("route"),
    timeoutMs: z.number().int().positive().optional(),
    maxAttempts: z.number().int().positive().default(1),
    idempotencyKey: z.string().trim().min(1).max(512).optional()
  })
  .strict();

export type NodeDispatch = z.infer<typeof NodeDispatchSchema>;
export type NodeJoin = z.infer<typeof NodeJoinSchema>;
export type WorkflowNodeV1 = z.infer<typeof WorkflowNodeV1Schema>;

export const WorkflowEdgeV1Schema = z
  .object({
    id: IdentifierSchema,
    from: IdentifierSchema,
    to: IdentifierSchema,
    condition: EdgeConditionV1Schema
  })
  .strict();

export type WorkflowEdgeV1 = z.infer<typeof WorkflowEdgeV1Schema>;

export const BoundedFlowProfileV1Schema = z
  .object({
    kind: z.literal("bounded-flow"),
    terminalNodeIds: z.array(IdentifierSchema).min(1)
  })
  .strict();

export const IterativeCampaignProfileV1Schema = z
  .object({
    kind: z.literal("iterative-campaign"),
    terminalNodeIds: z.array(IdentifierSchema).min(1),
    activationNodeId: IdentifierSchema,
    iterationNodeId: IdentifierSchema,
    experimentNodeId: IdentifierSchema,
    budgetNodeId: IdentifierSchema,
    frameCheckNodeId: IdentifierSchema,
    decisionNodeId: IdentifierSchema,
    budgets: z
      .object({
        maxExperiments: z.number().int().positive(),
        maxAttemptsPerExperiment: z.number().int().positive(),
        maxTotalNodeExecutions: z.number().int().positive().optional()
      })
      .strict()
  })
  .strict();

export const WorkflowProfileV1Schema = z.discriminatedUnion("kind", [
  BoundedFlowProfileV1Schema,
  IterativeCampaignProfileV1Schema
]);

export type BoundedFlowProfileV1 = z.infer<typeof BoundedFlowProfileV1Schema>;
export type IterativeCampaignProfileV1 = z.infer<
  typeof IterativeCampaignProfileV1Schema
>;
export type WorkflowProfileV1 = z.infer<typeof WorkflowProfileV1Schema>;

export const WorkflowSpecV1Schema = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    workflowId: IdentifierSchema,
    revision: z.number().int().positive(),
    profile: WorkflowProfileV1Schema,
    entryNodeId: IdentifierSchema,
    nodes: z.array(WorkflowNodeV1Schema).min(1),
    edges: z.array(WorkflowEdgeV1Schema),
    metadata: JsonObjectSchema.optional()
  })
  .strict();

export type WorkflowSpecV1 = z.infer<typeof WorkflowSpecV1Schema>;
export type WorkflowSourceV1 = WorkflowSpecV1;
export const WorkflowSourceV1Schema = WorkflowSpecV1Schema;

export function parseWorkflowSpecV1(input: unknown): WorkflowSpecV1 {
  return WorkflowSpecV1Schema.parse(input);
}

export const CompiledWorkflowNodeV1Schema = WorkflowNodeV1Schema.extend({
  resolvedComponent: ComponentDescriptorV1Schema
}).strict();

export type CompiledWorkflowNodeV1 = z.infer<
  typeof CompiledWorkflowNodeV1Schema
>;

const CompiledWorkflowV1BaseSchema = z
  .object({
    schemaVersion: z.literal(COMPILED_WORKFLOW_SCHEMA_VERSION),
    workflowId: IdentifierSchema,
    revision: z.number().int().positive(),
    profile: WorkflowProfileV1Schema,
    entryNodeId: IdentifierSchema,
    nodes: z.array(CompiledWorkflowNodeV1Schema).min(1),
    edges: z.array(WorkflowEdgeV1Schema),
    metadata: JsonObjectSchema.optional(),
    sourceDigest: Sha256DigestSchema,
    registryDigest: Sha256DigestSchema,
    compiledDigest: Sha256DigestSchema,
    compiledAt: TimestampSchema
  })
  .strict();

export const CompiledWorkflowV1Schema = CompiledWorkflowV1BaseSchema.superRefine(
  (workflow, context) => {
    const { compiledAt: _compiledAt, compiledDigest: _compiledDigest, ...stable } =
      workflow;
    const expected = sha256Canonical(stable);
    if (workflow.compiledDigest !== expected) {
      context.addIssue({
        code: "custom",
        message:
          "compiledDigest must hash the canonical compiled workflow without compiledAt or compiledDigest",
        path: ["compiledDigest"]
      });
    }
  }
);

export type CompiledWorkflowV1 = z.infer<typeof CompiledWorkflowV1Schema>;

export type CompiledWorkflowDigestInput = Omit<
  CompiledWorkflowV1,
  "compiledAt" | "compiledDigest"
>;

export function computeCompiledWorkflowDigest(
  workflow: CompiledWorkflowDigestInput
): string {
  return sha256Canonical(workflow);
}

export function parseCompiledWorkflowV1(input: unknown): CompiledWorkflowV1 {
  return CompiledWorkflowV1Schema.parse(input);
}
