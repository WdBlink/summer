import { describe, expect, it } from "vitest";

import {
  CampaignEventV1Schema,
  ComponentDescriptorV1Schema,
  CompiledWorkflowV1Schema,
  DecisionReceiptV1Schema,
  ExactComponentRefSchema,
  NodeReceiptV1Schema,
  NonCanonicalValueError,
  WorkflowSpecV1Schema,
  canonicalJson,
  computeCompiledWorkflowDigest,
  sha256Canonical,
  type ComponentDescriptorV1,
  type CompiledWorkflowDigestInput
} from "./index.js";

const digest = (character: string): string => character.repeat(64);
const componentRef = {
  namespace: "summer.test",
  name: "worker",
  version: "1.2.3"
} as const;
const schemaRef = {
  namespace: "summer.test",
  name: "payload",
  version: "1.0.0"
} as const;
const component: ComponentDescriptorV1 = {
  schemaVersion: "summer.component-descriptor/v1",
  ref: componentRef,
  kind: "agent",
  inputSchema: schemaRef,
  outputSchema: schemaRef,
  capabilities: ["research/read"],
  permissions: [],
  effect: "read",
  supportsFanout: false
};

describe("summer.workflow/v1", () => {
  it("parses a strict bounded flow and supplies execution defaults", () => {
    const parsed = WorkflowSpecV1Schema.parse({
      schemaVersion: "summer.workflow/v1",
      workflowId: "research-studio",
      revision: 1,
      profile: { kind: "bounded-flow", terminalNodeIds: ["finish"] },
      entryNodeId: "start",
      nodes: [
        { id: "start", component: componentRef },
        { id: "finish", component: componentRef }
      ],
      edges: [
        {
          id: "start-to-finish",
          from: "start",
          to: "finish",
          condition: { kind: "node-succeeded" }
        }
      ]
    });

    expect(parsed.nodes[0]).toMatchObject({ dispatch: "route", maxAttempts: 1 });
  });

  it("accepts the complete iterative-campaign policy profile", () => {
    const profile = {
      kind: "iterative-campaign",
      terminalNodeIds: ["stop"],
      activationNodeId: "activate",
      iterationNodeId: "iterate",
      experimentNodeId: "experiment",
      budgetNodeId: "budget",
      frameCheckNodeId: "frame",
      decisionNodeId: "decide",
      budgets: {
        maxExperiments: 12,
        maxAttemptsPerExperiment: 2,
        maxTotalNodeExecutions: 100
      }
    } as const;

    const result = WorkflowSpecV1Schema.shape.profile.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields and executable values", () => {
    const source = {
      schemaVersion: "summer.workflow/v1",
      workflowId: "unsafe",
      revision: 1,
      profile: { kind: "bounded-flow", terminalNodeIds: ["node"] },
      entryNodeId: "node",
      nodes: [
        {
          id: "node",
          component: componentRef,
          input: { execute: () => "arbitrary code" }
        }
      ],
      edges: [],
      javascript: "process.exit(1)"
    };

    expect(WorkflowSpecV1Schema.safeParse(source).success).toBe(false);
  });

  it("requires exact semantic component versions", () => {
    expect(
      ExactComponentRefSchema.safeParse({ ...componentRef, version: "^1.2.3" })
        .success
    ).toBe(false);
    expect(
      ExactComponentRefSchema.safeParse({ ...componentRef, version: "1.2.3-beta.1" })
        .success
    ).toBe(true);
  });

  it("requires policyKind only and always for policy descriptors", () => {
    expect(
      ComponentDescriptorV1Schema.safeParse({
        ...component,
        kind: "policy"
      }).success
    ).toBe(false);
    expect(
      ComponentDescriptorV1Schema.safeParse({
        ...component,
        policyKind: "decision"
      }).success
    ).toBe(false);
  });
});

describe("canonical serialization", () => {
  it("sorts keys recursively and produces a stable SHA-256", () => {
    const left = { z: 1, nested: { b: true, a: [2, 1] }, a: "first" };
    const right = { a: "first", nested: { a: [2, 1], b: true }, z: 1 };

    expect(canonicalJson(left)).toBe(
      '{"a":"first","nested":{"a":[2,1],"b":true},"z":1}'
    );
    expect(sha256Canonical(left)).toBe(sha256Canonical(right));
    expect(sha256Canonical({ a: 1 })).toBe(
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
    );
  });

  it("rejects functions, non-finite numbers, and circular data", () => {
    expect(() => canonicalJson({ run: () => undefined })).toThrow(
      NonCanonicalValueError
    );
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(
      NonCanonicalValueError
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalJson(circular)).toThrow(NonCanonicalValueError);
  });
});

