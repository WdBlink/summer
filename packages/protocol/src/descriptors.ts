import { z } from "zod";

import {
  ExactVersionSchema,
  IdentifierSchema,
  JsonObjectSchema
} from "./primitives.js";

export const ExactComponentRefSchema = z
  .object({
    namespace: IdentifierSchema,
    name: IdentifierSchema,
    version: ExactVersionSchema
  })
  .strict();

export const ExactSchemaRefSchema = z
  .object({
    namespace: IdentifierSchema,
    name: IdentifierSchema,
    version: ExactVersionSchema
  })
  .strict();

export type ExactComponentRef = z.infer<typeof ExactComponentRefSchema>;
export type ExactSchemaRef = z.infer<typeof ExactSchemaRefSchema>;

export const SchemaDescriptorV1Schema = z
  .object({
    schemaVersion: z.literal("summer.schema-descriptor/v1"),
    ref: ExactSchemaRefSchema,
    jsonSchema: JsonObjectSchema
  })
  .strict();

export type SchemaDescriptorV1 = z.infer<typeof SchemaDescriptorV1Schema>;

export const ComponentKindSchema = z.enum([
  "agent",
  "tool",
  "validator",
  "human-gate",
  "nested-workflow",
  "policy"
]);

export const PolicyKindSchema = z.enum([
  "activation",
  "iteration",
  "budget",
  "frame-check",
  "decision"
]);

export const ComponentEffectSchema = z.enum([
  "none",
  "read",
  "write-idempotent",
  "write-non-idempotent"
]);

export const CapabilitySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[a-z0-9][a-z0-9._:/-]*$/,
    "capability names must be stable lowercase identifiers"
  );

const ComponentDescriptorShape = {
  schemaVersion: z.literal("summer.component-descriptor/v1"),
  ref: ExactComponentRefSchema,
  kind: ComponentKindSchema,
  policyKind: PolicyKindSchema.optional(),
  inputSchema: ExactSchemaRefSchema,
  outputSchema: ExactSchemaRefSchema,
  capabilities: z.array(CapabilitySchema).default([]),
  effect: ComponentEffectSchema,
  supportsFanout: z.boolean().default(false)
} as const;

export const ComponentDescriptorV1Schema = z
  .object(ComponentDescriptorShape)
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.kind === "policy" && descriptor.policyKind === undefined) {
      context.addIssue({
        code: "custom",
        message: "policy components must declare policyKind",
        path: ["policyKind"]
      });
    }
    if (descriptor.kind !== "policy" && descriptor.policyKind !== undefined) {
      context.addIssue({
        code: "custom",
        message: "policyKind is only valid for policy components",
        path: ["policyKind"]
      });
    }
    if (new Set(descriptor.capabilities).size !== descriptor.capabilities.length) {
      context.addIssue({
        code: "custom",
        message: "capabilities must not contain duplicates",
        path: ["capabilities"]
      });
    }
  });

export type ComponentKind = z.infer<typeof ComponentKindSchema>;
export type PolicyKind = z.infer<typeof PolicyKindSchema>;
export type ComponentEffect = z.infer<typeof ComponentEffectSchema>;
export type ComponentDescriptorV1 = z.infer<
  typeof ComponentDescriptorV1Schema
>;
