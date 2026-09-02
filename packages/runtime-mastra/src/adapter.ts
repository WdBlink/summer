import type { ComponentRegistry } from "@summer/components";
import {
  createStep,
  createWorkflow,
  type AnyWorkflow,
  type Step
} from "@mastra/core/workflows";
import {
  JsonValueSchema,
  canonicalJson,
  parseCompiledWorkflowV1,
  sha256Canonical,
  type CompiledWorkflowNodeV1,
  type CompiledWorkflowV1,
  type ComponentDescriptorV1,
  type ExactComponentRef,
  type ExactSchemaRef,
  type JsonValue,
  type SchemaDescriptorV1,
  type WorkflowEdgeV1
} from "@summer/protocol";
import { z } from "zod";

import {
  MastraAdapterError,
  MastraComponentTimeoutError,
  type MastraAdapterIssue
} from "./errors.js";
import {
  SummerMastraEnvelopeV1Schema,
  SummerMastraRunInputV1Schema,
  createInitialEnvelope,
  withNodeOutput,
  type SummerMastraEnvelopeV1
} from "./envelope.js";

export const MASTRA_ADAPTER_PLAN_SCHEMA_VERSION =
  "summer.mastra-adapter-plan/v1" as const;

/** Public, serializable boundary for the deliberately small v0 translation. */
export const MASTRA_V0_SUPPORT_MATRIX = Object.freeze({
  profiles: Object.freeze(["bounded-flow"] as const),
  executionShapes: Object.freeze(["linear", "single-fork-join"] as const),
  routeEdgeCondition: "node-succeeded" as const,
  fanoutEdgeCondition: "always" as const,
  joins: Object.freeze(["all"] as const),
  maxStructuredFanouts: 1 as const,
  campaignScheduling: false as const,
  humanGateSuspension: false as const,
  nonIdempotentWrites: false as const
});

export interface MastraLinearPlanV1 {
  readonly schemaVersion: typeof MASTRA_ADAPTER_PLAN_SCHEMA_VERSION;
  readonly executionShape: "linear";
  readonly workflowId: string;
  readonly revision: number;
  readonly compiledWorkflowDigest: string;
  readonly registryDigest: string;
  readonly nodeOrder: readonly string[];
}

export interface MastraSingleForkJoinPlanV1 {
  readonly schemaVersion: typeof MASTRA_ADAPTER_PLAN_SCHEMA_VERSION;
  readonly executionShape: "single-fork-join";
  readonly workflowId: string;
  readonly revision: number;
  readonly compiledWorkflowDigest: string;
  readonly registryDigest: string;
  readonly prefixNodeIds: readonly string[];
  readonly forkNodeId: string;
  readonly branches: readonly (readonly string[])[];
  readonly joinNodeId: string;
  readonly suffixNodeIds: readonly string[];
  readonly nodeOrder: readonly string[];
}

export type MastraAdapterPlanV1 =
  | MastraLinearPlanV1
  | MastraSingleForkJoinPlanV1;

export interface MastraWorkflowBinding {
  /** Mastra is confined to this adapter package; core and protocol never import it. */
  readonly workflow: AnyWorkflow;
  /** Serializable explanation of the exact subset translated by this adapter. */
  readonly plan: MastraAdapterPlanV1;
}

type ErasedMastraStep = Step<
  string,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;

interface GraphIndex {
  readonly nodes: ReadonlyMap<string, CompiledWorkflowNodeV1>;
  readonly incoming: ReadonlyMap<string, readonly WorkflowEdgeV1[]>;
  readonly outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>;
}

/**
 * Plan the lossless v0 translation without creating Mastra runtime objects.
 *
 * Supported graphs are bounded, success-only linear graphs and one structured
 * fork/join with linear branches. Campaign policy edges remain owned by Summer
 * core and are deliberately not interpreted as Mastra loops.
 */