describe("compiled workflows and receipts", () => {
  it("binds a compiled workflow to stable source and registry digests", () => {
    const stable: CompiledWorkflowDigestInput = {
      schemaVersion: "summer.compiled-workflow/v1",
      workflowId: "compiled",
      revision: 1,
      profile: { kind: "bounded-flow", terminalNodeIds: ["only"] },
      entryNodeId: "only",
      nodes: [
        {
          id: "only",
          component: componentRef,
          dispatch: "route",
          maxAttempts: 1,
          resolvedComponent: component
        }
      ],
      edges: [],
      sourceDigest: digest("a"),
      registryDigest: digest("b")
    };
    const compiledDigest = computeCompiledWorkflowDigest(stable);

    expect(
      CompiledWorkflowV1Schema.parse({
        ...stable,
        compiledDigest,
        compiledAt: "2026-09-03T08:00:00.000Z"
      }).compiledDigest
    ).toBe(compiledDigest);
    expect(
      CompiledWorkflowV1Schema.safeParse({
        ...stable,
        compiledDigest: digest("c"),
        compiledAt: "2026-09-03T09:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("enforces drift identities and receipt status invariants", () => {
    const base = {
      schemaVersion: "summer.node-receipt/v1",
      receiptId: "receipt-1",
      workflowId: "compiled",
      workflowRevision: 1,
      compiledWorkflowDigest: digest("a"),
      registryDigest: digest("b"),
      runId: "run-1",
      nodeId: "only",
      attempt: 1,
      component: componentRef,
      status: "failed",
      inputDigest: digest("c"),
      artifactRefs: [],
      startedAt: "2026-09-03T08:00:00.000Z",
      completedAt: "2026-09-03T08:00:01.000Z"
    } as const;

    expect(NodeReceiptV1Schema.safeParse(base).success).toBe(false);
    expect(
      NodeReceiptV1Schema.safeParse({
        ...base,
        error: {
          code: "MODEL_TIMEOUT",
          message: "Timed out",
          retryable: true
        }
      }).success
    ).toBe(true);
    expect(
      NodeReceiptV1Schema.safeParse({
        ...base,
        experimentId: "experiment-1",
        error: {
          code: "MODEL_TIMEOUT",
          message: "Timed out",
          retryable: true
        }
      }).success
    ).toBe(false);
    expect(
      NodeReceiptV1Schema.safeParse({
        ...base,
        experimentId: "experiment-1",
        experimentAttemptId: "attempt-1",
        error: {
          code: "MODEL_TIMEOUT",
          message: "Timed out",
          retryable: true
        }
      }).success
    ).toBe(true);
  });

  it("keeps decisions and campaign events as closed DTO unions", () => {
    const decision = {
      schemaVersion: "summer.decision-receipt/v1",
      decisionId: "decision-1",
      campaignId: "campaign-1",
      assessmentId: "assessment-1",
      policyDigest: digest("d"),
      reason: "Experiment budget has been exhausted",
      evidenceRefs: [{ ref: "assessment:assessment-1", digest: digest("e") }],
      decidedAt: "2026-09-03T08:00:00.000Z",
      decision: "stop",
      stopReason: "budget-exhausted"
    } as const;
    expect(DecisionReceiptV1Schema.safeParse(decision).success).toBe(true);
    expect(
      DecisionReceiptV1Schema.safeParse({ ...decision, decision: "invent-route" })
        .success
    ).toBe(false);

    expect(
      CampaignEventV1Schema.safeParse({
        schemaVersion: "summer.campaign-event/v1",
        eventId: "event-0",
        campaignId: "campaign-1",
        sequence: 0,
        occurredAt: "2026-09-03T08:00:00.000Z",
        type: "campaign-started",
        workflowId: "compiled",
        workflowRevision: 1,
        compiledWorkflowDigest: digest("a"),
        registryDigest: digest("b"),
        profile: {
          kind: "iterative-campaign",
          terminalNodeIds: ["only"],
          activationNodeId: "activate",
          iterationNodeId: "iterate",
          experimentNodeId: "experiment",
          budgetNodeId: "budget",
          frameCheckNodeId: "frame",
          decisionNodeId: "decide",
          budgets: {
            maxExperiments: 2,
            maxAttemptsPerExperiment: 2
          }
        },
        nodeContracts: [
          {
            nodeId: "only",
            component: componentRef,
            maxAttempts: 1
          }
        ],
        frameCheckPolicyDigest: digest("f"),
        decisionPolicyDigest: digest("c"),
        frameVersion: 1,
        hypothesisVersion: 1
      }).success
    ).toBe(true);
  });
});
