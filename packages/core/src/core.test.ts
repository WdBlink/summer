import type {
  CampaignEventV1,
  DecisionReceiptV1,
  ExperimentReceiptV1,
  FrameAssessmentV1,
  IterativeCampaignProfileV1,
  NodeReceiptV1,
} from "@summer/protocol";
import { sha256Canonical } from "@summer/protocol";
import { describe, expect, it } from "vitest";

import {
  ConflictingReplayError,
  InMemoryCampaignLedger,
  InvalidCampaignTransitionError,
  MixedReplayError,
  ReceiptIdentityError,
  RevisionConflictError,
  TerminalCampaignError
} from "./index.js";

const at = "2026-09-03T08:00:00.000Z";
const campaignId = "campaign-1";
const workflowId = "campaign-test-workflow";
const compiledWorkflowDigest = sha256Canonical("compiled");
const registryDigest = sha256Canonical("registry");
const planDigest = sha256Canonical("plan-1");
const environmentDigest = sha256Canonical("environment-1");
const evaluatorDigest = sha256Canonical("evaluator-1");
const policyDigest = sha256Canonical("decision-policy-1");
const frameCheckPolicyDigest = sha256Canonical("frame-check-policy-1");

const campaignProfile: IterativeCampaignProfileV1 = {
  kind: "iterative-campaign",
  terminalNodeIds: ["terminal"],
  activationNodeId: "activate",
  iterationNodeId: "plan-generation",
  experimentNodeId: "run-experiment",
  budgetNodeId: "check-budget",
  frameCheckNodeId: "frame-check",
  decisionNodeId: "decide",
  budgets: {
    maxExperiments: 2,
    maxAttemptsPerExperiment: 2,
    maxTotalNodeExecutions: 10
  }
};

const component = (namespace: string, name: string) => ({
  namespace,
  name,
  version: "1.0.0" as const
});

const nodeContracts = [
  { nodeId: "activate", component: component("summer", "activation-policy"), maxAttempts: 1 },
  { nodeId: "plan-generation", component: component("factor", "iteration-policy"), maxAttempts: 1 },
  {
    nodeId: "run-experiment",
    component: component("factor", "strategy-experiment"),
    maxAttempts: 2,
    idempotencyKey: "experiment-id:attempt-id"
  },
  { nodeId: "frame-check", component: component("summer", "frame-check-policy"), maxAttempts: 1 },
  { nodeId: "check-budget", component: component("summer", "budget-policy"), maxAttempts: 1 },
  { nodeId: "decide", component: component("summer", "decision-policy"), maxAttempts: 1 },
  { nodeId: "terminal", component: component("summer", "terminal-receipt"), maxAttempts: 1 }
] as const;

function common(sequence: number, eventId: string) {
  return {
    schemaVersion: "summer.campaign-event/v1" as const,
    eventId,
    campaignId,
    sequence,
    occurredAt: at
  };
}

function campaignStarted(
  profile: IterativeCampaignProfileV1 = campaignProfile
): CampaignEventV1 {
  return {
    ...common(0, "event-start"),
    type: "campaign-started",
    workflowId,
    workflowRevision: 1,
    compiledWorkflowDigest,
    registryDigest,
    profile,
    nodeContracts: [...nodeContracts],
    frameCheckPolicyDigest,
    decisionPolicyDigest: policyDigest,
    frameVersion: 1,
    hypothesisVersion: 1
  };
}

function experimentStarted(
  sequence: number,
  options: {
    attemptId?: string;
    environment?: string;
    plan?: string;
  } = {}
): CampaignEventV1 {
  return {
    ...common(sequence, `event-experiment-start-${options.attemptId ?? "attempt-1"}`),
    type: "experiment-started",
    experimentId: "experiment-1",
    experimentNumber: 1,
    attemptId: options.attemptId ?? "attempt-1",
    planDigest: options.plan ?? planDigest,
    environmentDigest: options.environment ?? environmentDigest,
    evaluatorDigest
  };
}

function nodeReceipt(attempt = 1): NodeReceiptV1 {
  return {
    schemaVersion: "summer.node-receipt/v1",
    receiptId: `node-receipt-${attempt}`,
    workflowId,
    workflowRevision: 1,
    compiledWorkflowDigest,
    registryDigest,
    runId: `run-${attempt}`,
    campaignId,
    experimentId: "experiment-1",
    experimentAttemptId: `attempt-${attempt}`,
    nodeId: "run-experiment",
    attempt,
    component: {
      namespace: "factor",
      name: "strategy-experiment",
      version: "1.0.0"
    },
    idempotencyKey: "experiment-id:attempt-id",
    status: "succeeded",
    inputDigest: sha256Canonical({ attempt, input: true }),
    outputDigest: sha256Canonical({ attempt, output: true }),
    artifactRefs: [],
    startedAt: at,
    completedAt: at
  };
}