export function planMastraWorkflow(input: unknown): MastraAdapterPlanV1 {
  const workflow = parseCompiled(input);
  const issues: MastraAdapterIssue[] = [];

  if (workflow.profile.kind !== "bounded-flow") {
    issues.push({
      code: "UNSUPPORTED_PROFILE",
      message:
        "iterative-campaign is owned by the Summer campaign ledger and decision policy; the Mastra v0 adapter only runs bounded-flow children",
      path: "profile.kind"
    });
  }

  const graph = indexGraph(workflow);
  for (const node of workflow.nodes) {
    const incomingCount = graph.incoming.get(node.id)?.length ?? 0;
    if (incomingCount > 1 && node.join !== "all") {
      issues.push({
        code: "UNSUPPORTED_JOIN_SEMANTICS",
        message: `multi-input node '${node.id}' must declare join 'all'; received '${
          node.join ?? "unspecified"
        }'`,
        path: `nodes.${node.id}.join`
      });
    } else if (node.join === "any") {
      issues.push({
        code: "UNSUPPORTED_JOIN_SEMANTICS",
        message: `node '${node.id}' uses join 'any', which v0 cannot translate without changing winner/cancellation semantics`,
        path: `nodes.${node.id}.join`
      });
    }
    if (node.dispatch === "fanout" && !node.resolvedComponent.supportsFanout) {
      issues.push({
        code: "UNSUPPORTED_GRAPH_SHAPE",
        message: `fanout node '${node.id}' resolves to a component that does not support fanout`,
        path: `nodes.${node.id}.resolvedComponent.supportsFanout`
      });
    }
  }
  const fanoutNodes = workflow.nodes.filter((node) => node.dispatch === "fanout");
  if (fanoutNodes.length > 1) {
    issues.push({
      code: "UNSUPPORTED_MULTIPLE_FANOUTS",
      message: `v0 supports at most one structured fork/join, found ${fanoutNodes.length}`,
      path: "nodes"
    });
  }

  const fanoutNodeId = fanoutNodes[0]?.id;
  for (const edge of workflow.edges) {
    const expected = edge.from === fanoutNodeId ? "always" : "node-succeeded";
    if (edge.condition.kind !== expected) {
      issues.push({
        code: "UNSUPPORTED_EDGE_CONDITION",
        message: `edge '${edge.id}' uses '${edge.condition.kind}'; v0 requires '${expected}' on this edge`,
        path: `edges.${edge.id}.condition`
      });
    }
  }

  if (issues.length > 0) throw new MastraAdapterError(issues);

  if (fanoutNodeId === undefined) {
    const nodeOrder = decomposeLinear(workflow, graph);
    return Object.freeze({
      schemaVersion: MASTRA_ADAPTER_PLAN_SCHEMA_VERSION,
      executionShape: "linear",
      workflowId: workflow.workflowId,
      revision: workflow.revision,
      compiledWorkflowDigest: workflow.compiledDigest,
      registryDigest: workflow.registryDigest,
      nodeOrder: Object.freeze(nodeOrder)
    });
  }

  return decomposeSingleForkJoin(workflow, graph, fanoutNodeId);
}

/** Create executable Mastra steps/workflows after verifying runtime bindings. */
export function createMastraWorkflow(
  input: unknown,
  registry: ComponentRegistry
): MastraWorkflowBinding {
  const workflow = parseCompiled(input);
  const plan = planMastraWorkflow(workflow);
  verifyRuntimeBindings(workflow, registry);

  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const stepByNodeId = new Map<string, ErasedMastraStep>();
  for (const node of workflow.nodes) {
    stepByNodeId.set(node.id, createComponentStep(workflow, node, registry));
  }

  const initStep = createStep({
    id: internalId(workflow, "init"),
    inputSchema: SummerMastraRunInputV1Schema,
    outputSchema: SummerMastraEnvelopeV1Schema,
    metadata: runtimeMetadata(workflow, "init"),
    execute: async ({ inputData }) => createInitialEnvelope(inputData)
  });

  let builder = createWorkflow({
    id: workflow.workflowId,
    description: `Summer bounded workflow ${workflow.workflowId}@${workflow.revision}`,
    inputSchema: SummerMastraRunInputV1Schema,
    outputSchema: SummerMastraEnvelopeV1Schema,
    metadata: runtimeMetadata(workflow, "workflow")
  }) as AnyWorkflow;
  builder = then(builder, initStep);

  if (plan.executionShape === "linear") {
    for (const nodeId of plan.nodeOrder) {
      builder = then(builder, requiredStep(stepByNodeId, nodeId));
    }
  } else {
    for (const nodeId of plan.prefixNodeIds) {
      builder = then(builder, requiredStep(stepByNodeId, nodeId));
    }

    const branchWorkflows = plan.branches.map((branch, index) => {
      let branchBuilder = createWorkflow({
        id: internalId(workflow, `branch-${index + 1}`),
        inputSchema: SummerMastraEnvelopeV1Schema,
        outputSchema: SummerMastraEnvelopeV1Schema,
        metadata: runtimeMetadata(workflow, `branch-${index + 1}`)
      }) as AnyWorkflow;
      for (const nodeId of branch) {
        branchBuilder = then(branchBuilder, requiredStep(stepByNodeId, nodeId));
      }
      return branchBuilder.commit();
    });

    builder = parallel(builder, branchWorkflows);
    builder = then(
      builder,
      createBranchMergeStep(workflow, plan, branchWorkflows)
    );
    for (const nodeId of plan.suffixNodeIds) {
      builder = then(builder, requiredStep(stepByNodeId, nodeId));
    }
  }

  // All IDs in the plan were resolved above; this also guards future plan edits.
  for (const nodeId of plan.nodeOrder) requiredNode(nodeById, nodeId);

  return Object.freeze({ workflow: builder.commit(), plan });
}

