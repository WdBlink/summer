import { isAbsolute, relative, resolve } from "node:path";

import {
  IdentifierSchema,
  TimestampSchema,
  sha256Canonical,
  type ExactComponentRef,
  type ExactSchemaRef,
  type JsonValue,
  type SchemaDescriptorV1
} from "@summer/protocol";
import { z } from "zod";

export const RESEARCH_IDEATION_VERSION = "2.0.0" as const;
export const IDEA_SPARK_REQUEST_MANIFEST_VERSION =
  "summer.idea-spark-request-manifest/v2" as const;

export const IDEA_SPARK_REQUEST_SCHEMA_REF = {
  namespace: "researchstudio",
  name: "idea-spark-request",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactSchemaRef;

export const IDEA_SPARK_STATE_SCHEMA_REF = {
  namespace: "researchstudio",
  name: "idea-spark-state",
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

export const IDEA_SPARK_STAGE_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-stage",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactComponentRef;

export const IDEA_SPARK_PROVIDER_GATE_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-provider-gate",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactComponentRef;

export const IDEA_SPARK_RETRY_DECISION_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-retry-decision",
  version: RESEARCH_IDEATION_VERSION
} as const satisfies ExactComponentRef;

export const IDEA_SPARK_TRANSITION_COMPONENT_REF = {
  namespace: "researchstudio",
  name: "idea-spark-transition",
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

export const IdeaSparkPermissionSchema = z.enum([
  "filesystem.research-artifact.read",
  "filesystem.research-artifact.write",
  "network.research.retrieve",
  "process.codex.exec"
]);

export type IdeaSparkPermission = z.infer<typeof IdeaSparkPermissionSchema>;

export const REQUIRED_IDEA_SPARK_PERMISSIONS = Object.freeze([
  "filesystem.research-artifact.read",
  "filesystem.research-artifact.write",
  "network.research.retrieve",
  "process.codex.exec"
] as const satisfies readonly IdeaSparkPermission[]);

export const IdeaSparkProviderSchema = z.enum([
  "arxiv",
  "openalex",
  "openreview",
  "semanticscholar"
]);

export type IdeaSparkProvider = z.infer<typeof IdeaSparkProviderSchema>;

export const IDEA_SPARK_PROVIDERS = Object.freeze([
  "arxiv",
  "openalex",
  "openreview",
  "semanticscholar"
] as const satisfies readonly IdeaSparkProvider[]);

export const IdeaSparkDisclosurePayloadSchema = z.enum([
  "scientific-query",
  "query-derived-search-terms",
  "public-reference-identifiers"
]);

export type IdeaSparkDisclosurePayload = z.infer<
  typeof IdeaSparkDisclosurePayloadSchema
>;

export const IdeaSparkForbiddenDisclosureSchema = z.enum([
  "credentials",
  "unpublished-data",
  "unrelated-local-file-content"
]);

export type IdeaSparkForbiddenDisclosure = z.infer<
  typeof IdeaSparkForbiddenDisclosureSchema
>;

export const BASELINE_IDEA_SPARK_NETWORK_DISCLOSURE = Object.freeze({
  schemaVersion: "summer.network-disclosure/v1" as const,
  purpose: "public-literature-retrieval" as const,
  allowedProviders: [...IDEA_SPARK_PROVIDERS],
  allowedPayloads: [
    "scientific-query",
    "query-derived-search-terms",
    "public-reference-identifiers"
  ] satisfies IdeaSparkDisclosurePayload[],
  forbiddenPayloads: [
    "credentials",
    "unpublished-data",
    "unrelated-local-file-content"
  ] satisfies IdeaSparkForbiddenDisclosure[]
});

export const IdeaSparkNetworkDisclosureV1Schema = z
  .object({
    schemaVersion: z.literal("summer.network-disclosure/v1"),
    purpose: z.literal("public-literature-retrieval"),
    allowedProviders: z.array(IdeaSparkProviderSchema).min(1),
    allowedPayloads: z.array(IdeaSparkDisclosurePayloadSchema).min(1),
    forbiddenPayloads: z.array(IdeaSparkForbiddenDisclosureSchema).min(1)
  })
  .strict()
  .superRefine((disclosure, context) => {
    for (const field of [
      "allowedProviders",
      "allowedPayloads",
      "forbiddenPayloads"
    ] as const) {
      if (new Set(disclosure[field]).size !== disclosure[field].length) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must not contain duplicates`
        });
      }
    }
  });

export type IdeaSparkNetworkDisclosureV1 = z.infer<
  typeof IdeaSparkNetworkDisclosureV1Schema
>;

export const IdeaSparkProviderRequirementV1Schema = z
  .object({
    requiredProviders: z.array(IdeaSparkProviderSchema).min(1),
    minimumSuccessfulProviders: z.number().int().min(1).max(4),
    requireBibliographicProvider: z.boolean()
  })
  .strict()
  .superRefine((requirement, context) => {
    if (new Set(requirement.requiredProviders).size !== requirement.requiredProviders.length) {
      context.addIssue({
        code: "custom",
        path: ["requiredProviders"],
        message: "requiredProviders must not contain duplicates"
      });
    }
    if (requirement.minimumSuccessfulProviders < requirement.requiredProviders.length) {
      context.addIssue({
        code: "custom",
        path: ["minimumSuccessfulProviders"],
        message: "minimumSuccessfulProviders cannot be lower than requiredProviders.length"
      });
    }
  });

export const IdeaSparkExecutionGrantV1Schema = z
  .object({
    schemaVersion: z.literal("summer.execution-grant/v1"),
    grantId: IdentifierSchema,
    workflowId: z.literal("research-ideation"),
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    scope: z
      .object({
        workspaceDir: AbsolutePathSchema,
        runDir: AbsolutePathSchema
      })
      .strict(),
    permissions: z.array(IdeaSparkPermissionSchema).min(1),
    networkDisclosure: IdeaSparkNetworkDisclosureV1Schema,
    providerPolicy: z
      .object({
        literature: IdeaSparkProviderRequirementV1Schema,
        collision: IdeaSparkProviderRequirementV1Schema
      })
      .strict()
  })
  .strict()
  .superRefine((grant, context) => {
    if (new Set(grant.permissions).size !== grant.permissions.length) {
      context.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "permissions must not contain duplicates"
      });
    }
    if (Date.parse(grant.expiresAt) <= Date.parse(grant.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "expiresAt must be later than issuedAt"
      });
    }
    const disclosedProviders = new Set(grant.networkDisclosure.allowedProviders);
    for (const phase of ["literature", "collision"] as const) {
      for (const provider of grant.providerPolicy[phase].requiredProviders) {
        if (!disclosedProviders.has(provider)) {
          context.addIssue({
            code: "custom",
            path: ["networkDisclosure", "allowedProviders"],
            message: `required ${phase} provider '${provider}' is not authorized for disclosure`
          });
        }
      }
    }
    for (const required of [
      "credentials",
      "unpublished-data",
      "unrelated-local-file-content"
    ] as const) {
      if (!grant.networkDisclosure.forbiddenPayloads.includes(required)) {
        context.addIssue({
          code: "custom",
          path: ["networkDisclosure", "forbiddenPayloads"],
          message: `network disclosure must explicitly forbid '${required}'`
        });
      }
    }
  });

export type IdeaSparkExecutionGrantV1 = z.infer<
  typeof IdeaSparkExecutionGrantV1Schema
>;

export class IdeaSparkExecutionGrantError extends Error {
  readonly code = "IDEA_SPARK_EXECUTION_GRANT_INACTIVE" as const;

  constructor(message: string) {
    super(message);
    this.name = "IdeaSparkExecutionGrantError";
  }
}

export function assertIdeaSparkExecutionGrantActive(
  grant: IdeaSparkExecutionGrantV1,
  now = new Date()
): void {
  if (Date.parse(grant.expiresAt) <= now.getTime()) {
    throw new IdeaSparkExecutionGrantError(
      `execution grant '${grant.grantId}' expired at ${grant.expiresAt}`
    );
  }
  if (Date.parse(grant.issuedAt) > now.getTime()) {
    throw new IdeaSparkExecutionGrantError(
      `execution grant '${grant.grantId}' is not active until ${grant.issuedAt}`
    );
  }
}

export const IdeaSparkRequestV2Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-request/v2"),
    query: z.string().trim().min(1).max(20_000),
    workspaceDir: AbsolutePathSchema,
    runDir: AbsolutePathSchema,
    executionGrant: IdeaSparkExecutionGrantV1Schema
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
    if (
      resolve(request.executionGrant.scope.workspaceDir) !==
      resolve(request.workspaceDir)
    ) {
      context.addIssue({
        code: "custom",
        path: ["executionGrant", "scope", "workspaceDir"],
        message: "execution grant workspaceDir must exactly match the request"
      });
    }
    if (resolve(request.executionGrant.scope.runDir) !== runDir) {
      context.addIssue({
        code: "custom",
        path: ["executionGrant", "scope", "runDir"],
        message: "execution grant runDir must exactly match the request"
      });
    }
    const granted = new Set(request.executionGrant.permissions);
    for (const permission of REQUIRED_IDEA_SPARK_PERMISSIONS) {
      if (!granted.has(permission)) {
        context.addIssue({
          code: "custom",
          path: ["executionGrant", "permissions"],
          message: `execution grant is missing required permission '${permission}'`
        });
      }
    }
  });

export type IdeaSparkRequestV2 = z.infer<typeof IdeaSparkRequestV2Schema>;

export const IdeaSparkRequestManifestV2Schema = z
  .object({
    schemaVersion: z.literal(IDEA_SPARK_REQUEST_MANIFEST_VERSION),
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    query: z.string().trim().min(1).max(20_000),
    workspaceDir: AbsolutePathSchema,
    runDir: AbsolutePathSchema
  })
  .strict();

export type IdeaSparkRequestManifestV2 = z.infer<
  typeof IdeaSparkRequestManifestV2Schema
>;

export function ideaSparkScientificRequestDigest(input: {
  readonly query: string;
  readonly workspaceDir: string;
  readonly runDir: string;
}): string {
  return sha256Canonical({
    schemaVersion: "summer.research-ideation-scientific-request/v1",
    query: input.query,
    workspaceDir: resolve(input.workspaceDir),
    runDir: resolve(input.runDir)
  });
}

export const IdeaSparkPreparedV2Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-prepared/v2"),
    query: z.string().min(1).max(20_000),
    workspaceDir: AbsolutePathSchema,
    runDir: AbsolutePathSchema,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    invocationId: IdentifierSchema,
    grant: IdeaSparkExecutionGrantV1Schema,
    grantDigest: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type IdeaSparkPreparedV2 = z.infer<typeof IdeaSparkPreparedV2Schema>;

export const IdeaSparkStageSchema = z.enum([
  "literature-grounding",
  "bottleneck-diagnosis",
  "candidate-generation",
  "coherence-collision",
  "quality-gauntlet",
  "package-render",
  "candidate-retry-transition",
  "bottleneck-retry-transition",
  "finalize-failure"
]);

export type IdeaSparkStage = z.infer<typeof IdeaSparkStageSchema>;

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
    terminalStatus: IdeaSparkTerminalStatusSchema.optional(),
    retryDecision: z.enum(["retry-candidate", "retry-bottleneck", "package", "finalize-failure", "terminal"]).optional()
  })
  .strict();

export type IdeaSparkNavigatorSnapshotV1 = z.infer<
  typeof IdeaSparkNavigatorSnapshotV1Schema
>;

export const IdeaSparkRouteSchema = z.enum([
  "continue",
  "decide",
  "retry-candidate",
  "retry-bottleneck",
  "package",
  "finalize-failure",
  "terminal"
]);

export type IdeaSparkRoute = z.infer<typeof IdeaSparkRouteSchema>;

export const IdeaSparkProviderStateSchema = z.enum([
  "succeeded",
  "empty",
  "invalid",
  "unavailable",
  "unknown"
]);

export const IdeaSparkProviderEvidenceV1Schema = z
  .object({
    uri: AbsolutePathSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    recordCount: z.number().int().nonnegative()
  })
  .strict();

export const IdeaSparkProviderObservationV1Schema = z
  .object({
    uri: AbsolutePathSchema,
    state: z.enum(["missing", "parsed", "invalid"]),
    byteLength: z.number().int().nonnegative().optional(),
    recordCount: z.number().int().nonnegative().optional(),
    error: z.string().trim().min(1).optional()
  })
  .strict();

export const IdeaSparkProviderDiagnosticCodeSchema = z.enum([
  "positive-evidence",
  "empty-evidence",
  "invalid-evidence",
  "connector-declared-unavailable",
  "no-evidence"
]);

export const IdeaSparkProviderStatusV1Schema = z
  .object({
    schemaVersion: z.literal("summer.idea-spark-provider-status/v1"),
    gateNodeId: IdentifierSchema,
    phase: z.enum(["literature", "collision"]),
    provider: IdeaSparkProviderSchema,
    state: IdeaSparkProviderStateSchema,
    recordCount: z.number().int().nonnegative(),
    evidencePaths: z.array(AbsolutePathSchema),
    evidence: z.array(IdeaSparkProviderEvidenceV1Schema),
    diagnosticCode: IdeaSparkProviderDiagnosticCodeSchema.optional(),
    diagnosticMessage: z.string().trim().min(1).optional(),
    observations: z.array(IdeaSparkProviderObservationV1Schema).optional(),
    observedAt: TimestampSchema
  })
  .strict();

export type IdeaSparkProviderStatusV1 = z.infer<
  typeof IdeaSparkProviderStatusV1Schema
>;

export const IdeaSparkNodeRunV2Schema = z
  .object({
    schemaVersion: z.literal("summer.idea-spark-node-run/v2"),
    nodeId: IdentifierSchema,
    kind: z.enum(["stage", "provider-gate", "retry-decision", "transition"]),
    skipped: z.boolean(),
    before: IdeaSparkNavigatorSnapshotV1Schema.optional(),
    after: IdeaSparkNavigatorSnapshotV1Schema.optional(),
    route: IdeaSparkRouteSchema,
    workerMessagePath: AbsolutePathSchema.optional()
  })
  .strict();

export type IdeaSparkNodeRunV2 = z.infer<typeof IdeaSparkNodeRunV2Schema>;

export const IdeaSparkFlowStateV2Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-state/v2"),
    request: IdeaSparkPreparedV2Schema,
    navigator: IdeaSparkNavigatorSnapshotV1Schema.optional(),
    route: IdeaSparkRouteSchema,
    nodeRuns: z.array(IdeaSparkNodeRunV2Schema),
    providerStatuses: z.array(IdeaSparkProviderStatusV1Schema)
  })
  .strict();

export type IdeaSparkFlowStateV2 = z.infer<typeof IdeaSparkFlowStateV2Schema>;

export const IdeaSparkArtifactV1Schema = z
  .object({
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    uri: AbsolutePathSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().trim().min(1)
  })
  .strict();

export type IdeaSparkArtifactV1 = z.infer<typeof IdeaSparkArtifactV1Schema>;

export const IdeaSparkResultV2Schema = z
  .object({
    schemaVersion: z.literal("summer.research-ideation-result/v2"),
    status: IdeaSparkTerminalStatusSchema,
    requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    invocationId: IdentifierSchema,
    grantDigest: z.string().regex(/^[a-f0-9]{64}$/),
    runDir: AbsolutePathSchema,
    navigator: IdeaSparkNavigatorSnapshotV1Schema,
    nodeRuns: z.array(IdeaSparkNodeRunV2Schema).min(1),
    providerStatuses: z.array(IdeaSparkProviderStatusV1Schema).min(1),
    artifacts: z.array(IdeaSparkArtifactV1Schema).min(1)
  })
  .strict();

export type IdeaSparkResultV2 = z.infer<typeof IdeaSparkResultV2Schema>;

export function prepareIdeaSparkRequest(
  input: unknown,
  invocationId: string,
  now = new Date()
): IdeaSparkFlowStateV2 {
  const request = IdeaSparkRequestV2Schema.parse(input);
  assertIdeaSparkExecutionGrantActive(request.executionGrant, now);
  const stableRequest = {
    schemaVersion: "summer.research-ideation-scientific-request/v1",
    query: request.query,
    workspaceDir: resolve(request.workspaceDir),
    runDir: resolve(request.runDir)
  } as const;
  const normalizedGrant = IdeaSparkExecutionGrantV1Schema.parse({
    ...request.executionGrant,
    scope: {
      workspaceDir: stableRequest.workspaceDir,
      runDir: stableRequest.runDir
    }
  });
  const prepared = IdeaSparkPreparedV2Schema.parse({
    schemaVersion: "summer.research-ideation-prepared/v2",
    query: request.query,
    workspaceDir: resolve(request.workspaceDir),
    runDir: resolve(request.runDir),
    requestDigest: ideaSparkScientificRequestDigest(stableRequest),
    invocationId,
    grant: normalizedGrant,
    grantDigest: sha256Canonical(normalizedGrant as unknown as JsonValue)
  });
  return IdeaSparkFlowStateV2Schema.parse({
    schemaVersion: "summer.research-ideation-state/v2",
    request: prepared,
    route: "continue",
    nodeRuns: [],
    providerStatuses: []
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
        "summer.research-ideation-request/v2",
        ["schemaVersion", "query", "workspaceDir", "runDir", "executionGrant"],
        {
          schemaVersion: { const: "summer.research-ideation-request/v2" },
          query: { ...stringProperty, maxLength: 20_000 },
          workspaceDir: stringProperty,
          runDir: stringProperty,
          executionGrant: { type: "object" }
        }
      )
    },
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: IDEA_SPARK_STATE_SCHEMA_REF,
      jsonSchema: objectSchema(
        "summer.research-ideation-state/v2",
        ["schemaVersion", "request", "route", "nodeRuns", "providerStatuses"],
        {
          schemaVersion: { const: "summer.research-ideation-state/v2" },
          request: { type: "object" },
          navigator: { type: "object" },
          route: {
            enum: [
              "continue",
              "decide",
              "retry-candidate",
              "retry-bottleneck",
              "package",
              "finalize-failure",
              "terminal"
            ]
          },
          nodeRuns: { type: "array" },
          providerStatuses: { type: "array" }
        }
      )
    },
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: IDEA_SPARK_RESULT_SCHEMA_REF,
      jsonSchema: objectSchema(
        "summer.research-ideation-result/v2",
        [
          "schemaVersion",
          "status",
          "requestDigest",
          "invocationId",
          "grantDigest",
          "runDir",
          "navigator",
          "nodeRuns",
          "providerStatuses",
          "artifacts"
        ],
        {
          schemaVersion: { const: "summer.research-ideation-result/v2" },
          status: { enum: ["done", "do-not-generate", "phase-3-failed"] },
          requestDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          invocationId: stringProperty,
          grantDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          runDir: stringProperty,
          navigator: { type: "object" },
          nodeRuns: { type: "array", minItems: 1 },
          providerStatuses: { type: "array", minItems: 1 },
          artifacts: { type: "array", minItems: 1 }
        }
      )
    }
  ]);

export const RESEARCH_IDEATION_SCHEMA_BINDINGS = Object.freeze([
  [IDEA_SPARK_REQUEST_SCHEMA_REF, IdeaSparkRequestV2Schema],
  [IDEA_SPARK_STATE_SCHEMA_REF, IdeaSparkFlowStateV2Schema],
  [IDEA_SPARK_RESULT_SCHEMA_REF, IdeaSparkResultV2Schema]
] as const);
