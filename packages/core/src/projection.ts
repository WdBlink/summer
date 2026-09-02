import type {
  CampaignNodeContractV1,
  CampaignEventV1,
  DecisionReceiptV1,
  ExactComponentRef,
  ExperimentReceiptV1,
  FrameAssessmentV1,
  NodeReceiptV1,
  StopReason,
  WorkflowProfileV1
} from "@summer/protocol";

import {
  InvalidCampaignTransitionError,
  ReceiptIdentityError,
  TerminalCampaignError
} from "./errors.js";

export type CampaignStatus =
  | "running"
  | "waiting"
  | "stopping"
  | "succeeded"
  | "stopped"
  | "failed";

export interface ExperimentProjection {
  readonly experimentId: string;
  readonly experimentNumber: number;
  readonly frameVersion: number;
  readonly hypothesisVersion: number;
  readonly attemptId: string;
  readonly planDigest: string;
  readonly environmentDigest: string;
  readonly evaluatorDigest: string;
  readonly baselineExperimentId?: string;
  readonly nodeReceiptIds: readonly string[];
  readonly attemptReceipts: readonly ExperimentReceiptV1[];
  readonly receipt?: ExperimentReceiptV1;
}

export interface CampaignProjection {
  readonly campaignId: string;
  readonly revision: number;
  readonly status: CampaignStatus;
  readonly workflowId: string;
  readonly workflowRevision: number;
  readonly compiledWorkflowDigest: string;
  readonly registryDigest: string;
  readonly profile: WorkflowProfileV1;
  readonly nodeContracts: Readonly<Record<string, CampaignNodeContractV1>>;
  readonly frameCheckPolicyDigest?: string;
  readonly decisionPolicyDigest?: string;
  readonly totalNodeExecutions: number;
  readonly frameVersion: number;
  readonly hypothesisVersion: number;
  readonly currentExperimentId?: string;
  readonly expectedNextExperimentId?: string;
  readonly expectedNextPlanDigest?: string;
  readonly expectedNextBaselineExperimentId?: string;
  readonly expectedRecompiledExperiment?: {
    readonly experimentId: string;
    readonly planDigest: string;
  };
  readonly expectedRepair?: {
    readonly experimentId: string;
    readonly nextAttemptId: string;
  };
  readonly experiments: Readonly<Record<string, ExperimentProjection>>;
  readonly nodeReceipts: Readonly<Record<string, NodeReceiptV1>>;
  readonly frameAssessments: Readonly<Record<string, FrameAssessmentV1>>;
  readonly decisions: readonly DecisionReceiptV1[];
  readonly terminal?: {
    readonly status: "succeeded" | "stopped" | "failed";
    readonly reason: StopReason;
  };
  readonly lastEventId: string;
}

const terminalStatuses = new Set<CampaignStatus>([
  "succeeded",
  "stopped",
  "failed"
]);

function fail(message: string): never {
  throw new InvalidCampaignTransitionError(message);
}

function sameComponentRef(
  left: ExactComponentRef,
  right: ExactComponentRef
): boolean {
  return (
    left.namespace === right.namespace &&
    left.name === right.name &&
    left.version === right.version
  );
}

function terminalStatusFor(reason: StopReason): "succeeded" | "stopped" | "failed" {
  if (reason === "goal-achieved") return "succeeded";
  if (reason === "fatal-error") return "failed";
  return "stopped";
}

function assertReceiptIdentity(
  projection: CampaignProjection,
  receipt: NodeReceiptV1 | ExperimentReceiptV1
): void {
  if (receipt.campaignId !== projection.campaignId) {
    throw new ReceiptIdentityError(
      `Receipt ${receipt.receiptId} campaign identity does not match ${projection.campaignId}`
    );
  }
  if (
    receipt.workflowId !== projection.workflowId ||
    receipt.workflowRevision !== projection.workflowRevision
  ) {
    throw new ReceiptIdentityError(
      `Receipt ${receipt.receiptId} workflow identity does not match the campaign`
    );
  }
  if (
    receipt.compiledWorkflowDigest !== projection.compiledWorkflowDigest ||
    receipt.registryDigest !== projection.registryDigest
  ) {
    throw new ReceiptIdentityError(
      `Receipt ${receipt.receiptId} was produced by a different compiled workflow or registry snapshot`
    );
  }
}