function parseCompiled(input: unknown): CompiledWorkflowV1 {
  try {
    return parseCompiledWorkflowV1(input);
  } catch (error) {
    throw new MastraAdapterError([
      {
        code: "INVALID_COMPILED_WORKFLOW",
        message:
          error instanceof Error
            ? error.message
            : "input did not match summer.compiled-workflow/v1"
      }
    ]);
  }
}

function indexGraph(workflow: CompiledWorkflowV1): GraphIndex {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, WorkflowEdgeV1[]>();
  const outgoing = new Map<string, WorkflowEdgeV1[]>();
  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of workflow.edges) {
    incoming.get(edge.to)?.push(edge);
    outgoing.get(edge.from)?.push(edge);
  }
  for (const edges of incoming.values()) edges.sort(byEdgeTarget);
  for (const edges of outgoing.values()) edges.sort(byEdgeTarget);
  return { nodes, incoming, outgoing };
}

function decomposeLinear(
  workflow: CompiledWorkflowV1,
  graph: GraphIndex
): string[] {
  if (workflow.profile.terminalNodeIds.length !== 1) {
    unsupportedShape(
      `linear translation requires exactly one terminal, found ${workflow.profile.terminalNodeIds.length}`
    );
  }
  const terminalId = workflow.profile.terminalNodeIds[0] as string;
  const order: string[] = [];
  const seen = new Set<string>();
  let current = workflow.entryNodeId;

  while (true) {
    if (!graph.nodes.has(current) || seen.has(current)) {
      unsupportedShape(`linear traversal stopped at invalid or repeated node '${current}'`);
    }
    seen.add(current);
    order.push(current);
    if (current === terminalId) {
      if ((graph.outgoing.get(current) ?? []).length !== 0) {
        unsupportedShape(`terminal node '${current}' must not have outgoing edges`);
      }
      break;
    }
    const edges = graph.outgoing.get(current) ?? [];
    if (edges.length !== 1) {
      unsupportedShape(`linear node '${current}' must have exactly one outgoing edge`);
    }
    const next = (edges[0] as WorkflowEdgeV1).to;
    if ((graph.incoming.get(next) ?? []).length !== 1) {
      unsupportedShape(`linear node '${next}' must have exactly one incoming edge`);
    }
    current = next;
  }

  if (seen.size !== workflow.nodes.length) {
    unsupportedShape("linear traversal does not cover every compiled node");
  }
  return order;
}

