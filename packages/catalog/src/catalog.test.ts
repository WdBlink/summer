import { describe, expect, it } from "vitest";

import { ComponentRegistry } from "@summer/components";
import { JsonValueSchema, type SummerCatalogV1 } from "@summer/protocol";

import {
  compileCatalog,
  matchCatalog,
  validateExtensionProposal
} from "./index.js";

const schemaRef = {
  namespace: "test",
  name: "payload",
  version: "1.0.0"
} as const;
const componentRef = {
  namespace: "test",
  name: "echo",
  version: "1.0.0"
} as const;

function registry(): ComponentRegistry {
  const result = new ComponentRegistry()
    .registerSchema({
      schemaVersion: "summer.schema-descriptor/v1",
      ref: schemaRef,
      jsonSchema: { type: "object" }
    }, JsonValueSchema)
    .registerDescriptor({
      schemaVersion: "summer.component-descriptor/v1",
      ref: componentRef,
      kind: "tool",
      inputSchema: schemaRef,
      outputSchema: schemaRef,
      capabilities: ["test.echo"],
      permissions: [],
      effect: "none",
      supportsFanout: false
    });
  result.bindExecutor(componentRef, (input) => input);
  return result;
}

function catalogSource(): SummerCatalogV1 {
  return {
    schemaVersion: "summer.catalog/v1",
    catalogId: "test-catalog",
    componentCoverage: "complete",
    workflows: [],
    components: [
      {
        schemaVersion: "summer.component-catalog-entry/v1",
        component: componentRef,
        title: "Echo",
        summary: "Echo a typed value.",
        status: "available",
        keywords: ["echo", "回显"],
        domains: ["test"],
        runtimeIds: ["test-runtime"]
      }
    ],
    runtimes: [
      {
        schemaVersion: "summer.runtime-catalog-entry/v1",
        runtimeId: "test-runtime",
        title: "Test runtime",
        summary: "Runtime used by catalog contract tests.",
        status: "available",
        supportedProfiles: ["bounded-flow"],
        supportedComponentKinds: ["tool"],
        supportedEffects: ["none", "write-non-idempotent"],
        capabilities: ["runtime.test"],
        limitations: [],
        persistence: "none",
        executorBindings: true
      }
    ]
  };
}

