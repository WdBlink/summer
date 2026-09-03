import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  compileCatalog,
  type CompiledSummerCatalogV1,
  type RuntimeWorkflowValidator
} from "@summer/catalog";
import { compileWorkflow } from "@summer/compiler";
import { SummerCatalogV1Schema } from "@summer/protocol";
import {
  registerResearchIdeationComponents,
  type ResearchIdeationRegistryOptions
} from "@summer/research-ideation";
import { planMastraWorkflow } from "@summer/runtime-mastra";

import { createFixtureConformanceRegistry } from "./conformance-registry.js";

export const REPOSITORY_CATALOG_PATH = "catalog/summer.catalog.v1.json";
export const REPOSITORY_REGISTRY_ID = "summer.repository-registry/v1" as const;

export function createRepositoryRegistry(
  options: ResearchIdeationRegistryOptions = {}
) {
  return registerResearchIdeationComponents(
    createFixtureConformanceRegistry(),
    options
  );
}

export function compileRepositoryCatalog(
  projectRoot: string
): CompiledSummerCatalogV1 {
  const registry = createRepositoryRegistry();
  const source = SummerCatalogV1Schema.parse(
    readJson(resolve(projectRoot, REPOSITORY_CATALOG_PATH))
  );
  const workflows = source.workflows.map(({ sourcePath }) =>
    compileWorkflow(
      readJson(resolve(projectRoot, sourcePath)),
      registry
    )
  );
  return compileCatalog(source, registry, workflows);
}

export function repositoryRuntimeValidators(): ReadonlyMap<
  string,
  RuntimeWorkflowValidator
> {
  return new Map<string, RuntimeWorkflowValidator>([
    ["mastra-v0", (workflow) => void planMastraWorkflow(workflow)],
    [
      "summer-core-v0",
      (workflow) => {
        if (workflow.profile.kind !== "iterative-campaign") {
          throw new Error(
            "summer-core-v0 owns iterative-campaign manifests only"
          );
        }
      }
    ]
  ]);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}