function decomposeSingleForkJoin(
  workflow: CompiledWorkflowV1,
  graph: GraphIndex,
  forkNodeId: string
): MastraSingleForkJoinPlanV1 {
  if (workflow.profile.terminalNodeIds.length !== 1) {
    unsupportedShape("single-fork-join translation requires exactly one terminal");
  }

  const prefix: string[] = [];
  const prefixSeen = new Set<string>();
  let current = workflow.entryNodeId;
  while (current !== forkNodeId) {
    if (!graph.nodes.has(current) || prefixSeen.has(current)) {
      unsupportedShape(`fork '${forkNodeId}' is not on a valid entry path`);
    }
    prefixSeen.add(current);
    prefix.push(current);
    const edges = graph.outgoing.get(current) ?? [];
    if (edges.length !== 1) {
      unsupportedShape(`prefix node '${current}' must have exactly one outgoing edge`);
    }
    const next = (edges[0] as WorkflowEdgeV1).to;
    if ((graph.incoming.get(next) ?? []).length !== 1) {
      unsupportedShape(`prefix node '${next}' must have exactly one incoming edge`);
    }
    current = next;
  }
  prefix.push(forkNodeId);

  const forkEdges = graph.outgoing.get(forkNodeId) ?? [];
  if (forkEdges.length < 2) {
    unsupportedShape(`fanout node '${forkNodeId}' must have at least two branches`);
  }
  const starts = forkEdges.map((edge) => edge.to).sort((a, b) => a.localeCompare(b));
  const joinNodeId = findStructuredJoin(starts, graph);
  const branchSeen = new Set<string>();
  const branches = starts.map((start) => {
    const branch: string[] = [];
    let nodeId = start;
    while (nodeId !== joinNodeId) {
      if (!graph.nodes.has(nodeId) || prefixSeen.has(nodeId) || branchSeen.has(nodeId)) {
        unsupportedShape(`branch traversal overlaps or repeats node '${nodeId}'`);
      }
      if ((graph.incoming.get(nodeId) ?? []).length !== 1) {
        unsupportedShape(`branch node '${nodeId}' must have exactly one incoming edge`);
      }
      branchSeen.add(nodeId);
      branch.push(nodeId);
      const edges = graph.outgoing.get(nodeId) ?? [];
      if (edges.length !== 1) {
        unsupportedShape(`branch node '${nodeId}' must have exactly one outgoing edge`);
      }
      nodeId = (edges[0] as WorkflowEdgeV1).to;
    }
    if (branch.length === 0) {
      unsupportedShape("every fanout branch must execute at least one node before joining");
    }
    return Object.freeze(branch);
  });

  const joinIncoming = graph.incoming.get(joinNodeId) ?? [];
  if (joinIncoming.length !== branches.length) {
    unsupportedShape(
      `join node '${joinNodeId}' must receive exactly one edge from each branch`
    );
  }

  const suffix: string[] = [];
  const suffixSeen = new Set<string>();
  const terminalId = workflow.profile.terminalNodeIds[0] as string;
  current = joinNodeId;
  while (true) {
    if (!graph.nodes.has(current) || suffixSeen.has(current)) {
      unsupportedShape(`suffix traversal stopped at invalid or repeated node '${current}'`);
    }
    suffixSeen.add(current);
    suffix.push(current);
    if (current === terminalId) {
      if ((graph.outgoing.get(current) ?? []).length !== 0) {
        unsupportedShape(`terminal node '${current}' must not have outgoing edges`);
      }
      break;
    }
    const edges = graph.outgoing.get(current) ?? [];
    if (edges.length !== 1) {
      unsupportedShape(`suffix node '${current}' must have exactly one outgoing edge`);
    }
    const next = (edges[0] as WorkflowEdgeV1).to;
    if ((graph.incoming.get(next) ?? []).length !== 1) {
      unsupportedShape(`suffix node '${next}' must have exactly one incoming edge`);
    }
    current = next;
  }

  const covered = new Set([...prefix, ...branchSeen, ...suffix]);
  if (covered.size !== workflow.nodes.length) {
    unsupportedShape("structured fork/join traversal does not cover every compiled node");
  }

  const nodeOrder = [
    ...prefix,
    ...branches.flatMap((branch) => branch),
    ...suffix
  ];
  return Object.freeze({
    schemaVersion: MASTRA_ADAPTER_PLAN_SCHEMA_VERSION,
    executionShape: "single-fork-join",
    workflowId: workflow.workflowId,
    revision: workflow.revision,
    compiledWorkflowDigest: workflow.compiledDigest,
    registryDigest: workflow.registryDigest,
    prefixNodeIds: Object.freeze(prefix),
    forkNodeId,
    branches: Object.freeze(branches),
    joinNodeId,
    suffixNodeIds: Object.freeze(suffix),
    nodeOrder: Object.freeze(nodeOrder)
  });
}

