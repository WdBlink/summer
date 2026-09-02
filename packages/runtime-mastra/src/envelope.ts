import { JsonValueSchema, type JsonValue } from "@summer/protocol";
import { z } from "zod";

export const MASTRA_RUN_INPUT_SCHEMA_VERSION =
  "summer.mastra-run-input/v1" as const;
export const MASTRA_ENVELOPE_SCHEMA_VERSION =
  "summer.mastra-envelope/v1" as const;

export const SummerMastraRunInputV1Schema = z
  .object({
    schemaVersion: z.literal(MASTRA_RUN_INPUT_SCHEMA_VERSION),
    input: JsonValueSchema,
    campaignId: z.string().trim().min(1).optional(),
    experimentId: z.string().trim().min(1).optional()
  })
  .strict();

export type SummerMastraRunInputV1 = z.infer<
  typeof SummerMastraRunInputV1Schema
>;

export const SummerMastraEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(MASTRA_ENVELOPE_SCHEMA_VERSION),
    initialInput: JsonValueSchema,
    current: JsonValueSchema,
    outputs: z.record(z.string(), JsonValueSchema),
    lastNodeId: z.string().trim().min(1).optional(),
    campaignId: z.string().trim().min(1).optional(),
    experimentId: z.string().trim().min(1).optional()
  })
  .strict();

export type SummerMastraEnvelopeV1 = z.infer<
  typeof SummerMastraEnvelopeV1Schema
>;

export function createInitialEnvelope(
  input: SummerMastraRunInputV1
): SummerMastraEnvelopeV1 {
  return SummerMastraEnvelopeV1Schema.parse({
    schemaVersion: MASTRA_ENVELOPE_SCHEMA_VERSION,
    initialInput: input.input,
    current: input.input,
    outputs: {},
    ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
    ...(input.experimentId === undefined
      ? {}
      : { experimentId: input.experimentId })
  });
}

export function withNodeOutput(
  envelope: SummerMastraEnvelopeV1,
  nodeId: string,
  output: JsonValue
): SummerMastraEnvelopeV1 {
  return SummerMastraEnvelopeV1Schema.parse({
    schemaVersion: MASTRA_ENVELOPE_SCHEMA_VERSION,
    initialInput: envelope.initialInput,
    current: output,
    outputs: { ...envelope.outputs, [nodeId]: output },
    lastNodeId: nodeId,
    ...(envelope.campaignId === undefined
      ? {}
      : { campaignId: envelope.campaignId }),
    ...(envelope.experimentId === undefined
      ? {}
      : { experimentId: envelope.experimentId })
  });
}