function repairedNodeReceipt(): NodeReceiptV1 {
  return {
    ...nodeReceipt(),
    receiptId: "node-receipt-2",
    runId: "run-2",
    experimentAttemptId: "attempt-2",
    inputDigest: sha256Canonical({ repair: 2, input: true }),
    outputDigest: sha256Canonical({ repair: 2, output: true })
  };
}

function nodeRecorded(sequence: number, receipt = nodeReceipt()): CampaignEventV1 {
  return {
    ...common(sequence, `event-${receipt.receiptId}`),
    type: "node-receipt-recorded",
    receipt
  };
}

function experimentReceipt(
  attemptId = "attempt-1",
  environment = environmentDigest,
  nodeReceiptIds = ["node-receipt-1"]
): ExperimentReceiptV1 {
  return {
    schemaVersion: "summer.experiment-receipt/v1",
    receiptId: `experiment-receipt-${attemptId}`,
    campaignId,
    workflowId,
    workflowRevision: 1,
    compiledWorkflowDigest,
    registryDigest,
    frameVersion: 1,
    hypothesisVersion: 1,
    experimentId: "experiment-1",
    experimentNumber: 1,
    attemptId,
    status: "succeeded",
    nodeReceiptIds,
    planDigest,
    environmentDigest: environment,
    evaluatorDigest,
    changedVariables: [],
    metrics: { score: 1 },
    artifactRefs: [],
    startedAt: at,
    completedAt: at
  };
}

function experimentCompleted(
  sequence: number,
  receipt = experimentReceipt()
): CampaignEventV1 {
  return {
    ...common(sequence, `event-${receipt.receiptId}`),
    type: "experiment-completed",
    receipt
  };
}

function assessment(): FrameAssessmentV1 {
  return {
    schemaVersion: "summer.frame-assessment/v1",
    assessmentId: "assessment-1",
    campaignId,
    experimentId: "experiment-1",
    frameVersion: 1,
    policyDigest: frameCheckPolicyDigest,
    evaluatorDigest,
    verdict: "frame-valid",
    evidence: [{ ref: "receipt:experiment-receipt-attempt-1" }],
    rationale: "The experiment is comparable to its frozen frame.",
    assessedAt: at
  };
}

function frameAssessed(sequence: number): CampaignEventV1 {
  return {
    ...common(sequence, "event-assessment-1"),
    type: "frame-assessed",
    assessment: assessment()
  };
}

function stopDecision(): Extract<DecisionReceiptV1, { decision: "stop" }> {
  return {
    schemaVersion: "summer.decision-receipt/v1",
    decisionId: "decision-stop-1",
    campaignId,
    fromExperimentId: "experiment-1",
    assessmentId: "assessment-1",
    policyDigest,
    reason: "The target metric is achieved.",
    evidenceRefs: [{ ref: "assessment:assessment-1" }],
    decidedAt: at,
    decision: "stop",
    stopReason: "goal-achieved"
  };
}

function appendCompletedExperiment(ledger: InMemoryCampaignLedger): void {
  ledger.append(campaignId, 1, [
    experimentStarted(1),
    nodeRecorded(2),
    experimentCompleted(3),
    frameAssessed(4)
  ]);
}