function findStructuredJoin(
  starts: readonly string[],
  graph: GraphIndex
): string {
  const distanceMaps = starts.map((start) => distancesFrom(start, graph));
  const candidates = [...(distanceMaps[0]?.keys() ?? [])].filter((candidate) =>
    distanceMaps.every((distances) => distances.has(candidate))
  );
  candidates.sort((left, right) => {
    const leftDistances = distanceMaps.map(
      (distances) => distances.get(left) as number
    );
    const rightDistances = distanceMaps.map(
      (distances) => distances.get(right) as number
    );
    return (
      Math.max(...leftDistances) - Math.max(...rightDistances) ||
      sum(leftDistances) - sum(rightDistances) ||
      left.localeCompare(right)
    );
  });
  const join = candidates[0];
  if (join === undefined) {
    unsupportedShape("fanout branches do not converge on one structured join");
  }
  return join;
}

function distancesFrom(
  start: string,
  graph: GraphIndex
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: Array<{ readonly nodeId: string; readonly distance: number }> = [
    { nodeId: start, distance: 0 }
  ];
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (item === undefined || distances.has(item.nodeId)) continue;
    distances.set(item.nodeId, item.distance);
    for (const edge of graph.outgoing.get(item.nodeId) ?? []) {
      queue.push({ nodeId: edge.to, distance: item.distance + 1 });
    }
  }
  return distances;
}

function verifyRuntimeBindings(
  workflow: CompiledWorkflowV1,
  registry: ComponentRegistry
): void {
  const issues: MastraAdapterIssue[] = [];
  const descriptors = new Map<string, ComponentDescriptorV1>();
  const schemas = new Map<string, SchemaDescriptorV1>();

  for (const node of workflow.nodes) {
    try {
      const descriptor = registry.resolveDescriptor(node.component);
      if (canonicalJson(descriptor) !== canonicalJson(node.resolvedComponent)) {
        issues.push({
          code: "RUNTIME_BINDING_MISSING",
          message: `runtime descriptor for node '${node.id}' differs from the compiled descriptor`,
          path: `nodes.${node.id}.component`
        });
        continue;
      }
      descriptors.set(componentKey(descriptor.ref), descriptor);
      for (const ref of [descriptor.inputSchema, descriptor.outputSchema]) {
        schemas.set(schemaKey(ref), registry.resolveSchema(ref));
        registry.resolveSchemaBinding(ref);
      }
      registry.resolveExecutor(node.component);

      if (descriptor.kind === "human-gate") {
        issues.push({
          code: "UNSUPPORTED_COMPONENT_KIND",
          message: `human-gate node '${node.id}' requires an explicit suspend/resume protocol that v0 does not implement`,
          path: `nodes.${node.id}.resolvedComponent.kind`
        });
      }
      if (descriptor.effect === "write-non-idempotent") {
        issues.push({
          code: "UNSUPPORTED_COMPONENT_EFFECT",
          message: `node '${node.id}' is non-idempotent; v0 cannot guard Mastra restart/time-travel replay with a durable receipt`,
          path: `nodes.${node.id}.resolvedComponent.effect`
        });
      }
      if (
        descriptor.effect === "write-idempotent" &&
        node.idempotencyKey === undefined
      ) {
        issues.push({
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: `write-idempotent node '${node.id}' requires an explicit idempotencyKey for restart-safe execution`,
          path: `nodes.${node.id}.idempotencyKey`
        });
      }
    } catch (error) {
      issues.push({
        code: "RUNTIME_BINDING_MISSING",
        message: `node '${node.id}' cannot resolve its executor and schema bindings: ${errorMessage(error)}`,
        path: `nodes.${node.id}.component`
      });
    }
  }

  const subset = {
    schemaVersion: "summer.component-registry-subset/v1",
    schemas: [...schemas.values()].sort((left, right) =>
      schemaKey(left.ref).localeCompare(schemaKey(right.ref), "en")
    ),
    components: [...descriptors.values()].sort((left, right) =>
      componentKey(left.ref).localeCompare(componentKey(right.ref), "en")
    )
  };
  if (sha256Canonical(subset) !== workflow.registryDigest) {
    issues.push({
      code: "RUNTIME_BINDING_MISSING",
      message: "runtime registry subset digest differs from the compiled registryDigest",
      path: "registryDigest"
    });
  }

  if (issues.length > 0) throw new MastraAdapterError(issues);
}

