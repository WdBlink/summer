import { z } from "zod";

import { ExactComponentRefSchema } from "./descriptors.js";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  JsonObjectSchema,
  NonEmptyStringSchema,
  Sha256DigestSchema,
  TimestampSchema
} from "./primitives.js";
import { DecisionKindSchema } from "./workflow.js";

export const ArtifactReferenceV1Schema = z
  .object({
    artifactId: IdentifierSchema,
    uri: NonEmptyStringSchema,
    digest: Sha256DigestSchema,
    mediaType: NonEmptyStringSchema.optional()
  })
  .strict();

export type ArtifactReferenceV1 = z.infer<typeof ArtifactReferenceV1Schema>;

export const ReceiptErrorV1Schema = z
  .object({
    code: IdentifierSchema,
    message: NonEmptyStringSchema,
    retryable: z.boolean(),
    details: JsonObjectSchema.optional()
  })
  .strict();

export type ReceiptErrorV1 = z.infer<typeof ReceiptErrorV1Schema>;

export const NodeReceiptStatusSchema = z.enum([
  "succeeded",
  "failed",
  "skipped",
  "cancelled"
]);

export const NodeReceiptV1Schema = z
  .object({
    schemaVersion: z.literal("summer.node-receipt/v1"),
    receiptId: IdentifierSchema,
    workflowId: IdentifierSchema,
    workflowRevision: z.number().int().positive(),
    compiledWorkflowDigest: Sha256DigestSchema,
    registryDigest: Sha256DigestSchema,
    runId: IdentifierSchema,
    campaignId: IdentifierSchema.optional(),
    experimentId: IdentifierSchema.optional(),
    experimentAttemptId: IdentifierSchema.optional(),
    nodeId: IdentifierSchema,
    attempt: z.number().int().positive(),
    component: ExactComponentRefSchema,
    status: NodeReceiptStatusSchema,
    idempotencyKey: z.string().trim().min(1).max(512).optional(),
    inputDigest: Sha256DigestSchema,
    outputDigest: Sha256DigestSchema.optional(),
    artifactRefs: z.array(ArtifactReferenceV1Schema).default([]),
    error: ReceiptErrorV1Schema.optional(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      (receipt.experimentId === undefined) !==
      (receipt.experimentAttemptId === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "experimentId and experimentAttemptId must either both be present or both be absent",
        path: ["experimentAttemptId"]
      });
    }
    if (receipt.status === "failed" && receipt.error === undefined) {
      context.addIssue({
        code: "custom",
        message: "failed node receipts must include error",
        path: ["error"]
      });
    }
    if (receipt.status !== "failed" && receipt.error !== undefined) {
      context.addIssue({
        code: "custom",
        message: "error is only valid for failed node receipts",
        path: ["error"]
      });
    }
    if (receipt.status === "succeeded" && receipt.outputDigest === undefined) {
      context.addIssue({
        code: "custom",
        message: "succeeded node receipts must include outputDigest",
        path: ["outputDigest"]
      });
    }
  });

export type NodeReceiptStatus = z.infer<typeof NodeReceiptStatusSchema>;
export type NodeReceiptV1 = z.infer<typeof NodeReceiptV1Schema>;

export const ExperimentStatusSchema = z.enum([
  "succeeded",
  "failed",
  "invalid",
  "cancelled"
]);

export const ChangedVariableV1Schema = z
  .object({
    name: IdentifierSchema,
    beforeDigest: Sha256DigestSchema.optional(),
    afterDigest: Sha256DigestSchema
  })
  .strict();

export const ExperimentReceiptV1Schema = z
  .object({
    schemaVersion: z.literal("summer.experiment-receipt/v1"),
    receiptId: IdentifierSchema,
    campaignId: IdentifierSchema,
    workflowId: IdentifierSchema,
    workflowRevision: z.number().int().positive(),
    compiledWorkflowDigest: Sha256DigestSchema,
    registryDigest: Sha256DigestSchema,
    frameVersion: z.number().int().positive(),
    hypothesisVersion: z.number().int().positive(),
    experimentId: IdentifierSchema,
    experimentNumber: z.number().int().positive(),
    attemptId: IdentifierSchema,
    status: ExperimentStatusSchema,
    nodeReceiptIds: z.array(IdentifierSchema).min(1),
    planDigest: Sha256DigestSchema,
    environmentDigest: Sha256DigestSchema,
    evaluatorDigest: Sha256DigestSchema,
    baselineExperimentId: IdentifierSchema.optional(),
    changedVariables: z.array(ChangedVariableV1Schema),
    metrics: z.record(z.string().min(1), z.number().finite()),
    artifactRefs: z.array(ArtifactReferenceV1Schema).default([]),
    error: ReceiptErrorV1Schema.optional(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.status === "failed" && receipt.error === undefined) {
      context.addIssue({
        code: "custom",
        message: "failed experiment receipts must include error",
        path: ["error"]
      });
    }
    if (receipt.status !== "failed" && receipt.error !== undefined) {
      context.addIssue({
        code: "custom",
        message: "error is only valid for failed experiment receipts",
        path: ["error"]
      });
    }
  });

