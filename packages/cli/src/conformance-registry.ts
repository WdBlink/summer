import { ComponentRegistry } from "@summer/components";
import type {
  ComponentDescriptorV1,
  ComponentEffect,
  ComponentKind,
  ExactComponentRef,
  ExactSchemaRef,
  PolicyKind,
  SchemaDescriptorV1
} from "@summer/protocol";
import { JsonValueSchema } from "@summer/protocol";

export const FIXTURE_CONFORMANCE_REGISTRY_ID =
  "summer.fixture-conformance-registry/v1" as const;

const EXACT_VERSION = "1.0.0" as const;

const INPUT_SCHEMA_REF: ExactSchemaRef = {
  namespace: "summer-fixture",
  name: "component-input",
  version: EXACT_VERSION
};

const OUTPUT_SCHEMA_REF: ExactSchemaRef = {
  namespace: "summer-fixture",
  name: "component-output",
  version: EXACT_VERSION
};

interface FixtureComponentDefinition {
  readonly namespace: string;
  readonly name: string;
  readonly kind: ComponentKind;
  readonly policyKind?: PolicyKind;
  readonly effect: ComponentEffect;
  readonly supportsFanout?: boolean;
  readonly capabilities: readonly string[];
  readonly permissions?: readonly string[];
}

const FIXTURE_COMPONENTS: readonly FixtureComponentDefinition[] = [
  {
    namespace: "factor",
    name: "evaluate-evidence",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.factor.evaluate-evidence"]
  },
  {
    namespace: "factor",
    name: "freeze-experiment",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.factor.freeze-experiment"]
  },
  {
    namespace: "factor",
    name: "generate-candidate",
    kind: "agent",
    effect: "none",
    capabilities: ["fixture.factor.generate-candidate"]
  },
  {
    namespace: "factor",
    name: "iteration-policy",
    kind: "policy",
    policyKind: "iteration",
    effect: "none",
    capabilities: ["fixture.factor.iteration-policy"]
  },
  {
    namespace: "factor",
    name: "run-backtest",
    kind: "tool",
    effect: "write-idempotent",
    capabilities: ["fixture.factor.run-backtest"],
    permissions: ["artifact.backtest.write"]
  },
  {
    namespace: "factor",
    name: "strategy-experiment",
    kind: "nested-workflow",
    effect: "write-idempotent",
    capabilities: ["fixture.factor.strategy-experiment"],
    permissions: ["campaign.experiment.execute"]
  },
  {
    namespace: "factor",
    name: "validate-candidate",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.factor.validate-candidate"]
  },
  {
    namespace: "researchstudio",
    name: "aggregate",
    kind: "tool",
    effect: "none",
    capabilities: ["fixture.researchstudio.aggregate"]
  },
  {
    namespace: "researchstudio",
    name: "audit",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.researchstudio.audit"]
  },
  {
    namespace: "researchstudio",
    name: "coherence",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.researchstudio.coherence"]
  },
  {
    namespace: "researchstudio",
    name: "collision",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.researchstudio.collision"]
  },
  {
    namespace: "researchstudio",
    name: "freeze-brief",
    kind: "validator",
    effect: "read",
    supportsFanout: true,
    capabilities: ["fixture.researchstudio.freeze-brief"]
  },
  {
    namespace: "researchstudio",
    name: "generate",
    kind: "agent",
    effect: "none",
    capabilities: ["fixture.researchstudio.generate"]
  },
  {
    namespace: "researchstudio",
    name: "implementability",
    kind: "validator",
    effect: "read",
    capabilities: ["fixture.researchstudio.implementability"]
  },
  {
    namespace: "summer",
    name: "activation-policy",
    kind: "policy",
    policyKind: "activation",
    effect: "none",
    capabilities: ["fixture.summer.activation-policy"]
  },
  {
    namespace: "summer",
    name: "budget-policy",
    kind: "policy",
    policyKind: "budget",
    effect: "none",
    capabilities: ["fixture.summer.budget-policy"]
  },
  {
    namespace: "summer",
    name: "decision-policy",
    kind: "policy",
    policyKind: "decision",
    effect: "none",
    capabilities: ["fixture.summer.decision-policy"]
  },
  {
    namespace: "summer",
    name: "frame-check-policy",
    kind: "policy",
    policyKind: "frame-check",
    effect: "none",
    capabilities: ["fixture.summer.frame-check-policy"]
  },
  {
    namespace: "summer",
    name: "terminal-receipt",
    kind: "validator",
    effect: "none",
    capabilities: ["fixture.summer.terminal-receipt"]
  },
  {
    namespace: "summer",
    name: "wait-state",
    kind: "tool",
    effect: "none",
    capabilities: ["fixture.summer.wait-state"]
  }
];

function schemaDescriptor(
  ref: ExactSchemaRef,
  description: string
): SchemaDescriptorV1 {
  return {
    schemaVersion: "summer.schema-descriptor/v1",
    ref,
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      description,
      type: ["object", "array", "string", "number", "boolean", "null"]
    }
  };
}

function componentDescriptor(
  definition: FixtureComponentDefinition
): ComponentDescriptorV1 {
  const ref: ExactComponentRef = {
    namespace: definition.namespace,
    name: definition.name,
    version: EXACT_VERSION
  };

  return {
    schemaVersion: "summer.component-descriptor/v1",
    ref,
    kind: definition.kind,
    ...(definition.policyKind === undefined
      ? {}
      : { policyKind: definition.policyKind }),
    inputSchema: INPUT_SCHEMA_REF,
    outputSchema: OUTPUT_SCHEMA_REF,
    capabilities: [...definition.capabilities],
    permissions: [...(definition.permissions ?? [])],
    effect: definition.effect,
    supportsFanout: definition.supportsFanout ?? false
  };
}

/**
 * Metadata-only registry used solely to compile the repository's conformance
 * fixtures. It binds permissive JSON validators for static fixture inputs, but
 * intentionally binds no executors or production domain schemas.
 */
export function createFixtureConformanceRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  registry.registerSchema(
    schemaDescriptor(
      INPUT_SCHEMA_REF,
      "Unrestricted JSON input used only by Summer repository fixtures."
    ),
    JsonValueSchema
  );
  registry.registerSchema(
    schemaDescriptor(
      OUTPUT_SCHEMA_REF,
      "Unrestricted JSON output used only by Summer repository fixtures."
    ),
    JsonValueSchema
  );

  for (const definition of FIXTURE_COMPONENTS) {
    registry.registerDescriptor(componentDescriptor(definition));
  }
  return registry;
}

export function fixtureComponentReferences(): readonly ExactComponentRef[] {
  return FIXTURE_COMPONENTS.map(({ namespace, name }) => ({
    namespace,
    name,
    version: EXACT_VERSION
  }));
}