function createComponentStep(
  workflow: CompiledWorkflowV1,
  node: CompiledWorkflowNodeV1,
  registry: ComponentRegistry
): ErasedMastraStep {
  const executor = registry.resolveExecutor(node.component);
  const inputBinding = registry.resolveSchemaBinding(
    node.resolvedComponent.inputSchema
  );
  const outputBinding = registry.resolveSchemaBinding(
    node.resolvedComponent.outputSchema
  );

  return createStep({
    id: node.id,
    description: `Summer component ${componentKey(node.component)}`,
    inputSchema: SummerMastraEnvelopeV1Schema,
    outputSchema: SummerMastraEnvelopeV1Schema,
    retries: node.maxAttempts - 1,
    metadata: {
      ...runtimeMetadata(workflow, "node"),
      summerNodeId: node.id,
      component: componentKey(node.component)
    },
    execute: async ({ inputData, runId, retryCount, abortSignal }) => {
      const envelope = SummerMastraEnvelopeV1Schema.parse(inputData);
      const rawInput = cloneJson(
        node.input === undefined ? envelope.current : node.input
      );
      const parsedInput = JsonValueSchema.parse(
        await inputBinding.parseAsync(rawInput)
      );
      const rawOutput = await executeWithTimeout(
        node,
        abortSignal,
        (signal) =>
          executor(cloneJson(parsedInput), {
            workflowId: workflow.workflowId,
            workflowRevision: workflow.revision,
            runId,
            nodeId: node.id,
            attempt: retryCount + 1,
            ...(envelope.campaignId === undefined
              ? {}
              : { campaignId: envelope.campaignId }),
            ...(envelope.experimentId === undefined
              ? {}
              : { experimentId: envelope.experimentId }),
            ...(node.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: node.idempotencyKey }),
            signal
          })
      );
      const output = JsonValueSchema.parse(
        await outputBinding.parseAsync(rawOutput)
      );
      return withNodeOutput(envelope, node.id, cloneJson(output));
    }
  });
}

function createBranchMergeStep(
  workflow: CompiledWorkflowV1,
  plan: MastraSingleForkJoinPlanV1,
  branchWorkflows: readonly AnyWorkflow[]
): ErasedMastraStep {
  const branchOutputSchema = z.record(
    z.string(),
    SummerMastraEnvelopeV1Schema
  );
  return createStep({
    id: internalId(workflow, "merge"),
    inputSchema: branchOutputSchema,
    outputSchema: SummerMastraEnvelopeV1Schema,
    metadata: runtimeMetadata(workflow, "merge"),
    execute: async ({ inputData }) => {
      const parsed = branchOutputSchema.parse(inputData);
      const expectedIds = branchWorkflows.map((branch) => branch.id).sort();
      const actualIds = Object.keys(parsed).sort();
      if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) {
        throw new Error(
          `Mastra parallel result keys differ from the planned branches: expected ${expectedIds.join(
            ", "
          )}, received ${actualIds.join(", ")}`
        );
      }

      const envelopes = branchWorkflows.map((branch) => parsed[branch.id]);
      const base = envelopes[0];
      if (base === undefined) throw new Error("Mastra parallel result was empty");
      for (const envelope of envelopes.slice(1)) {
        if (envelope === undefined || !sameRunEnvelope(base, envelope)) {
          throw new Error("parallel branches returned inconsistent Summer run identity");
        }
      }

      const outputs: Record<string, JsonValue> = {};
      for (const envelope of envelopes) {
        if (envelope === undefined) continue;
        for (const [nodeId, output] of Object.entries(envelope.outputs)) {
          const existing = outputs[nodeId];
          if (
            existing !== undefined &&
            canonicalJson(existing) !== canonicalJson(output)
          ) {
            throw new Error(`parallel branches disagree on output for node '${nodeId}'`);
          }
          outputs[nodeId] = cloneJson(output);
        }
      }

      const current: Record<string, JsonValue> = {};
      for (const branch of plan.branches) {
        const tail = branch.at(-1) as string;
        const output = outputs[tail];
        if (output === undefined) {
          throw new Error(`parallel branch did not produce tail output '${tail}'`);
        }
        current[tail] = cloneJson(output);
      }

      return SummerMastraEnvelopeV1Schema.parse({
        schemaVersion: "summer.mastra-envelope/v1",
        initialInput: base.initialInput,
        current,
        outputs,
        ...(base.campaignId === undefined
          ? {}
          : { campaignId: base.campaignId }),
        ...(base.experimentId === undefined
          ? {}
          : { experimentId: base.experimentId })
      });
    }
  });
}