describe("Summer catalog", () => {
  it("requires complete catalogs to annotate every registry component", () => {
    const source = { ...catalogSource(), components: [] };

    expect(() => compileCatalog(source, registry(), [])).toThrowError(
      expect.objectContaining({
        name: "CatalogCompileError",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "UNCATALOGED_REGISTRY_COMPONENT" })
        ])
      })
    );
  });

  it("matches registered components with explainable evidence", () => {
    const catalog = compileCatalog(catalogSource(), registry(), []);
    const result = matchCatalog(
      {
        schemaVersion: "summer.match-request/v1",
        intent: "请使用 echo 回显这个值",
        target: "component"
      },
      catalog
    );

    expect(result.components).toMatchObject({
      status: "matched",
      selected: {
        component: componentRef,
        reasons: expect.arrayContaining([expect.stringContaining("keyword:echo")])
      }
    });
    expect(result.workflows.status).toBe("not-requested");
  });

  it("rejects available catalog entries without real runtime bindings", () => {
    const unbound = new ComponentRegistry()
      .registerSchema({
        schemaVersion: "summer.schema-descriptor/v1",
        ref: schemaRef,
        jsonSchema: {type: "object"}
      })
      .registerDescriptor({
        schemaVersion: "summer.component-descriptor/v1",
        ref: componentRef,
        kind: "tool",
        inputSchema: schemaRef,
        outputSchema: schemaRef,
        capabilities: ["test.echo"],
        permissions: [],
        effect: "none",
        supportsFanout: false
      });

    expect(() => compileCatalog(catalogSource(), unbound, [])).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({code: "AVAILABLE_COMPONENT_EXECUTOR_MISSING"}),
          expect.objectContaining({code: "AVAILABLE_COMPONENT_SCHEMA_BINDING_MISSING"})
        ])
      })
    );
  });

  it("fails closed on unsafe non-idempotent component proposals", () => {
    const catalog = compileCatalog(catalogSource(), registry(), []);
    const report = validateExtensionProposal(
      {
        schemaVersion: "summer.extension-proposal/v1",
        proposalId: "unsafe-writer",
        kind: "component",
        rationale: "Add an external writer.",
        requestedCapabilities: ["external.write"],
        reuseAssessment: {
          catalogDigest: catalog.catalogDigest,
          reviewedComponents: [componentRef],
          conclusion: "add-component",
          justification: "Echo cannot perform the required write."
        },
        verification: {
          contractCases: ["write succeeds"],
          failureCases: ["write failure is typed"],
          conformanceFixtures: ["fixtures/extensions/unsafe-writer.json"]
        },
        schemas: [],
        component: {
          schemaVersion: "summer.component-descriptor/v1",
          ref: { namespace: "test", name: "writer", version: "1.0.0" },
          kind: "tool",
          inputSchema: schemaRef,
          outputSchema: schemaRef,
          capabilities: ["external.write"],
          permissions: [],
          effect: "write-non-idempotent",
          supportsFanout: false
        },
        catalogEntry: {
          schemaVersion: "summer.component-catalog-entry/v1",
          component: { namespace: "test", name: "writer", version: "1.0.0" },
          title: "Unsafe writer",
          summary: "Write to an external system.",
          status: "candidate",
          keywords: ["write"],
          runtimeIds: ["test-runtime"]
        },
        implementation: {
          packagePath: "packages/test-writer",
          registryModule: "packages/test-writer/src/registry.ts",
          runtimeId: "test-runtime"
        },
        controls: {
          humanAuthorization: "none",
          retryPolicy: "idempotent-only"
        }
      },
      { catalog, registry: registry() }
    );

    expect(report.valid).toBe(false);
    expect(report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "WRITE_PERMISSION_REQUIRED",
        "NON_IDEMPOTENT_RETRY_FORBIDDEN",
        "NON_IDEMPOTENT_AUTHORIZATION_REQUIRED"
      ])
    );
  });

  it("rejects extension reuse evidence from a stale catalog", () => {
    const catalog = compileCatalog(catalogSource(), registry(), []);
    const report = validateExtensionProposal(
      {
        schemaVersion: "summer.extension-proposal/v1",
        proposalId: "stale-proposal",
        kind: "component",
        rationale: "Add one missing transform.",
        requestedCapabilities: ["test.transform"],
        reuseAssessment: {
          catalogDigest: "0".repeat(64),
          reviewedComponents: [componentRef],
          conclusion: "add-component",
          justification: "Echo does not transform values."
        },
        verification: {
          contractCases: ["transform a valid value"],
          failureCases: ["reject an invalid value"],
          conformanceFixtures: ["fixtures/extensions/transform.json"]
        },
        schemas: [],
        component: {
          schemaVersion: "summer.component-descriptor/v1",
          ref: { namespace: "test", name: "transform", version: "1.0.0" },
          kind: "tool",
          inputSchema: schemaRef,
          outputSchema: schemaRef,
          capabilities: ["test.transform"],
          permissions: [],
          effect: "none",
          supportsFanout: false
        },
        catalogEntry: {
          schemaVersion: "summer.component-catalog-entry/v1",
          component: { namespace: "test", name: "transform", version: "1.0.0" },
          title: "Transform",
          summary: "Transform a typed value.",
          status: "candidate",
          keywords: ["transform"],
          runtimeIds: ["test-runtime"]
        },
        implementation: {
          packagePath: "packages/test-transform",
          registryModule: "packages/test-transform/src/registry.ts",
          runtimeId: "test-runtime"
        },
        controls: {
          humanAuthorization: "none",
          retryPolicy: "forbidden"
        }
      },
      { catalog, registry: registry() }
    );

    expect(report.valid).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CATALOG_DIGEST_MISMATCH" })
      ])
    );
  });
});
