import { z } from "zod";

import {
  DecisionReceiptV1Schema,
  ExperimentReceiptV1Schema,
  FrameAssessmentV1Schema,
  NodeReceiptV1Schema,
  StopReasonSchema
} from "./receipts.js";
import {
  IdentifierSchema,
  Sha256DigestSchema,
  TimestampSchema
} from "./primitives.js";
import { ExactComponentRefSchema } from "./descriptors.js";
import { IterativeCampaignProfileV1Schema } from "./workflow.js";

export const CampaignNodeContractV1Schema = z
  .object({
    nodeId: IdentifierSchema,
    component: ExactComponentRefSchema,
    maxAttempts: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(512).optional()
  })
  .strict();

export type CampaignNodeContractV1 = z.infer<
  typeof CampaignNodeContractV1Schema
>;

const CampaignEventCommonShape = {
  schemaVersion: z.literal("summer.campaign-event/v1"),
  eventId: IdentifierSchema,
  campaignId: IdentifierSchema,
  sequence: z.number().int().nonnegative(),
  occurredAt: TimestampSchema,
  causationId: IdentifierSchema.optional(),
  correlationId: IdentifierSchema.optional()
} as const;

export const CampaignEventV1Schema = z.discriminatedUnion("type", [
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("campaign-started"),
      workflowId: IdentifierSchema,
      workflowRevision: z.number().int().positive(),
      compiledWorkflowDigest: Sha256DigestSchema,
      registryDigest: Sha256DigestSchema,
      profile: IterativeCampaignProfileV1Schema,
      nodeContracts: z.array(CampaignNodeContractV1Schema).min(1),
      frameCheckPolicyDigest: Sha256DigestSchema,
      decisionPolicyDigest: Sha256DigestSchema,
      frameVersion: z.number().int().positive(),
      hypothesisVersion: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("experiment-started"),
      experimentId: IdentifierSchema,
      experimentNumber: z.number().int().positive(),
      attemptId: IdentifierSchema,
      planDigest: Sha256DigestSchema,
      environmentDigest: Sha256DigestSchema,
      evaluatorDigest: Sha256DigestSchema,
      baselineExperimentId: IdentifierSchema.optional()
    })
    .strict(),
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("node-receipt-recorded"),
      receipt: NodeReceiptV1Schema
    })
    .strict(),
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("experiment-completed"),
      receipt: ExperimentReceiptV1Schema
    })
    .strict(),
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("frame-assessed"),
      assessment: FrameAssessmentV1Schema
    })
    .strict(),
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("decision-committed"),
      receipt: DecisionReceiptV1Schema
    })
    .strict(),
  z
    .object({
      ...CampaignEventCommonShape,
      type: z.literal("campaign-completed"),
      status: z.enum(["succeeded", "stopped", "failed"]),
      reason: StopReasonSchema
    })
    .strict()
]);

export type CampaignEventV1 = z.infer<typeof CampaignEventV1Schema>;

export function parseCampaignEventV1(input: unknown): CampaignEventV1 {
  return CampaignEventV1Schema.parse(input);
}
