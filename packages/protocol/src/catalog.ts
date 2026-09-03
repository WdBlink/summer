import { z } from "zod";

import {
  CapabilitySchema,
  ComponentEffectSchema,
  ComponentKindSchema,
  ExactComponentRefSchema
} from "./descriptors.js";
import {
  IdentifierSchema,
  NonEmptyStringSchema,
  Sha256DigestSchema
} from "./primitives.js";

export const CatalogEntryStatusSchema = z.enum([
  "candidate",
  "fixture",
  "available",
  "deprecated"
]);

export const WorkflowProfileKindSchema = z.enum([
  "bounded-flow",
  "iterative-campaign"
]);

const SelectorTextSchema = NonEmptyStringSchema.max(160);
const RelativeSourcePathSchema = NonEmptyStringSchema.max(512).superRefine(
  (value, context) => {
    if (value.startsWith("/") || value.split("/").includes("..")) {
      context.addIssue({
        code: "custom",
        message: "sourcePath must be repository-relative and must not contain '..'"
      });
    }
  }
);

function uniqueValues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: readonly (string | number)[]
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message: "values must not contain duplicates",
      path: [...path]
    });
  }
}

export const CatalogSelectorsV1Schema = z
  .object({
    phrases: z.array(SelectorTextSchema).min(1),
    keywords: z.array(SelectorTextSchema).min(1),
    domains: z.array(SelectorTextSchema).default([])
  })
  .strict()
  .superRefine((selectors, context) => {
    uniqueValues(selectors.phrases, context, ["phrases"]);
    uniqueValues(selectors.keywords, context, ["keywords"]);
    uniqueValues(selectors.domains, context, ["domains"]);
  });

export const WorkflowCatalogEntryV1Schema = z
  .object({
    schemaVersion: z.literal("summer.workflow-catalog-entry/v1"),
    workflowId: IdentifierSchema,
    revision: z.number().int().positive(),
    profile: WorkflowProfileKindSchema,
    title: NonEmptyStringSchema.max(160),
    summary: NonEmptyStringSchema.max(1000),
    sourcePath: RelativeSourcePathSchema,
    status: CatalogEntryStatusSchema,
    capabilities: z.array(CapabilitySchema).min(1),
    selectors: CatalogSelectorsV1Schema,
    runtimeIds: z.array(IdentifierSchema).min(1)
  })
  .strict()
  .superRefine((entry, context) => {
    uniqueValues(entry.capabilities, context, ["capabilities"]);
    uniqueValues(entry.runtimeIds, context, ["runtimeIds"]);
  });

export type WorkflowCatalogEntryV1 = z.infer<
  typeof WorkflowCatalogEntryV1Schema
>;

export const ComponentCatalogEntryV1Schema = z
  .object({
    schemaVersion: z.literal("summer.component-catalog-entry/v1"),
    component: ExactComponentRefSchema,
    title: NonEmptyStringSchema.max(160),
    summary: NonEmptyStringSchema.max(1000),
    status: CatalogEntryStatusSchema,
    keywords: z.array(SelectorTextSchema).min(1),
    domains: z.array(SelectorTextSchema).default([]),
    runtimeIds: z.array(IdentifierSchema).min(1)
  })
  .strict()
  .superRefine((entry, context) => {
    uniqueValues(entry.keywords, context, ["keywords"]);
    uniqueValues(entry.domains, context, ["domains"]);
    uniqueValues(entry.runtimeIds, context, ["runtimeIds"]);
  });

export type ComponentCatalogEntryV1 = z.infer<
  typeof ComponentCatalogEntryV1Schema
>;

export const RuntimePersistenceSchema = z.enum([
  "none",
  "in-memory",
  "durable"
]);

export const RuntimeCatalogEntryV1Schema = z
  .object({
    schemaVersion: z.literal("summer.runtime-catalog-entry/v1"),
    runtimeId: IdentifierSchema,
    title: NonEmptyStringSchema.max(160),
    summary: NonEmptyStringSchema.max(1000),
    status: CatalogEntryStatusSchema,
    supportedProfiles: z.array(WorkflowProfileKindSchema).min(1),
    supportedComponentKinds: z.array(ComponentKindSchema).min(1),
    supportedEffects: z.array(ComponentEffectSchema).min(1),
    capabilities: z.array(CapabilitySchema).min(1),
    limitations: z.array(NonEmptyStringSchema.max(500)).default([]),
    persistence: RuntimePersistenceSchema,
    executorBindings: z.boolean()
  })
  .strict()
  .superRefine((entry, context) => {
    uniqueValues(entry.supportedProfiles, context, ["supportedProfiles"]);
    uniqueValues(entry.supportedComponentKinds, context, ["supportedComponentKinds"]);
    uniqueValues(entry.supportedEffects, context, ["supportedEffects"]);
    uniqueValues(entry.capabilities, context, ["capabilities"]);
    uniqueValues(entry.limitations, context, ["limitations"]);
  });

export type RuntimeCatalogEntryV1 = z.infer<
  typeof RuntimeCatalogEntryV1Schema
>;

export const SummerCatalogV1Schema = z
  .object({
    schemaVersion: z.literal("summer.catalog/v1"),
    catalogId: IdentifierSchema,
    componentCoverage: z.enum(["complete", "partial"]),
    workflows: z.array(WorkflowCatalogEntryV1Schema),
    components: z.array(ComponentCatalogEntryV1Schema),
    runtimes: z.array(RuntimeCatalogEntryV1Schema).min(1)
  })
  .strict();

export type SummerCatalogV1 = z.infer<typeof SummerCatalogV1Schema>;

export const MatchTargetSchema = z.enum(["workflow", "component", "all"]);

export const MatchRequestV1Schema = z
  .object({
    schemaVersion: z.literal("summer.match-request/v1"),
    intent: NonEmptyStringSchema.max(4000),
    target: MatchTargetSchema.default("all"),
    profile: WorkflowProfileKindSchema.optional(),
    componentKinds: z.array(ComponentKindSchema).default([]),
    requiredCapabilities: z.array(CapabilitySchema).default([]),
    runtimeIds: z.array(IdentifierSchema).default([]),
    preferredWorkflowIds: z.array(IdentifierSchema).default([]),
    preferredComponents: z.array(ExactComponentRefSchema).default([]),
    maxCandidates: z.number().int().min(1).max(20).default(5)
  })
  .strict()
  .superRefine((request, context) => {
    uniqueValues(request.componentKinds, context, ["componentKinds"]);
    uniqueValues(request.requiredCapabilities, context, ["requiredCapabilities"]);
    uniqueValues(request.runtimeIds, context, ["runtimeIds"]);
    uniqueValues(request.preferredWorkflowIds, context, ["preferredWorkflowIds"]);
    uniqueValues(
      request.preferredComponents.map(
        (ref) => `${ref.namespace}/${ref.name}@${ref.version}`
      ),
      context,
      ["preferredComponents"]
    );
  });

export type MatchRequestV1 = z.infer<typeof MatchRequestV1Schema>;

export const CatalogDigestSchema = Sha256DigestSchema;
