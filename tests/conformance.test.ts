import { resolve } from "node:path";

import {
  compileWorkflowFile,
  createFixtureConformanceRegistry,
  readWorkflowFile
} from "@summer/cli";
import { ComponentRegistry } from "@summer/components";
import {
  InvalidCampaignTransitionError,
  SummerCore,
  type CampaignFollowupEventV1
} from "@summer/core";
import {
  MastraAdapterError,
  planMastraWorkflow
} from "@summer/runtime-mastra";
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

  it("lowers one factor strategy experiment to a bounded linear child Flow", () => {
    const compiled = compileWorkflowFile(
      fixture("factor-strategy-experiment.v1.json")
    ).workflow;

    expect(planMastraWorkflow(compiled)).toMatchObject({
      executionShape: "linear",
      nodeOrder: [
        "freeze-experiment",
        "generate-candidate",
        "validate-candidate",
        "run-backtest",
        "evaluate-evidence",
        "terminal"
      ]
    });

    const core = new SummerCore(createFixtureConformanceRegistry());
    expect(() =>
      core.start(compiled, {
        campaignId: "bounded-flow-is-not-a-campaign",
        occurredAt: "2026-09-03T08:00:00.000Z"
      })
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("keeps iterative campaign control out of the Mastra child-flow adapter", () => {
    const compiled = compileWorkflowFile(
      fixture("factor-discovery-tuning.v1.json")
    ).workflow;

    expect(() => planMastraWorkflow(compiled)).toThrowError(MastraAdapterError);
    try {
      planMastraWorkflow(compiled);
    } catch (error) {
      expect((error as MastraAdapterError).issues).toContainEqual(
        expect.objectContaining({ code: "UNSUPPORTED_PROFILE" })
      );
    }
  });

  it("freezes the compiled campaign manifest into the authoritative ledger start", () => {
    const registry = createFixtureConformanceRegistry();
    const core = new SummerCore(registry);
    const source = readWorkflowFile(
      fixture("factor-discovery-tuning.v1.json")
    ).workflow;
    const compiled = core.compile(source);

    const started = core.start(compiled, {
      campaignId: "factor-campaign-conformance",
      eventId: "factor-campaign-start",
      occurredAt: "2026-09-03T08:00:00.000Z"
    });

    expect(started.projection.profile.kind).toBe("iterative-campaign");
    expect(Object.keys(started.projection.nodeContracts)).toHaveLength(8);
    expect(started.projection.decisionPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(started.projection.frameCheckPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(started.projection.compiledWorkflowDigest).toBe(
      compiled.compiledDigest
    );

    const authenticStart = started.events[0];
    if (authenticStart?.type !== "campaign-started") {
      throw new Error("expected the authoritative campaign start event");
    }
    const forgedStart = {
      ...authenticStart,
      eventId: "forged-campaign-start",
      campaignId: "forged-campaign",
      profile: {
        ...authenticStart.profile,
        budgets: {
          ...authenticStart.profile.budgets,
          maxExperiments: 999
        }
      }
    };
    expect(() =>
      core.append("forged-campaign", 0, [
        forgedStart as unknown as CampaignFollowupEventV1
      ])
    ).toThrow(InvalidCampaignTransitionError);

    const coreWithDifferentRegistry = new SummerCore(new ComponentRegistry());
    expect(() =>
      coreWithDifferentRegistry.start(compiled, {
        campaignId: "registry-mismatch",
        eventId: "registry-mismatch-start",
        occurredAt: "2026-09-03T08:00:00.000Z"
      })
    ).toThrow();
  });
});
