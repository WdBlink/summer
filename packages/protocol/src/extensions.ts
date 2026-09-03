import { z } from "zod";

import {
  ComponentCatalogEntryV1Schema,
  WorkflowCatalogEntryV1Schema
} from "./catalog.js";
import {
  CapabilitySchema,
  ComponentDescriptorV1Schema,
  ExactComponentRefSchema,
  SchemaDescriptorV1Schema
} from "./descriptors.js";
import {
  IdentifierSchema,
  NonEmptyStringSchema,
  Sha256DigestSchema
} from "./primitives.js";
import { WorkflowSpecV1Schema } from "./workflow.js";

const RequestedCapabilitiesSchema = z
  .array(CapabilitySchema)
  .min(1)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "requestedCapabilities must not contain duplicates"
      });
    }
  });

const RepositoryPathSchema = NonEmptyStringSchema.max(512).superRefine(
  (value, context) => {
    if (
      value.startsWith("/") ||
      value.split("/").includes("..") ||
      !value.startsWith("packages/")
    ) {
      context.addIssue({
        code: "custom",
        message: "implementation paths must be repository-relative under packages/"
      });
    }
  }
);

const WorkflowSourcePathSchema = NonEmptyStringSchema.max(512).superRefine(
  (value, context) => {
    if (
      value.startsWith("/") ||
      value.split("/").includes("..") ||
      (!value.startsWith("workflows/") &&
        !value.startsWith("fixtures/workflows/"))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "workflow source paths must be repository-relative under workflows/ or fixtures/workflows/"
      });
    }
  }
);

const VerificationPlanV1Schema = z
  .object({
    contractCases: z.array(NonEmptyStringSchema.max(300)).min(1),
    failureCases: z.array(NonEmptyStringSchema.max(300)).min(1),
    conformanceFixtures: z.array(NonEmptyStringSchema.max(300)).min(1),
    idempotencyCases: z.array(NonEmptyStringSchema.max(300)).default([])
  })
  .strict();

const ReuseAssessmentV1Schema = z
  .object({
    catalogDigest: Sha256DigestSchema,
    reviewedWorkflowIds: z.array(IdentifierSchema).default([]),
    reviewedComponents: z.array(ExactComponentRefSchema).default([]),
    conclusion: z.enum(["add-component", "add-workflow"]),
    justification: NonEmptyStringSchema.max(2000)
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      assessment.reviewedWorkflowIds.length === 0 &&
      assessment.reviewedComponents.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "at least one existing workflow or component must be reviewed",
        path: ["reviewedWorkflowIds"]
      });
    }
  });

const ExtensionProposalBaseShape = {
  schemaVersion: z.literal("summer.extension-proposal/v1"),
  proposalId: IdentifierSchema,
  rationale: NonEmptyStringSchema.max(4000),
  requestedCapabilities: RequestedCapabilitiesSchema,
  reuseAssessment: ReuseAssessmentV1Schema,
  verification: VerificationPlanV1Schema
} as const;

export const ComponentExtensionProposalV1Schema = z
  .object({
    ...ExtensionProposalBaseShape,
    kind: z.literal("component"),
    schemas: z.array(SchemaDescriptorV1Schema),
    component: ComponentDescriptorV1Schema,
    catalogEntry: ComponentCatalogEntryV1Schema,
    implementation: z
      .object({
        packagePath: RepositoryPathSchema,
        registryModule: RepositoryPathSchema,
        runtimeId: IdentifierSchema
      })
      .strict(),
    controls: z
      .object({
        humanAuthorization: z.enum(["none", "before-execution"]),
        retryPolicy: z.enum(["forbidden", "idempotent-only"])
      })
      .strict()
  })
  .strict();

export type ComponentExtensionProposalV1 = z.infer<
  typeof ComponentExtensionProposalV1Schema
>;

export const WorkflowExtensionProposalV1Schema = z
  .object({
    ...ExtensionProposalBaseShape,
    kind: z.literal("workflow"),
    workflow: WorkflowSpecV1Schema,
    catalogEntry: WorkflowCatalogEntryV1Schema,
    implementation: z
      .object({
        sourcePath: WorkflowSourcePathSchema,
        runtimeIds: z.array(IdentifierSchema).min(1)
      })
      .strict()
  })
  .strict();

export type WorkflowExtensionProposalV1 = z.infer<
  typeof WorkflowExtensionProposalV1Schema
>;

export const ExtensionProposalV1Schema = z.discriminatedUnion("kind", [
  ComponentExtensionProposalV1Schema,
  WorkflowExtensionProposalV1Schema
]);

export type ExtensionProposalV1 = z.infer<typeof ExtensionProposalV1Schema>;