async function executeWithTimeout(
  node: CompiledWorkflowNodeV1,
  mastraSignal: AbortSignal,
  execute: (signal: AbortSignal) => JsonValue | Promise<JsonValue>
): Promise<JsonValue> {
  if (node.timeoutMs === undefined) {
    return execute(mastraSignal);
  }

  const timeoutController = new AbortController();
  const combinedSignal = AbortSignal.any([
    mastraSignal,
    timeoutController.signal
  ]);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new MastraComponentTimeoutError(node.id, node.timeoutMs as number);
      timeoutController.abort(error);
      reject(error);
    }, node.timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(() => execute(combinedSignal)), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function sameRunEnvelope(
  left: SummerMastraEnvelopeV1,
  right: SummerMastraEnvelopeV1
): boolean {
  return (
    canonicalJson(left.initialInput) === canonicalJson(right.initialInput) &&
    left.campaignId === right.campaignId &&
    left.experimentId === right.experimentId
  );
}

function then(workflow: AnyWorkflow, step: ErasedMastraStep): AnyWorkflow {
  return workflow.then(step) as AnyWorkflow;
}

function parallel(
  workflow: AnyWorkflow,
  branches: readonly AnyWorkflow[]
): AnyWorkflow {
  // Mastra's exact-optional Step and Workflow declarations are structurally
  // incompatible when type-erased, although Workflow implements Step. The
  // graph was runtime-checked above and every child has the envelope schemas.
  return workflow.parallel([...branches] as never) as AnyWorkflow;
}

function requiredStep(
  steps: ReadonlyMap<string, ErasedMastraStep>,
  nodeId: string
): ErasedMastraStep {
  const step = steps.get(nodeId);
  if (step === undefined) unsupportedShape(`plan references missing node '${nodeId}'`);
  return step;
}

function requiredNode(
  nodes: ReadonlyMap<string, CompiledWorkflowNodeV1>,
  nodeId: string
): CompiledWorkflowNodeV1 {
  const node = nodes.get(nodeId);
  if (node === undefined) unsupportedShape(`plan references missing node '${nodeId}'`);
  return node;
}

function runtimeMetadata(
  workflow: CompiledWorkflowV1,
  role: string
): Record<string, string | number> {
  return {
    summerAdapter: "runtime-mastra/v0",
    summerRole: role,
    summerWorkflowId: workflow.workflowId,
    summerWorkflowRevision: workflow.revision,
    summerCompiledWorkflowDigest: workflow.compiledDigest,
    summerRegistryDigest: workflow.registryDigest
  };
}

function internalId(workflow: CompiledWorkflowV1, role: string): string {
  // Leading underscore is impossible for a Summer Identifier, preventing a
  // collision with a protocol node while retaining a stable Mastra step ID.
  return `_summer_${role}_${workflow.compiledDigest.slice(0, 16)}`;
}

function componentKey(ref: ExactComponentRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

function schemaKey(ref: ExactSchemaRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function byEdgeTarget(left: WorkflowEdgeV1, right: WorkflowEdgeV1): number {
  return left.to.localeCompare(right.to) || left.id.localeCompare(right.id);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unsupportedShape(message: string): never {
  throw new MastraAdapterError([
    { code: "UNSUPPORTED_GRAPH_SHAPE", message, path: "edges" }
  ]);
}