describe("InMemoryCampaignLedger", () => {
  it("commits a receipt-bound campaign and makes terminal state immutable", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-stop"),
        type: "decision-committed",
        receipt: stopDecision()
      },
      {
        ...common(6, "event-campaign-completed"),
        type: "campaign-completed",
        status: "succeeded",
        reason: "goal-achieved"
      }
    ]);

    const record = ledger.read(campaignId);
    expect(record?.projection.status).toBe("succeeded");
    expect(record?.projection.revision).toBe(7);
    expect(record?.projection.experiments["experiment-1"]?.attemptReceipts).toHaveLength(1);
    expect(() =>
      ledger.append(campaignId, 7, [
        { ...frameAssessed(7), eventId: "event-after-terminal" }
      ])
    ).toThrow(TerminalCampaignError);
  });

  it("accepts only terminal-node receipts after a stop decision", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-stop"),
        type: "decision-committed",
        receipt: stopDecision()
      }
    ]);
    const {
      experimentId: _experimentId,
      experimentAttemptId: _experimentAttemptId,
      idempotencyKey: _idempotencyKey,
      ...unscopedReceipt
    } = nodeReceipt();
    expect(() =>
      ledger.append(campaignId, 6, [
        nodeRecorded(6, {
          ...unscopedReceipt,
          receiptId: "late-nonterminal-receipt",
          runId: "run-late-nonterminal",
          nodeId: "activate",
          component: component("summer", "activation-policy")
        })
      ])
    ).toThrow(InvalidCampaignTransitionError);

    const terminalAppend = ledger.append(campaignId, 6, [
      nodeRecorded(6, {
        ...unscopedReceipt,
        receiptId: "terminal-node-receipt",
        runId: "run-terminal",
        nodeId: "terminal",
        component: component("summer", "terminal-receipt")
      })
    ]);
    expect(terminalAppend.projection.status).toBe("stopping");
  });

  it("accepts exact replay, rejects conflicting and mixed replay", () => {
    const ledger = new InMemoryCampaignLedger();
    const start = campaignStarted();
    ledger.append(campaignId, 0, [start]);

    expect(ledger.append(campaignId, 99, [start])).toMatchObject({
      appended: 0,
      replayed: true
    });
    expect(() =>
      ledger.append(campaignId, 1, [{ ...start, occurredAt: "2026-09-03T09:00:00.000Z" }])
    ).toThrow(ConflictingReplayError);
    expect(() =>
      ledger.append(campaignId, 1, [start, experimentStarted(1)])
    ).toThrow(MixedReplayError);
  });

  it("uses compare-and-swap and keeps a failed batch atomic", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    expect(() => ledger.append(campaignId, 0, [experimentStarted(1)])).toThrow(
      RevisionConflictError
    );

    expect(() =>
      ledger.append(campaignId, 1, [
        experimentStarted(1),
        experimentCompleted(2)
      ])
    ).toThrow(ReceiptIdentityError);
    expect(ledger.read(campaignId)?.projection.revision).toBe(1);
    expect(ledger.read(campaignId)?.events).toHaveLength(1);
    expect(() => ledger.append(campaignId, 999, [])).toThrow(
      RevisionConflictError
    );
  });

  it("rejects receipts for unknown nodes, components, attempts, and experiment scope", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    ledger.append(campaignId, 1, [experimentStarted(1)]);
    const {
      experimentId: _experimentId,
      experimentAttemptId: _experimentAttemptId,
      ...unscopedExperimentNodeReceipt
    } = nodeReceipt();
    const {
      idempotencyKey: _campaignNodeIdempotencyKey,
      ...campaignNodeAsExperimentReceipt
    } = nodeReceipt();

    expect(() =>
      ledger.append(campaignId, 2, [
        nodeRecorded(2, {
          ...campaignNodeAsExperimentReceipt,
          receiptId: "forged-node-receipt",
          nodeId: "node-not-in-compiled-workflow",
          component: component("unknown", "forged-component"),
          attempt: 999
        })
      ])
    ).toThrow(ReceiptIdentityError);
    expect(() =>
      ledger.append(campaignId, 2, [
        nodeRecorded(2, {
          ...nodeReceipt(),
          receiptId: "wrong-idempotency-key-receipt",
          idempotencyKey: "different-operation"
        })
      ])
    ).toThrow(ReceiptIdentityError);
    expect(() =>
      ledger.append(campaignId, 2, [
        nodeRecorded(2, {
          ...nodeReceipt(),
          receiptId: "wrong-attempt-receipt",
          experimentAttemptId: "attempt-999"
        })
      ])
    ).toThrow(ReceiptIdentityError);
    expect(() =>
      ledger.append(campaignId, 2, [
        nodeRecorded(2, {
          ...nodeReceipt(),
          receiptId: "campaign-node-as-experiment-receipt",
          nodeId: "activate",
          component: component("summer", "activation-policy")
        })
      ])
    ).toThrow(ReceiptIdentityError);
    expect(() =>
      ledger.append(campaignId, 2, [
        nodeRecorded(2, {
          ...unscopedExperimentNodeReceipt,
          receiptId: "unscoped-experiment-node-receipt"
        })
      ])
    ).toThrow(ReceiptIdentityError);
  });

  it("keeps node retries dense and judges an experiment by the final node attempt", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    ledger.append(campaignId, 1, [experimentStarted(1)]);
    const {
      outputDigest: _outputDigest,
      ...failedReceiptBase
    } = nodeReceipt();
    const failedReceipt: NodeReceiptV1 = {
      ...failedReceiptBase,
      receiptId: "node-receipt-failed-1",
      status: "failed",
      error: {
        code: "TRANSIENT_RUNTIME_FAILURE",
        message: "The first node attempt failed transiently.",
        retryable: true
      }
    };
    const recoveredReceipt: NodeReceiptV1 = {
      ...nodeReceipt(),
      receiptId: "node-receipt-recovered-2",
      attempt: 2,
      inputDigest: failedReceipt.inputDigest,
      outputDigest: sha256Canonical({ attempt: 2, output: true })
    };
    ledger.append(campaignId, 2, [nodeRecorded(2, failedReceipt)]);
    expect(() =>
      ledger.append(campaignId, 3, [
        nodeRecorded(3, {
          ...recoveredReceipt,
          receiptId: "node-receipt-changed-input",
          inputDigest: sha256Canonical("changed-retry-input")
        })
      ])
    ).toThrow(ReceiptIdentityError);
    ledger.append(campaignId, 3, [
      nodeRecorded(3, recoveredReceipt),
      experimentCompleted(
        4,
        experimentReceipt("attempt-1", environmentDigest, [
          failedReceipt.receiptId,
          recoveredReceipt.receiptId
        ])
      )
    ]);
    expect(
      ledger.read(campaignId)?.projection.experiments["experiment-1"]?.receipt
        ?.status
    ).toBe("succeeded");

    const noRetryAfterSuccess = new InMemoryCampaignLedger();
    noRetryAfterSuccess.append(campaignId, 0, [campaignStarted()]);
    noRetryAfterSuccess.append(campaignId, 1, [
      experimentStarted(1),
      nodeRecorded(2)
    ]);
    expect(() =>
      noRetryAfterSuccess.append(campaignId, 3, [
        nodeRecorded(3, recoveredReceipt)
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("requires an explicit repair decision before opening a new attempt", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    const repair: DecisionReceiptV1 = {
      schemaVersion: "summer.decision-receipt/v1",
      decisionId: "decision-repair-1",
      campaignId,
      fromExperimentId: "experiment-1",
      assessmentId: "assessment-1",
      policyDigest,
      reason: "The runner failed independently of the research hypothesis.",
      evidenceRefs: [{ ref: "assessment:assessment-1" }],
      decidedAt: at,
      decision: "repair-runtime",
      experimentId: "experiment-1",
      nextAttemptId: "attempt-2"
    };
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-repair"),
        type: "decision-committed",
        receipt: repair
      }
    ]);

    const repairedEnvironment = sha256Canonical("environment-repaired");
    ledger.append(campaignId, 6, [
      experimentStarted(6, {
        attemptId: "attempt-2",
        environment: repairedEnvironment
      })
    ]);
    const experiment = ledger.read(campaignId)?.projection.experiments["experiment-1"];
    expect(experiment?.attemptId).toBe("attempt-2");
    expect(experiment?.receipt).toBeUndefined();
    expect(experiment?.attemptReceipts).toHaveLength(1);
  });

  it("keeps experiment receipt identities globally unique across repaired attempts", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-repair"),
        type: "decision-committed",
        receipt: {
          schemaVersion: "summer.decision-receipt/v1",
          decisionId: "decision-repair-1",
          campaignId,
          fromExperimentId: "experiment-1",
          assessmentId: "assessment-1",
          policyDigest,
          reason: "Retry the same experiment after runtime repair.",
          evidenceRefs: [{ ref: "assessment:assessment-1" }],
          decidedAt: at,
          decision: "repair-runtime",
          experimentId: "experiment-1",
          nextAttemptId: "attempt-2"
        }
      }
    ]);
    const repairedEnvironment = sha256Canonical("environment-repaired");
    ledger.append(campaignId, 6, [
      experimentStarted(6, {
        attemptId: "attempt-2",
        environment: repairedEnvironment
      }),
      nodeRecorded(7, repairedNodeReceipt())
    ]);
    const reusedReceipt = {
      ...experimentReceipt(
        "attempt-2",
        repairedEnvironment,
        ["node-receipt-2"]
      ),
      receiptId: "experiment-receipt-attempt-1"
    };

    expect(() =>
      ledger.append(campaignId, 8, [
        {
          ...experimentCompleted(8, reusedReceipt),
          eventId: "event-reused-receipt-new-event"
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("rejects a repair decision that reuses a historical attempt identity", () => {
    const threeAttemptProfile: IterativeCampaignProfileV1 = {
      ...campaignProfile,
      budgets: {
        ...campaignProfile.budgets,
        maxAttemptsPerExperiment: 3
      }
    };
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted(threeAttemptProfile)]);
    appendCompletedExperiment(ledger);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-repair-2"),
        type: "decision-committed",
        receipt: {
          schemaVersion: "summer.decision-receipt/v1",
          decisionId: "decision-repair-2",
          campaignId,
          fromExperimentId: "experiment-1",
          assessmentId: "assessment-1",
          policyDigest,
          reason: "Retry once after a runtime repair.",
          evidenceRefs: [{ ref: "assessment:assessment-1" }],
          decidedAt: at,
          decision: "repair-runtime",
          experimentId: "experiment-1",
          nextAttemptId: "attempt-2"
        }
      }
    ]);
    const repairedEnvironment = sha256Canonical("environment-repaired");
    ledger.append(campaignId, 6, [
      experimentStarted(6, {
        attemptId: "attempt-2",
        environment: repairedEnvironment
      }),
      nodeRecorded(7, repairedNodeReceipt()),
      experimentCompleted(
        8,
        experimentReceipt(
          "attempt-2",
          repairedEnvironment,
          ["node-receipt-2"]
        )
      ),
      {
        ...common(9, "event-assessment-attempt-2"),
        type: "frame-assessed",
        assessment: {
          ...assessment(),
          assessmentId: "assessment-attempt-2",
          evidence: [{ ref: "receipt:experiment-receipt-attempt-2" }]
        }
      }
    ]);

    expect(() =>
      ledger.append(campaignId, 10, [
        {
          ...common(10, "event-decision-reuse-attempt-1"),
          type: "decision-committed",
          receipt: {
            schemaVersion: "summer.decision-receipt/v1",
            decisionId: "decision-reuse-attempt-1",
            campaignId,
            fromExperimentId: "experiment-1",
            assessmentId: "assessment-attempt-2",
            policyDigest,
            reason: "Attempt to reuse the first runtime identity.",
            evidenceRefs: [{ ref: "assessment:assessment-attempt-2" }],
            decidedAt: at,
            decision: "repair-runtime",
            experimentId: "experiment-1",
            nextAttemptId: "attempt-1"
          }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("binds the next experiment to the committed plan digest", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    const nextPlanDigest = sha256Canonical("plan-2");
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-next"),
        type: "decision-committed",
        receipt: {
          schemaVersion: "summer.decision-receipt/v1",
          decisionId: "decision-next-1",
          campaignId,
          fromExperimentId: "experiment-1",
          assessmentId: "assessment-1",
          policyDigest,
          reason: "The next candidate changes one independent variable.",
          evidenceRefs: [{ ref: "assessment:assessment-1" }],
          decidedAt: at,
          decision: "run-next-experiment",
          nextExperimentId: "experiment-2",
          planDigest: nextPlanDigest
        }
      }
    ]);

    const invalidNext: CampaignEventV1 = {
      ...common(6, "event-experiment-start-2"),
      type: "experiment-started",
      experimentId: "experiment-2",
      experimentNumber: 2,
      attemptId: "attempt-1",
      planDigest: sha256Canonical("different-plan"),
      environmentDigest,
      evaluatorDigest,
      baselineExperimentId: "experiment-1"
    };
    expect(() => ledger.append(campaignId, 6, [invalidNext])).toThrow(
      ReceiptIdentityError
    );
    const {
      baselineExperimentId: _baselineExperimentId,
      ...nextWithoutBaseline
    } = invalidNext;
    expect(() =>
      ledger.append(campaignId, 6, [
        {
          ...nextWithoutBaseline,
          eventId: "event-experiment-start-without-baseline",
          planDigest: nextPlanDigest
        }
      ])
    ).toThrow(ReceiptIdentityError);
  });

  it("records two factor generations under one authoritative campaign cursor", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    const nextPlanDigest = sha256Canonical("plan-2");
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-next"),
        type: "decision-committed",
        receipt: {
          schemaVersion: "summer.decision-receipt/v1",
          decisionId: "decision-next-1",
          campaignId,
          fromExperimentId: "experiment-1",
          assessmentId: "assessment-1",
          policyDigest,
          reason: "Run the one-variable candidate selected for generation two.",
          evidenceRefs: [{ ref: "assessment:assessment-1" }],
          decidedAt: at,
          decision: "run-next-experiment",
          nextExperimentId: "experiment-2",
          planDigest: nextPlanDigest
        }
      }
    ]);

    const secondNodeReceipt: NodeReceiptV1 = {
      ...nodeReceipt(),
      receiptId: "node-receipt-2",
      runId: "run-2",
      experimentId: "experiment-2",
      inputDigest: sha256Canonical({ generation: 2, input: true }),
      outputDigest: sha256Canonical({ generation: 2, output: true })
    };
    const secondExperimentReceipt: ExperimentReceiptV1 = {
      ...experimentReceipt(),
      receiptId: "experiment-receipt-2",
      experimentId: "experiment-2",
      experimentNumber: 2,
      nodeReceiptIds: [secondNodeReceipt.receiptId],
      planDigest: nextPlanDigest,
      baselineExperimentId: "experiment-1",
      changedVariables: [
        {
          name: "lookback",
          beforeDigest: sha256Canonical(20),
          afterDigest: sha256Canonical(30)
        }
      ],
      metrics: { score: 1.1 }
    };
    const secondAssessment: FrameAssessmentV1 = {
      ...assessment(),
      assessmentId: "assessment-2",
      experimentId: "experiment-2",
      evidence: [{ ref: "receipt:experiment-receipt-2" }],
      rationale: "The second generation remains comparable under the frozen evaluator."
    };
    ledger.append(campaignId, 6, [
      {
        ...common(6, "event-experiment-start-2"),
        type: "experiment-started",
        experimentId: "experiment-2",
        experimentNumber: 2,
        attemptId: "attempt-1",
        planDigest: nextPlanDigest,
        environmentDigest,
        evaluatorDigest,
        baselineExperimentId: "experiment-1"
      },
      nodeRecorded(7, secondNodeReceipt),
      experimentCompleted(8, secondExperimentReceipt),
      {
        ...common(9, "event-assessment-2"),
        type: "frame-assessed",
        assessment: secondAssessment
      },
      {
        ...common(10, "event-decision-stop-budget"),
        type: "decision-committed",
        receipt: {
          ...stopDecision(),
          decisionId: "decision-stop-budget",
          fromExperimentId: "experiment-2",
          assessmentId: "assessment-2",
          reason: "The two-generation conformance budget is exhausted.",
          evidenceRefs: [{ ref: "assessment:assessment-2" }],
          stopReason: "budget-exhausted"
        }
      },
      {
        ...common(11, "event-campaign-completed-budget"),
        type: "campaign-completed",
        status: "stopped",
        reason: "budget-exhausted"
      }
    ]);

    const projection = ledger.read(campaignId)?.projection;
    expect(projection?.status).toBe("stopped");
    expect(projection?.revision).toBe(12);
    expect(Object.keys(projection?.experiments ?? {})).toEqual([
      "experiment-1",
      "experiment-2"
    ]);
    expect(projection?.decisions.map(({ decision }) => decision)).toEqual([
      "run-next-experiment",
      "stop"
    ]);
  });

  it("allows only one authoritative decision per frame assessment", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-stop"),
        type: "decision-committed",
        receipt: stopDecision()
      }
    ]);
    expect(() =>
      ledger.append(campaignId, 6, [
        {
          ...common(6, "event-decision-stop-duplicate"),
          type: "decision-committed",
          receipt: { ...stopDecision(), decisionId: "decision-stop-2" }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("binds frame assessments to the frozen frame-check policy", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    ledger.append(campaignId, 1, [
      experimentStarted(1),
      nodeRecorded(2),
      experimentCompleted(3)
    ]);

    expect(() =>
      ledger.append(campaignId, 4, [
        {
          ...common(4, "event-assessment-forged-policy"),
          type: "frame-assessed",
          assessment: {
            ...assessment(),
            assessmentId: "assessment-forged-policy",
            policyDigest: sha256Canonical("forged-frame-check-policy")
          }
        }
      ])
    ).toThrow(ReceiptIdentityError);
  });

  it("does not let a campaign-level assessment or stop bypass an active experiment", () => {
    const {
      experimentId: _experimentId,
      ...campaignAssessmentFields
    } = assessment();
    const campaignAssessment: FrameAssessmentV1 = {
      ...campaignAssessmentFields,
      assessmentId: "assessment-active-campaign",
      verdict: "stop-recommended",
      rationale: "A campaign-level assessment cannot preempt an active experiment."
    };

    const directLedger = new InMemoryCampaignLedger();
    directLedger.append(campaignId, 0, [campaignStarted()]);
    directLedger.append(campaignId, 1, [experimentStarted(1)]);
    expect(() =>
      directLedger.append(campaignId, 2, [
        {
          ...common(2, "event-assessment-during-active-experiment"),
          type: "frame-assessed",
          assessment: campaignAssessment
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);

    const staleAssessmentLedger = new InMemoryCampaignLedger();
    staleAssessmentLedger.append(campaignId, 0, [campaignStarted()]);
    staleAssessmentLedger.append(campaignId, 1, [
      {
        ...common(1, "event-preflight-assessment"),
        type: "frame-assessed",
        assessment: campaignAssessment
      },
      experimentStarted(2)
    ]);
    expect(() =>
      staleAssessmentLedger.append(campaignId, 3, [
        {
          ...common(3, "event-stop-during-active-experiment"),
          type: "decision-committed",
          receipt: {
            schemaVersion: "summer.decision-receipt/v1",
            decisionId: "decision-stop-during-active-experiment",
            campaignId,
            assessmentId: "assessment-active-campaign",
            policyDigest,
            reason: "Attempt to stop before the active experiment is closed.",
            evidenceRefs: [{ ref: "assessment:assessment-active-campaign" }],
            decidedAt: at,
            decision: "stop",
            stopReason: "human-request"
          }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("binds decisions to the frozen policy and rejects evidence-free success", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    const campaignAssessment: FrameAssessmentV1 = {
      schemaVersion: "summer.frame-assessment/v1",
      assessmentId: "assessment-preflight",
      campaignId,
      frameVersion: 1,
      policyDigest: frameCheckPolicyDigest,
      evaluatorDigest,
      verdict: "stop-recommended",
      evidence: [{ ref: "preflight:invalid-frame" }],
      rationale: "The campaign frame cannot be executed safely.",
      assessedAt: at
    };
    ledger.append(campaignId, 1, [
      {
        ...common(1, "event-assessment-preflight"),
        type: "frame-assessed",
        assessment: campaignAssessment
      }
    ]);

    const preflightStop: Extract<DecisionReceiptV1, { decision: "stop" }> = {
      schemaVersion: "summer.decision-receipt/v1",
      decisionId: "decision-preflight",
      campaignId,
      assessmentId: "assessment-preflight",
      policyDigest,
      reason: "Stop before execution.",
      evidenceRefs: [{ ref: "assessment:assessment-preflight" }],
      decidedAt: at,
      decision: "stop",
      stopReason: "goal-achieved"
    };
    expect(() =>
      ledger.append(campaignId, 2, [
        {
          ...common(2, "event-decision-wrong-policy"),
          type: "decision-committed",
          receipt: {
            ...preflightStop,
            policyDigest: sha256Canonical("forged-policy")
          }
        }
      ])
    ).toThrow(ReceiptIdentityError);
    expect(() =>
      ledger.append(campaignId, 2, [
        {
          ...common(2, "event-decision-evidence-free-success"),
          type: "decision-committed",
          receipt: preflightStop
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("freezes the next experiment identity and plan during hypothesis recompile", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    ledger.append(campaignId, 1, [
      experimentStarted(1),
      nodeRecorded(2),
      experimentCompleted(3),
      {
        ...common(4, "event-assessment-recompile"),
        type: "frame-assessed",
        assessment: {
          ...assessment(),
          assessmentId: "assessment-recompile",
          verdict: "recompile-required",
          rationale: "The evidence requires a new frame and hypothesis."
        }
      }
    ]);
    const recompiledPlanDigest = sha256Canonical("recompiled-plan-2");
    const recompileDecision: Extract<
      DecisionReceiptV1,
      { decision: "recompile-hypothesis" }
    > = {
      schemaVersion: "summer.decision-receipt/v1",
      decisionId: "decision-recompile",
      campaignId,
      fromExperimentId: "experiment-1",
      assessmentId: "assessment-recompile",
      policyDigest,
      reason: "Advance the frame and run the committed replacement plan.",
      evidenceRefs: [{ ref: "assessment:assessment-recompile" }],
      decidedAt: at,
      decision: "recompile-hypothesis",
      nextExperimentId: "experiment-2",
      planDigest: recompiledPlanDigest,
      nextFrameVersion: 2,
      nextHypothesisVersion: 2
    };
    expect(() =>
      ledger.append(campaignId, 5, [
        {
          ...common(5, "event-decision-recompile-reused-experiment"),
          type: "decision-committed",
          receipt: {
            ...recompileDecision,
            decisionId: "decision-recompile-reused-experiment",
            nextExperimentId: "experiment-1"
          }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-recompile"),
        type: "decision-committed",
        receipt: recompileDecision
      }
    ]);

    expect(() =>
      ledger.append(campaignId, 6, [
        {
          ...common(6, "event-wrong-recompiled-plan"),
          type: "experiment-started",
          experimentId: "experiment-2",
          experimentNumber: 2,
          attemptId: "attempt-1",
          planDigest: sha256Canonical("uncommitted-plan"),
          environmentDigest,
          evaluatorDigest,
          baselineExperimentId: "experiment-1"
        }
      ])
    ).toThrow(ReceiptIdentityError);

    const started = ledger.append(campaignId, 6, [
      {
        ...common(6, "event-recompiled-experiment"),
        type: "experiment-started",
        experimentId: "experiment-2",
        experimentNumber: 2,
        attemptId: "attempt-1",
        planDigest: recompiledPlanDigest,
        environmentDigest,
        evaluatorDigest
      }
    ]);
    expect(started.projection.experiments["experiment-2"]).toMatchObject({
      frameVersion: 2,
      hypothesisVersion: 2,
      planDigest: recompiledPlanDigest
    });
  });

  it("enforces campaign experiment budgets before committing another decision", () => {
    const oneExperimentProfile: IterativeCampaignProfileV1 = {
      ...campaignProfile,
      budgets: { ...campaignProfile.budgets, maxExperiments: 1 }
    };
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted(oneExperimentProfile)]);
    appendCompletedExperiment(ledger);

    expect(() =>
      ledger.append(campaignId, 5, [
        {
          ...common(5, "event-decision-over-budget"),
          type: "decision-committed",
          receipt: {
            schemaVersion: "summer.decision-receipt/v1",
            decisionId: "decision-over-budget",
            campaignId,
            fromExperimentId: "experiment-1",
            assessmentId: "assessment-1",
            policyDigest,
            reason: "Attempt one experiment beyond the frozen budget.",
            evidenceRefs: [{ ref: "assessment:assessment-1" }],
            decidedAt: at,
            decision: "run-next-experiment",
            nextExperimentId: "experiment-2",
            planDigest: sha256Canonical("plan-2")
          }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);

    const recompileLedger = new InMemoryCampaignLedger();
    recompileLedger.append(campaignId, 0, [campaignStarted(oneExperimentProfile)]);
    recompileLedger.append(campaignId, 1, [
      experimentStarted(1),
      nodeRecorded(2),
      experimentCompleted(3),
      {
        ...common(4, "event-assessment-recompile-at-budget"),
        type: "frame-assessed",
        assessment: {
          ...assessment(),
          assessmentId: "assessment-recompile-at-budget",
          verdict: "recompile-required",
          rationale: "The frame must change before another experiment."
        }
      }
    ]);
    expect(() =>
      recompileLedger.append(campaignId, 5, [
        {
          ...common(5, "event-recompile-over-budget"),
          type: "decision-committed",
          receipt: {
            schemaVersion: "summer.decision-receipt/v1",
            decisionId: "decision-recompile-over-budget",
            campaignId,
            fromExperimentId: "experiment-1",
            assessmentId: "assessment-recompile-at-budget",
            policyDigest,
            reason: "Try to recompile after the experiment budget is exhausted.",
            evidenceRefs: [
              { ref: "assessment:assessment-recompile-at-budget" }
            ],
            decidedAt: at,
            decision: "recompile-hypothesis",
            nextExperimentId: "experiment-2",
            planDigest: sha256Canonical("recompiled-plan-2"),
            nextFrameVersion: 2,
            nextHypothesisVersion: 2
          }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);

    const oneNodeProfile: IterativeCampaignProfileV1 = {
      ...campaignProfile,
      budgets: {
        ...campaignProfile.budgets,
        maxTotalNodeExecutions: 1
      }
    };
    const nodeBudgetLedger = new InMemoryCampaignLedger();
    nodeBudgetLedger.append(campaignId, 0, [campaignStarted(oneNodeProfile)]);
    appendCompletedExperiment(nodeBudgetLedger);
    expect(() =>
      nodeBudgetLedger.append(campaignId, 5, [
        {
          ...common(5, "event-next-over-node-budget"),
          type: "decision-committed",
          receipt: {
            schemaVersion: "summer.decision-receipt/v1",
            decisionId: "decision-next-over-node-budget",
            campaignId,
            fromExperimentId: "experiment-1",
            assessmentId: "assessment-1",
            policyDigest,
            reason: "Attempt another experiment after consuming the node budget.",
            evidenceRefs: [{ ref: "assessment:assessment-1" }],
            decidedAt: at,
            decision: "run-next-experiment",
            nextExperimentId: "experiment-2",
            planDigest: sha256Canonical("plan-2")
          }
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });

  it("enforces the terminal status implied by the typed stop reason", () => {
    const ledger = new InMemoryCampaignLedger();
    ledger.append(campaignId, 0, [campaignStarted()]);
    appendCompletedExperiment(ledger);
    ledger.append(campaignId, 5, [
      {
        ...common(5, "event-decision-fatal"),
        type: "decision-committed",
        receipt: {
          ...stopDecision(),
          decisionId: "decision-fatal",
          reason: "An unrecoverable invariant failed.",
          stopReason: "fatal-error"
        }
      }
    ]);

    expect(() =>
      ledger.append(campaignId, 6, [
        {
          ...common(6, "event-invalid-terminal-status"),
          type: "campaign-completed",
          status: "succeeded",
          reason: "fatal-error"
        }
      ])
    ).toThrow(InvalidCampaignTransitionError);
  });
});
