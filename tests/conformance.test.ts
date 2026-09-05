import { resolve } from "node:path";

import {
  compileWorkflowFile,
  createFixtureConformanceRegistry
} from "@summer/cli";
import { planMastraWorkflow } from "@summer/runtime-mastra";
import { describe, expect, it } from "vitest";

const fixture = (name: string) =>
  resolve(process.cwd(), "fixtures", "workflows", name);

describe("representative workflow conformance", () => {
  it("lowers the ResearchStudio-inspired Flow to one explicit fork/join plan", () => {
    const compiled = compileWorkflowFile(
      fixture("research-ideation.v1.json")
    ).workflow;

    const plan = planMastraWorkflow(compiled);

    expect(plan).toMatchObject({
      executionShape: "single-fork-join",
      prefixNodeIds: ["freeze-brief"],
      joinNodeId: "aggregate",
      suffixNodeIds: ["aggregate", "terminal"]
    });
    if (plan.executionShape !== "single-fork-join") {
      throw new Error("expected the representative fork/join plan");
    }
    expect(plan.branches).toHaveLength(3);
    expect(plan.branches.every((branch) => branch.length === 5)).toBe(true);
  });
});