export type ChangedVariableV1 = z.infer<typeof ChangedVariableV1Schema>;
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type ExperimentReceiptV1 = z.infer<typeof ExperimentReceiptV1Schema>;

export const FrameVerdictSchema = z.enum([
  "frame-valid",
  "recompile-required",
  "human-review-required",
  "stop-recommended"
]);

export const FrameAssessmentV1Schema = z
  .object({
    schemaVersion: z.literal("summer.frame-assessment/v1"),
    assessmentId: IdentifierSchema,
    campaignId: IdentifierSchema,
    experimentId: IdentifierSchema.optional(),
    frameVersion: z.number().int().positive(),
    policyDigest: Sha256DigestSchema,
    evaluatorDigest: Sha256DigestSchema,
    verdict: FrameVerdictSchema,
    evidence: z.array(EvidenceReferenceSchema).min(1),
    rationale: NonEmptyStringSchema,
    assessedAt: TimestampSchema
  })
  .strict();

export type FrameVerdict = z.infer<typeof FrameVerdictSchema>;
export type FrameAssessmentV1 = z.infer<typeof FrameAssessmentV1Schema>;

export const StopReasonSchema = z.enum([
  "goal-achieved",
  "budget-exhausted",
  "no-progress",
  "frame-invalid",
  "human-request",
  "fatal-error"
]);

export type StopReason = z.infer<typeof StopReasonSchema>;

const DecisionReceiptCommonShape = {
  schemaVersion: z.literal("summer.decision-receipt/v1"),
  decisionId: IdentifierSchema,
  campaignId: IdentifierSchema,
  fromExperimentId: IdentifierSchema.optional(),
  assessmentId: IdentifierSchema,
  policyDigest: Sha256DigestSchema,
  reason: NonEmptyStringSchema,
  evidenceRefs: z.array(EvidenceReferenceSchema).min(1),
  decidedAt: TimestampSchema
} as const;

export const DecisionReceiptV1Schema = z.discriminatedUnion("decision", [
  z
    .object({
      ...DecisionReceiptCommonShape,
      decision: z.literal(DecisionKindSchema.enum.replicate),
      sourceExperimentId: IdentifierSchema,
      nextExperimentId: IdentifierSchema
    })
    .strict(),
  z
    .object({
      ...DecisionReceiptCommonShape,
      decision: z.literal(DecisionKindSchema.enum["repair-runtime"]),
      experimentId: IdentifierSchema,
      nextAttemptId: IdentifierSchema
    })
    .strict(),
  z
    .object({
      ...DecisionReceiptCommonShape,
      decision: z.literal(DecisionKindSchema.enum["run-next-experiment"]),
      nextExperimentId: IdentifierSchema,
      planDigest: Sha256DigestSchema
    })
    .strict(),
  z
    .object({
      ...DecisionReceiptCommonShape,
      decision: z.literal(DecisionKindSchema.enum["recompile-hypothesis"]),
      nextExperimentId: IdentifierSchema,
      planDigest: Sha256DigestSchema,
      nextFrameVersion: z.number().int().positive(),
      nextHypothesisVersion: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      ...DecisionReceiptCommonShape,
      decision: z.literal(DecisionKindSchema.enum.wait),
      resumeAfter: TimestampSchema.optional()
    })
    .strict(),
  z
    .object({
      ...DecisionReceiptCommonShape,
      decision: z.literal(DecisionKindSchema.enum.stop),
      stopReason: StopReasonSchema
    })
    .strict()
]);

export type DecisionReceiptV1 = z.infer<typeof DecisionReceiptV1Schema>;