function assertCampaignIdentity(
  projection: CampaignProjection,
  value: { campaignId: string },
  identity: string
): void {
  if (value.campaignId !== projection.campaignId) {
    throw new ReceiptIdentityError(
      `${identity} campaign identity does not match ${projection.campaignId}`
    );
  }
}

function assertCurrentExperimentComplete(
  projection: CampaignProjection,
  experimentId: string | undefined
): ExperimentProjection | undefined {
  if (experimentId === undefined) return undefined;
  const experiment = projection.experiments[experimentId];
  if (experiment === undefined || experiment.receipt === undefined) {
    fail(`Experiment ${experimentId} must be committed before this transition`);
  }
  return experiment;
}

function assertExperimentExecutionCapacity(
  projection: CampaignProjection,
  action: string
): void {
  if (projection.profile.kind !== "iterative-campaign") return;
  const maximum = projection.profile.budgets.maxTotalNodeExecutions;
  if (maximum !== undefined && projection.totalNodeExecutions >= maximum) {
    fail(`${action} requires an experiment-node execution beyond maxTotalNodeExecutions=${maximum}`);
  }
}

function applyStarted(
  event: Extract<CampaignEventV1, { type: "campaign-started" }>
): CampaignProjection {
  const nodeContracts: Record<string, CampaignNodeContractV1> = {};
  for (const contract of event.nodeContracts) {
    if (nodeContracts[contract.nodeId] !== undefined) {
      fail(`Campaign start contains duplicate node contract ${contract.nodeId}`);
    }
    nodeContracts[contract.nodeId] = contract;
  }
  for (const terminalNodeId of event.profile.terminalNodeIds) {
    if (nodeContracts[terminalNodeId] === undefined) {
      fail(`Campaign start is missing terminal node contract ${terminalNodeId}`);
    }
  }
  if (event.profile.kind === "iterative-campaign") {
    if (
      event.frameCheckPolicyDigest === undefined ||
      event.decisionPolicyDigest === undefined
    ) {
      fail("An iterative campaign must freeze frame-check and decision policy digests");
    }
    const requiredNodeIds = [
      event.profile.activationNodeId,
      event.profile.iterationNodeId,
      event.profile.experimentNodeId,
      event.profile.budgetNodeId,
      event.profile.frameCheckNodeId,
      event.profile.decisionNodeId
    ];
    for (const nodeId of requiredNodeIds) {
      if (nodeContracts[nodeId] === undefined) {
        fail(`Campaign start is missing the compiled node contract ${nodeId}`);
      }
    }
  }
  return {
    campaignId: event.campaignId,
    revision: 1,
    status: "running",
    workflowId: event.workflowId,
    workflowRevision: event.workflowRevision,
    compiledWorkflowDigest: event.compiledWorkflowDigest,
    registryDigest: event.registryDigest,
    profile: event.profile,
    nodeContracts,
    ...(event.frameCheckPolicyDigest === undefined
      ? {}
      : { frameCheckPolicyDigest: event.frameCheckPolicyDigest }),
    ...(event.decisionPolicyDigest === undefined
      ? {}
      : { decisionPolicyDigest: event.decisionPolicyDigest }),
    totalNodeExecutions: 0,
    frameVersion: event.frameVersion,
    hypothesisVersion: event.hypothesisVersion,
    experiments: {},
    nodeReceipts: {},
    frameAssessments: {},
    decisions: [],
    lastEventId: event.eventId
  };
}

