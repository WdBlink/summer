import { randomUUID } from "node:crypto";

import type { ComponentRegistry } from "@summer/components";
import { compileWorkflow } from "@summer/compiler";
import {
  sha256Canonical,
  parseCompiledWorkflowV1,
  type CampaignEventV1,
  type CompiledWorkflowV1,
  type WorkflowSpecV1
} from "@summer/protocol";

import {
  CampaignNotFoundError,
  InvalidCampaignTransitionError,
  ReceiptIdentityError
} from "./errors.js";
import {
  InMemoryCampaignLedger,
  type AppendResult,
  type CampaignLedger,
  type CampaignRecord
} from "./ledger.js";

export interface StartCampaignInput {
  readonly campaignId: string;
  readonly eventId?: string;
  readonly occurredAt?: string;
  readonly frameVersion?: number;
  readonly hypothesisVersion?: number;
}

export type CampaignFollowupEventV1 = Exclude<
  CampaignEventV1,
  { type: "campaign-started" }
>;

export class SummerCore {
  constructor(
    public readonly registry: ComponentRegistry,
    public readonly ledger: CampaignLedger = new InMemoryCampaignLedger()
  ) {}

  compile(source: WorkflowSpecV1): CompiledWorkflowV1 {
    return compileWorkflow(source, this.registry);
  }

  start(
    workflow: CompiledWorkflowV1,
    input: StartCampaignInput
  ): AppendResult {
    const supplied = parseCompiledWorkflowV1(workflow);
    const compiled = compileWorkflow(
      {
        schemaVersion: "summer.workflow/v1",
        workflowId: supplied.workflowId,
        revision: supplied.revision,
        profile: supplied.profile,
        entryNodeId: supplied.entryNodeId,
        nodes: supplied.nodes.map(({ resolvedComponent: _resolved, ...node }) => node),
        edges: supplied.edges,
        ...(supplied.metadata === undefined ? {} : { metadata: supplied.metadata })
      },
      this.registry
    );
    if (compiled.compiledDigest !== supplied.compiledDigest) {
      throw new ReceiptIdentityError(
        `Compiled workflow ${supplied.workflowId}@${supplied.revision} does not match the active registry and compiler`
      );
    }
    if (compiled.profile.kind !== "iterative-campaign") {
      throw new InvalidCampaignTransitionError(
        "SummerCore.start() owns iterative campaigns only; execute bounded-flow workflows through a runtime adapter"
      );
    }
    const frameCheckPolicyDigest = sha256Canonical(
      requiredCompiledNode(
        compiled,
        compiled.profile.frameCheckNodeId
      ).resolvedComponent
    );
    const decisionPolicyDigest = sha256Canonical(
      requiredCompiledNode(
        compiled,
        compiled.profile.decisionNodeId
      ).resolvedComponent
    );
    const event: CampaignEventV1 = {
      schemaVersion: "summer.campaign-event/v1",
      type: "campaign-started",
      eventId: input.eventId ?? randomUUID(),
      campaignId: input.campaignId,
      sequence: 0,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      workflowId: compiled.workflowId,
      workflowRevision: compiled.revision,
      compiledWorkflowDigest: compiled.compiledDigest,
      registryDigest: compiled.registryDigest,
      profile: compiled.profile,
      nodeContracts: compiled.nodes.map((node) => ({
        nodeId: node.id,
        component: node.component,
        maxAttempts: node.maxAttempts,
        ...(node.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: node.idempotencyKey })
      })),
      frameCheckPolicyDigest,
      decisionPolicyDigest,
      frameVersion: input.frameVersion ?? 1,
      hypothesisVersion: input.hypothesisVersion ?? 1
    };
    return this.ledger.append(input.campaignId, 0, [event]);
  }

  status(campaignId: string): CampaignRecord {
    const record = this.ledger.read(campaignId);
    if (record === null) throw new CampaignNotFoundError(campaignId);
    return record;
  }

  append(
    campaignId: string,
    expectedRevision: number,
    events: readonly CampaignFollowupEventV1[]
  ): AppendResult {
    if (
      (events as readonly CampaignEventV1[]).some(
        (event) => event.type === "campaign-started"
      )
    ) {
      throw new InvalidCampaignTransitionError(
        "campaign-started may only be created by SummerCore.start() from a verified compiled workflow"
      );
    }
    return this.ledger.append(campaignId, expectedRevision, events);
  }

  inspect(workflow: CompiledWorkflowV1): {
    workflowId: string;
    revision: number;
    profile: string;
    compiledDigest: string;
    registryDigest: string;
    nodes: number;
    edges: number;
    terminalNodeIds: readonly string[];
  } {
    return {
      workflowId: workflow.workflowId,
      revision: workflow.revision,
      profile: workflow.profile.kind,
      compiledDigest: workflow.compiledDigest,
      registryDigest: workflow.registryDigest,
      nodes: workflow.nodes.length,
      edges: workflow.edges.length,
      terminalNodeIds: workflow.profile.terminalNodeIds
    };
  }

  semanticDigest(value: unknown): string {
    return sha256Canonical(value);
  }
}

function requiredCompiledNode(
  workflow: CompiledWorkflowV1,
  nodeId: string
): CompiledWorkflowV1["nodes"][number] {
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new Error(
      `Compiled workflow ${workflow.workflowId}@${workflow.revision} is missing policy node ${nodeId}`
    );
  }
  return node;
}