export function reduceCampaign(
  current: CampaignProjection | null,
  event: CampaignEventV1
): CampaignProjection {
  if (current === null) {
    if (event.type !== "campaign-started") {
      fail("The first campaign event must be campaign-started");
    }
    return applyStarted(event);
  }

  if (event.type === "campaign-started") {
    fail(`Campaign ${current.campaignId} has already started`);
  }
  if (event.campaignId !== current.campaignId) {
    fail(
      `Event ${event.eventId} belongs to ${event.campaignId}, not ${current.campaignId}`
    );
  }
  if (terminalStatuses.has(current.status)) {
    throw new TerminalCampaignError(current.campaignId);
  }
  if (
    current.status === "stopping" &&
    event.type !== "node-receipt-recorded" &&
    event.type !== "campaign-completed"
  ) {
    fail("A stopping campaign only accepts terminal-node receipts and campaign completion");
  }
  if (
    current.expectedRepair !== undefined &&
    event.type !== "experiment-started"
  ) {
    fail("A committed runtime repair must lead to its exact repaired attempt");
  }
  if (
    current.expectedNextExperimentId !== undefined &&
    event.type !== "experiment-started"
  ) {
    fail("A committed next experiment cannot be replaced by another decision");
  }
  if (
    current.expectedRecompiledExperiment !== undefined &&
    event.type !== "experiment-started"
  ) {
    fail("A hypothesis recompile must lead to a new experiment identity");
  }

  const base = {
    ...current,
    revision: current.revision + 1,
    lastEventId: event.eventId
  } satisfies CampaignProjection;

  switch (event.type) {
    case "experiment-started": {
      if (current.profile.kind !== "iterative-campaign") {
        fail("Only an iterative-campaign may start research experiments");
      }
      assertExperimentExecutionCapacity(current, "Starting an experiment");
      const active =
        current.currentExperimentId === undefined
          ? undefined
          : current.experiments[current.currentExperimentId];
      if (active !== undefined && active.receipt === undefined) {
        fail(`Experiment ${active.experimentId} is still active`);
      }

      const existing = current.experiments[event.experimentId];
      if (current.expectedRepair !== undefined) {
        const expected = current.expectedRepair;
        if (
          event.experimentId !== expected.experimentId ||
          event.attemptId !== expected.nextAttemptId
        ) {
          fail(
            `Expected repaired attempt ${expected.experimentId}/${expected.nextAttemptId}`
          );
        }
        if (existing?.receipt === undefined) {
          fail(`Repair target ${event.experimentId} is not a committed experiment`);
        }
        if (
          existing.attemptReceipts.length + 1 >
          current.profile.budgets.maxAttemptsPerExperiment
        ) {
          fail(
            `Experiment ${event.experimentId} exceeds maxAttemptsPerExperiment=${current.profile.budgets.maxAttemptsPerExperiment}`
          );
        }
        if (
          existing.attemptReceipts.some(
            (receipt) => receipt.attemptId === event.attemptId
          )
        ) {
          fail(`Experiment attempt identity ${event.attemptId} has already been used`);
        }
        if (
          event.experimentNumber !== existing.experimentNumber ||
          event.planDigest !== existing.planDigest ||
          event.evaluatorDigest !== existing.evaluatorDigest ||
          event.baselineExperimentId !== existing.baselineExperimentId
        ) {
          throw new ReceiptIdentityError(
            `Repair attempt ${event.attemptId} changed frozen experiment identity`
          );
        }
        const {
          receipt: _previousReceipt,
          ...previousWithoutCurrentReceipt
        } = existing;
        const {
          expectedRepair: _expectedRepair,
          ...withoutRepairExpectation
        } = base;
        return {
          ...withoutRepairExpectation,
          status: "running",
          currentExperimentId: event.experimentId,
          experiments: {
            ...current.experiments,
            [event.experimentId]: {
              ...previousWithoutCurrentReceipt,
              attemptId: event.attemptId,
              environmentDigest: event.environmentDigest,
              nodeReceiptIds: []
            }
          }
        };
      }

      if (existing !== undefined) {
        fail(`Experiment identity ${event.experimentId} is immutable and already exists`);
      }
      if (
        Object.keys(current.experiments).length > 0 &&
        current.expectedNextExperimentId === undefined &&
        current.expectedRecompiledExperiment === undefined
      ) {
        fail("A later experiment requires a committed decision or hypothesis recompile");
      }
      if (
        current.expectedNextExperimentId !== undefined &&
        current.expectedNextExperimentId !== event.experimentId
      ) {
        fail(
          `Expected next experiment ${current.expectedNextExperimentId}, received ${event.experimentId}`
        );
      }
      if (
        current.expectedNextPlanDigest !== undefined &&
        current.expectedNextPlanDigest !== event.planDigest
      ) {
        throw new ReceiptIdentityError(
          `Experiment ${event.experimentId} does not use the committed next plan`
        );
      }
      if (
        current.expectedNextExperimentId !== undefined &&
        current.expectedNextBaselineExperimentId !== event.baselineExperimentId
      ) {
        throw new ReceiptIdentityError(
          `Experiment ${event.experimentId} does not use the committed baseline`
        );
      }
      if (
        current.expectedRecompiledExperiment !== undefined &&
        (current.expectedRecompiledExperiment.experimentId !==
          event.experimentId ||
          current.expectedRecompiledExperiment.planDigest !== event.planDigest ||
          event.baselineExperimentId !== undefined)
      ) {
        throw new ReceiptIdentityError(
          `Experiment ${event.experimentId} does not match the recompiled experiment identity and plan`
        );
      }
      const expectedNumber = Object.keys(current.experiments).length + 1;
      if (event.experimentNumber !== expectedNumber) {
        fail(
          `Experiment numbers must be dense: expected ${expectedNumber}, received ${event.experimentNumber}`
        );
      }
      if (expectedNumber > current.profile.budgets.maxExperiments) {
        fail(
          `Campaign exceeds maxExperiments=${current.profile.budgets.maxExperiments}`
        );
      }
      if (
        event.baselineExperimentId !== undefined &&
        current.experiments[event.baselineExperimentId]?.receipt === undefined
      ) {
        fail(`Baseline ${event.baselineExperimentId} is not a committed experiment`);
      }
      const experiment: ExperimentProjection = {
        experimentId: event.experimentId,
        experimentNumber: event.experimentNumber,
        frameVersion: current.frameVersion,
        hypothesisVersion: current.hypothesisVersion,
        attemptId: event.attemptId,
        planDigest: event.planDigest,
        environmentDigest: event.environmentDigest,
        evaluatorDigest: event.evaluatorDigest,
        ...(event.baselineExperimentId === undefined
          ? {}
          : { baselineExperimentId: event.baselineExperimentId }),
        nodeReceiptIds: [],
        attemptReceipts: []
      };
      const {
        expectedNextExperimentId: _expectedNextExperimentId,
        expectedNextPlanDigest: _expectedNextPlanDigest,
        expectedNextBaselineExperimentId: _expectedNextBaselineExperimentId,
        expectedRecompiledExperiment: _expectedRecompiledExperiment,
        ...withoutExpectation
      } = base;
      return {
        ...withoutExpectation,
        status: "running",
        currentExperimentId: event.experimentId,
        experiments: {
          ...current.experiments,
          [event.experimentId]: experiment
        }
      };
    }

    case "node-receipt-recorded": {
      const receipt = event.receipt;
      assertReceiptIdentity(current, receipt);
      if (
        current.status === "stopping" &&
        !current.profile.terminalNodeIds.includes(receipt.nodeId)
      ) {
        fail(
          `A stopping campaign accepts receipts only for terminal nodes, not ${receipt.nodeId}`
        );
      }
      const contract = current.nodeContracts[receipt.nodeId];
      if (contract === undefined) {
        throw new ReceiptIdentityError(
          `Node receipt ${receipt.receiptId} names unknown compiled node ${receipt.nodeId}`
        );
      }
      if (!sameComponentRef(receipt.component, contract.component)) {
        throw new ReceiptIdentityError(
          `Node receipt ${receipt.receiptId} component does not match node ${receipt.nodeId}`
        );
      }
      if (receipt.attempt > contract.maxAttempts) {
        throw new ReceiptIdentityError(
          `Node receipt ${receipt.receiptId} attempt ${receipt.attempt} exceeds compiled maxAttempts=${contract.maxAttempts}`
        );
      }
      if (receipt.idempotencyKey !== contract.idempotencyKey) {
        throw new ReceiptIdentityError(
          `Node receipt ${receipt.receiptId} idempotency key does not match node ${receipt.nodeId}`
        );
      }
      if (current.nodeReceipts[receipt.receiptId] !== undefined) {
        fail(`Node receipt ${receipt.receiptId} has already been recorded`);
      }
      const priorNodeAttempts = Object.values(current.nodeReceipts)
        .filter((previous) =>
          receipt.experimentId === undefined
            ? previous.experimentId === undefined &&
              previous.runId === receipt.runId &&
              previous.nodeId === receipt.nodeId
            : previous.experimentId === receipt.experimentId &&
              previous.experimentAttemptId === receipt.experimentAttemptId &&
              previous.nodeId === receipt.nodeId
        )
        .sort((left, right) => left.attempt - right.attempt);
      if (
        priorNodeAttempts.some(
          (previous) => previous.attempt === receipt.attempt
        )
      ) {
        fail(
          `Node attempt ${receipt.nodeId}/${receipt.attempt} already has a receipt in this execution scope`
        );
      }
      const expectedNodeAttempt = priorNodeAttempts.length + 1;
      if (receipt.attempt !== expectedNodeAttempt) {
        fail(
          `Node ${receipt.nodeId} attempt must be dense: expected ${expectedNodeAttempt}, received ${receipt.attempt}`
        );
      }
      const priorNodeAttempt = priorNodeAttempts.at(-1);
      const firstNodeAttempt = priorNodeAttempts[0];
      if (
        firstNodeAttempt !== undefined &&
        receipt.inputDigest !== firstNodeAttempt.inputDigest
      ) {
        throw new ReceiptIdentityError(
          `Node ${receipt.nodeId} retry changed its frozen input digest`
        );
      }
      if (
        priorNodeAttempt !== undefined &&
        (priorNodeAttempt.status !== "failed" ||
          priorNodeAttempt.error?.retryable !== true)
      ) {
        fail(
          `Node ${receipt.nodeId} may retry only after a retryable failed receipt`
        );
      }
      if (
        current.profile.kind === "iterative-campaign" &&
        current.profile.budgets.maxTotalNodeExecutions !== undefined &&
        current.totalNodeExecutions + 1 >
          current.profile.budgets.maxTotalNodeExecutions
      ) {
        fail(
          `Campaign exceeds maxTotalNodeExecutions=${current.profile.budgets.maxTotalNodeExecutions}`
        );
      }
      let experiments = current.experiments;
      if (current.profile.kind === "iterative-campaign") {
        const isExperimentNode =
          receipt.nodeId === current.profile.experimentNodeId;
        const isExperimentScoped = receipt.experimentId !== undefined;
        if (isExperimentNode !== isExperimentScoped) {
          throw new ReceiptIdentityError(
            `Node receipt ${receipt.receiptId} must be experiment-scoped exactly when it targets ${current.profile.experimentNodeId}`
          );
        }
      }
      const activeExperiment =
        current.currentExperimentId === undefined
          ? undefined
          : current.experiments[current.currentExperimentId];
      if (
        activeExperiment !== undefined &&
        activeExperiment.receipt === undefined &&
        receipt.experimentId === undefined
      ) {
        fail(
          `Campaign node ${receipt.nodeId} cannot execute while experiment ${activeExperiment.experimentId} is active`
        );
      }
      if (receipt.experimentId !== undefined) {
        const experiment = current.experiments[receipt.experimentId];
        if (experiment === undefined || experiment.receipt !== undefined) {
          fail(`Node receipt ${receipt.receiptId} has no active experiment`);
        }
        if (receipt.experimentAttemptId !== experiment.attemptId) {
          throw new ReceiptIdentityError(
            `Node receipt ${receipt.receiptId} belongs to experiment attempt ${receipt.experimentAttemptId ?? "missing"}, expected ${experiment.attemptId}`
          );
        }
        experiments = {
          ...current.experiments,
          [receipt.experimentId]: {
            ...experiment,
            nodeReceiptIds: [...experiment.nodeReceiptIds, receipt.receiptId]
          }
        };
      }
      return {
        ...base,
        totalNodeExecutions: current.totalNodeExecutions + 1,
        experiments,
        nodeReceipts: {
          ...current.nodeReceipts,
          [receipt.receiptId]: receipt
        }
      };
    }

    case "experiment-completed": {
      const receipt = event.receipt;
      assertReceiptIdentity(current, receipt);
      if (
        Object.values(current.experiments).some((candidate) =>
          candidate.attemptReceipts.some(
            (previous) => previous.receiptId === receipt.receiptId
          )
        )
      ) {
        fail(`Experiment receipt ${receipt.receiptId} has already been recorded`);
      }
      const experiment = current.experiments[receipt.experimentId];
      if (experiment === undefined || experiment.receipt !== undefined) {
        fail(`Experiment ${receipt.experimentId} is not an active experiment`);
      }
      if (
        receipt.experimentNumber !== experiment.experimentNumber ||
        receipt.attemptId !== experiment.attemptId ||
        receipt.planDigest !== experiment.planDigest ||
        receipt.environmentDigest !== experiment.environmentDigest ||
        receipt.evaluatorDigest !== experiment.evaluatorDigest ||
        receipt.frameVersion !== experiment.frameVersion ||
        receipt.hypothesisVersion !== experiment.hypothesisVersion ||
        receipt.baselineExperimentId !== experiment.baselineExperimentId
      ) {
        throw new ReceiptIdentityError(
          `Experiment receipt ${receipt.receiptId} does not match its frozen start identity`
        );
      }
      const expectedNodeReceipts = [...experiment.nodeReceiptIds].sort();
      const actualNodeReceipts = [...receipt.nodeReceiptIds].sort();
      if (
        expectedNodeReceipts.length !== actualNodeReceipts.length ||
        expectedNodeReceipts.some((id, index) => id !== actualNodeReceipts[index])
      ) {
        throw new ReceiptIdentityError(
          `Experiment receipt ${receipt.receiptId} does not close the recorded node receipt set`
        );
      }
      if (
        receipt.status === "succeeded" &&
        Array.from(
          [...receipt.nodeReceiptIds]
            .map(
              (receiptId) => current.nodeReceipts[receiptId] as NodeReceiptV1
            )
            .reduce((latestByNode, nodeReceipt) => {
              const latest = latestByNode.get(nodeReceipt.nodeId);
              if (
                latest === undefined ||
                nodeReceipt.attempt > latest.attempt
              ) {
                latestByNode.set(nodeReceipt.nodeId, nodeReceipt);
              }
              return latestByNode;
            }, new Map<string, NodeReceiptV1>())
            .values()
        ).some(
            (latest) =>
              latest.status !== "succeeded" && latest.status !== "skipped"
          )
      ) {
        fail(
          `Succeeded experiment receipt ${receipt.receiptId} does not end every node on a successful or skipped attempt`
        );
      }
      return {
        ...base,
        experiments: {
          ...current.experiments,
          [receipt.experimentId]: {
            ...experiment,
            receipt,
            attemptReceipts: [...experiment.attemptReceipts, receipt]
          }
        }
      };
    }

    case "frame-assessed": {
      const assessment = event.assessment;
      if (current.profile.kind !== "iterative-campaign") {
        fail("Only an iterative-campaign may record FrameAssessment events");
      }
      assertCampaignIdentity(current, assessment, `Assessment ${assessment.assessmentId}`);
      const activeExperiment =
        current.currentExperimentId === undefined
          ? undefined
          : current.experiments[current.currentExperimentId];
      if (
        assessment.experimentId === undefined &&
        activeExperiment !== undefined &&
        activeExperiment.receipt === undefined
      ) {
        fail(
          `Campaign-level assessment ${assessment.assessmentId} cannot bypass active experiment ${activeExperiment.experimentId}`
        );
      }
      const experiment = assertCurrentExperimentComplete(
        current,
        assessment.experimentId
      );
      if (assessment.frameVersion !== current.frameVersion) {
        throw new ReceiptIdentityError(
          `Assessment ${assessment.assessmentId} targets stale frame ${assessment.frameVersion}`
        );
      }
      if (assessment.policyDigest !== current.frameCheckPolicyDigest) {
        throw new ReceiptIdentityError(
          `Assessment ${assessment.assessmentId} does not match the frozen frame-check policy`
        );
      }
      if (
        experiment !== undefined &&
        assessment.experimentId !== current.currentExperimentId
      ) {
        fail(
          `Assessment ${assessment.assessmentId} must target the current experiment`
        );
      }
      if (
        experiment !== undefined &&
        assessment.evaluatorDigest !== experiment.evaluatorDigest
      ) {
        throw new ReceiptIdentityError(
          `Assessment ${assessment.assessmentId} evaluator differs from the frozen experiment evaluator`
        );
      }
      if (experiment === undefined) {
        if (assessment.verdict === "frame-valid") {
          fail("A campaign-level assessment without an experiment cannot declare frame-valid");
        }
      }
      if (current.frameAssessments[assessment.assessmentId] !== undefined) {
        fail(`Assessment ${assessment.assessmentId} has already been recorded`);
      }
      return {
        ...base,
        frameAssessments: {
          ...current.frameAssessments,
          [assessment.assessmentId]: assessment
        }
      };
    }

    case "decision-committed": {
      const receipt = event.receipt;
      if (current.profile.kind !== "iterative-campaign") {
        fail("Only an iterative-campaign may commit DecisionReceipt events");
      }
      assertCampaignIdentity(current, receipt, `Decision ${receipt.decisionId}`);
      if (receipt.policyDigest !== current.decisionPolicyDigest) {
        throw new ReceiptIdentityError(
          `Decision ${receipt.decisionId} does not match the frozen decision policy`
        );
      }
      if (
        current.decisions.some(
          (decision) => decision.decisionId === receipt.decisionId
        )
      ) {
        fail(`Decision ${receipt.decisionId} has already been recorded`);
      }
      const assessment = current.frameAssessments[receipt.assessmentId];
      if (assessment === undefined) {
        fail(`Decision ${receipt.decisionId} cites unknown assessment ${receipt.assessmentId}`);
      }
      if (
        !receipt.evidenceRefs.some(
          (evidence) => evidence.ref === `assessment:${receipt.assessmentId}`
        )
      ) {
        fail(
          `Decision ${receipt.decisionId} evidence must reference assessment:${receipt.assessmentId}`
        );
      }
      if (receipt.fromExperimentId !== assessment.experimentId) {
        throw new ReceiptIdentityError(
          `Decision ${receipt.decisionId} does not bind the assessment experiment`
        );
      }
      if (assessment.frameVersion !== current.frameVersion) {
        fail(`Decision ${receipt.decisionId} cites an assessment from a stale frame`);
      }
      if (
        current.decisions.some(
          (decision) => decision.assessmentId === receipt.assessmentId
        )
      ) {
        fail(`Assessment ${receipt.assessmentId} already has a committed decision`);
      }
      const activeExperiment =
        current.currentExperimentId === undefined
          ? undefined
          : current.experiments[current.currentExperimentId];
      if (activeExperiment !== undefined && activeExperiment.receipt === undefined) {
        fail(
          `Decision ${receipt.decisionId} cannot bypass active experiment ${activeExperiment.experimentId}`
        );
      }
      const assessedExperiment = assertCurrentExperimentComplete(
        current,
        receipt.fromExperimentId
      );
      if (
        ["replicate", "repair-runtime", "run-next-experiment"].includes(
          receipt.decision
        ) &&
        assessedExperiment === undefined
      ) {
        fail(`${receipt.decision} requires a committed current experiment`);
      }
      if (
        receipt.decision === "recompile-hypothesis" &&
        !["recompile-required", "human-review-required"].includes(
          assessment.verdict
        )
      ) {
        fail("Recompile requires a recompile-required or human-review-required assessment");
      }
      if (
        ["replicate", "repair-runtime", "run-next-experiment"].includes(
          receipt.decision
        ) &&
        assessment.verdict !== "frame-valid"
      ) {
        fail(`${receipt.decision} requires a frame-valid assessment`);
      }
      if (
        [
          "replicate",
          "repair-runtime",
          "run-next-experiment",
          "recompile-hypothesis"
        ].includes(receipt.decision)
      ) {
        assertExperimentExecutionCapacity(current, receipt.decision);
      }

      const decisions = [...current.decisions, receipt];
      if (receipt.decision === "wait") {
        return { ...base, status: "waiting", decisions };
      }
      if (receipt.decision === "stop") {
        if (
          assessedExperiment === undefined &&
          ["goal-achieved", "budget-exhausted", "no-progress"].includes(
            receipt.stopReason
          )
        ) {
          fail(`${receipt.stopReason} requires committed experiment evidence`);
        }
        return { ...base, status: "stopping", decisions };
      }
      if (receipt.decision === "recompile-hypothesis") {
        if (
          receipt.nextFrameVersion <= current.frameVersion ||
          receipt.nextHypothesisVersion <= current.hypothesisVersion
        ) {
          fail("Recompile must advance both frame and hypothesis versions");
        }
        if (
          Object.keys(current.experiments).length >=
          current.profile.budgets.maxExperiments
        ) {
          fail(
            `recompile-hypothesis exceeds maxExperiments=${current.profile.budgets.maxExperiments}`
          );
        }
        if (current.experiments[receipt.nextExperimentId] !== undefined) {
          fail(
            `Recompiled experiment identity ${receipt.nextExperimentId} already exists`
          );
        }
        return {
          ...base,
          status: "running",
          frameVersion: receipt.nextFrameVersion,
          hypothesisVersion: receipt.nextHypothesisVersion,
          expectedRecompiledExperiment: {
            experimentId: receipt.nextExperimentId,
            planDigest: receipt.planDigest
          },
          decisions
        };
      }
      if (receipt.decision === "repair-runtime") {
        const experiment = current.experiments[receipt.experimentId];
        if (
          receipt.fromExperimentId !== receipt.experimentId ||
          receipt.experimentId !== current.currentExperimentId ||
          receipt.nextAttemptId === experiment?.attemptId
        ) {
          fail("Runtime repair must retain the experiment and advance the attempt identity");
        }
        if (
          experiment !== undefined &&
          experiment.attemptReceipts.length >=
            current.profile.budgets.maxAttemptsPerExperiment
        ) {
          fail(
            `Runtime repair exceeds maxAttemptsPerExperiment=${current.profile.budgets.maxAttemptsPerExperiment}`
          );
        }
        if (
          experiment?.attemptReceipts.some(
            (attempt) => attempt.attemptId === receipt.nextAttemptId
          )
        ) {
          fail(
            `Runtime repair attempt identity ${receipt.nextAttemptId} has already been used`
          );
        }
        return {
          ...base,
          status: "running",
          expectedRepair: {
            experimentId: receipt.experimentId,
            nextAttemptId: receipt.nextAttemptId
          },
          decisions
        };
      }
      if (
        receipt.decision === "replicate" &&
        receipt.sourceExperimentId !== receipt.fromExperimentId
      ) {
        fail("Replication must cite the assessed experiment as its source");
      }
      const nextExperimentId = receipt.nextExperimentId;
      if (
        Object.keys(current.experiments).length >=
        current.profile.budgets.maxExperiments
      ) {
        fail(
          `${receipt.decision} exceeds maxExperiments=${current.profile.budgets.maxExperiments}`
        );
      }
      if (current.experiments[nextExperimentId] !== undefined) {
        fail(`Next experiment identity ${nextExperimentId} already exists`);
      }
      let nextPlanDigest: string;
      if (receipt.decision === "run-next-experiment") {
        nextPlanDigest = receipt.planDigest;
      } else {
        const source = current.experiments[receipt.sourceExperimentId];
        if (source === undefined) {
          fail(`Replication source ${receipt.sourceExperimentId} does not exist`);
        }
        nextPlanDigest = source.planDigest;
      }
      return {
        ...base,
        status: "running",
        expectedNextExperimentId: nextExperimentId,
        expectedNextPlanDigest: nextPlanDigest,
        ...(receipt.fromExperimentId === undefined
          ? {}
          : { expectedNextBaselineExperimentId: receipt.fromExperimentId }),
        decisions
      };
    }

    case "campaign-completed": {
      const lastDecision = current.decisions.at(-1);
      if (lastDecision?.decision !== "stop") {
        fail("Campaign completion requires a committed stop DecisionReceipt");
      }
      if (lastDecision.stopReason !== event.reason) {
        fail("Campaign terminal reason must match the committed stop decision");
      }
      const expectedStatus = terminalStatusFor(event.reason);
      if (event.status !== expectedStatus) {
        fail(
          `Terminal reason ${event.reason} requires status ${expectedStatus}, received ${event.status}`
        );
      }
      const active =
        current.currentExperimentId === undefined
          ? undefined
          : current.experiments[current.currentExperimentId];
      if (active !== undefined && active.receipt === undefined) {
        fail(`Active experiment ${active.experimentId} is not committed`);
      }
      return {
        ...base,
        status: event.status,
        terminal: { status: event.status, reason: event.reason }
      };
    }
  }
}
