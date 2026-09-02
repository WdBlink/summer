import type { ComponentRegistry } from "@summer/components";
import {
  COMPILED_WORKFLOW_SCHEMA_VERSION,
  DecisionKindSchema,
  canonicalJson,
  computeCompiledWorkflowDigest,
  parseCompiledWorkflowV1,
  parseWorkflowSpecV1,
  sha256Canonical,
  type CompiledWorkflowV1,
  type ComponentDescriptorV1,
  type EdgeConditionV1,
  type ExactComponentRef,
  type ExactSchemaRef,
  type IterativeCampaignProfileV1,
  type SchemaDescriptorV1,
  type WorkflowEdgeV1,
  type WorkflowNodeV1,
  type WorkflowSpecV1
} from "@summer/protocol";

export type WorkflowCompileIssueCode =
  | "INVALID_SOURCE"
  | "NON_DATA_SOURCE"
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_EDGE_ID"
  | "ENTRY_NODE_NOT_FOUND"
  | "TERMINAL_NODE_NOT_FOUND"
  | "DUPLICATE_TERMINAL_NODE"
  | "INVALID_EDGE_ENDPOINT"
  | "UNREACHABLE_NODE"
  | "NODE_CANNOT_REACH_TERMINAL"
  | "TERMINAL_HAS_OUTGOING_EDGE"
  | "NON_TERMINAL_HAS_NO_OUTGOING_EDGE"
  | "UNRESOLVED_COMPONENT"
  | "RESOLVED_COMPONENT_MISMATCH"
  | "UNRESOLVED_SCHEMA"
  | "RESOLVED_SCHEMA_MISMATCH"
  | "FANOUT_NOT_SUPPORTED"
  | "INVALID_FANOUT"
  | "AMBIGUOUS_JOIN"
  | "UNSATISFIABLE_JOIN"
  | "AMBIGUOUS_ROUTE"
  | "INVALID_DECISION_ROUTE"
  | "DECISION_ROUTE_MISSING"
  | "DECISION_ROUTE_DUPLICATE"
  | "DECISION_ROUTE_TARGET_MISMATCH"
  | "UNRESOLVED_INPUT_SCHEMA_BINDING"
  | "INVALID_STATIC_NODE_INPUT"
  | "INPUT_SCHEMA_BINDING_ERROR"
  | "RETRY_REQUIRES_IDEMPOTENCY_KEY"
  | "NON_IDEMPOTENT_COMPONENT_RETRY"
  | "BOUNDED_FLOW_CYCLE"
  | "POLICY_NODE_NOT_FOUND"
  | "DUPLICATE_POLICY_NODE"
  | "POLICY_COMPONENT_MISMATCH"
  | "EXPERIMENT_NODE_NOT_FOUND"
  | "EXPERIMENT_COMPONENT_MISMATCH"
  | "ITERATIVE_CAMPAIGN_HAS_NO_CYCLE"
  | "CAMPAIGN_ENTRY_NOT_ACTIVATION"
  | "CAMPAIGN_FRAME_CHECK_DOES_NOT_DOMINATE_BUDGET"
  | "CAMPAIGN_BUDGET_DOES_NOT_DOMINATE_DECISION"
  | "CAMPAIGN_CYCLE_BYPASSES_BUDGET"
  | "CAMPAIGN_CYCLE_BYPASSES_FRAME_CHECK"
  | "CAMPAIGN_CYCLE_BYPASSES_DECISION";

export interface WorkflowCompileIssue {
  readonly code: WorkflowCompileIssueCode;
  readonly message: string;
  readonly path?: string;
}

export class WorkflowCompileError extends Error {
  readonly code = "WORKFLOW_COMPILE_FAILED" as const;
  readonly issues: readonly WorkflowCompileIssue[];

  constructor(issues: readonly WorkflowCompileIssue[]) {
    super(
      `Workflow compilation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("; ")}`
    );
    this.name = "WorkflowCompileError";
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * Compile inert JSON-compatible workflow data into the only executable Summer IR.
 *
 * This function deliberately has no hook that evaluates source text, imports a
 * module, or invokes a component executor. Exact schema bindings are used only
 * to validate inert static node input before an executable IR can be emitted.
 */
export function compileWorkflow(
  source: unknown,
  registry: ComponentRegistry
): CompiledWorkflowV1 {
  assertInertData(source);

  let parsed: WorkflowSpecV1;
  try {
    parsed = parseWorkflowSpecV1(source);
  } catch (error) {
    throw new WorkflowCompileError([
      {
        code: "INVALID_SOURCE",
        message: error instanceof Error ? error.message : "source did not match summer.workflow/v1"
      }
    ]);
  }

  const normalized = normalizeWorkflow(parsed);
  const issues: WorkflowCompileIssue[] = [];
  const nodeById = indexNodes(normalized.nodes, issues);
  indexEdges(normalized.edges, issues);

  if (!nodeById.has(normalized.entryNodeId)) {
    issues.push({
      code: "ENTRY_NODE_NOT_FOUND",
      message: `entry node '${normalized.entryNodeId}' does not exist`,
      path: "entryNodeId"
    });
  }

  const terminalIds = new Set<string>();
  for (const terminalId of normalized.profile.terminalNodeIds) {
    if (terminalIds.has(terminalId)) {
      issues.push({
        code: "DUPLICATE_TERMINAL_NODE",
        message: `terminal node '${terminalId}' is listed more than once`,
        path: `profile.terminalNodeIds.${terminalId}`
      });
    }
    terminalIds.add(terminalId);
    if (!nodeById.has(terminalId)) {
      issues.push({
        code: "TERMINAL_NODE_NOT_FOUND",
        message: `terminal node '${terminalId}' does not exist`,
        path: `profile.terminalNodeIds.${terminalId}`
      });
    }
  }

  const validEdges = normalized.edges.filter(
    (edge) => nodeById.has(edge.from) && nodeById.has(edge.to)
  );
  for (const edge of normalized.edges) {
    const missing: string[] = [];
    if (!nodeById.has(edge.from)) missing.push(`from '${edge.from}'`);
    if (!nodeById.has(edge.to)) missing.push(`to '${edge.to}'`);
    if (missing.length > 0) {
      issues.push({
        code: "INVALID_EDGE_ENDPOINT",
        message: `edge '${edge.id}' has unknown endpoint ${missing.join(" and ")}`,
        path: `edges.${edge.id}`
      });
    }
  }

  const outgoing = groupOutgoing(validEdges);
  const incoming = groupIncoming(validEdges);
  validateReachability(normalized.entryNodeId, nodeById, outgoing, issues);
  validateTerminalShape(nodeById, terminalIds, outgoing, issues);
  validateTerminalReachability(nodeById, terminalIds, validEdges, issues);
  validateJoins(normalized.nodes, incoming, outgoing, issues);

  const descriptors = resolveComponents(normalized.nodes, registry, issues);
  const registrySubsetDigest = resolveRegistrySubsetDigest(descriptors, registry, issues);
  validateStaticInputs(normalized.nodes, descriptors, registry, issues);
  validateDispatch(normalized, terminalIds, outgoing, descriptors, issues);
  validateRetries(normalized.nodes, descriptors, issues);

  if (normalized.profile.kind === "bounded-flow") {
    const cycle = findCycle(nodeById.keys(), outgoing);
    if (cycle !== undefined) {
      issues.push({
        code: "BOUNDED_FLOW_CYCLE",
        message: `bounded-flow must be acyclic; found ${cycle.join(" -> ")}`,
        path: "edges"
      });
    }
  } else {
    validateCampaign(
      normalized.profile,
      normalized.entryNodeId,
      nodeById,
      outgoing,
      descriptors,
      issues
    );
  }

  if (issues.length > 0) {
    throw new WorkflowCompileError(issues);
  }

  const compiledNodes = normalized.nodes.map((node) => ({
    ...node,
    // All unresolved descriptors have already produced an issue and returned above.
    resolvedComponent: descriptors.get(node.id) as ComponentDescriptorV1
  }));
  const stableCompiled = {
    schemaVersion: COMPILED_WORKFLOW_SCHEMA_VERSION,
    workflowId: normalized.workflowId,
    revision: normalized.revision,
    profile: normalized.profile,
    entryNodeId: normalized.entryNodeId,
    nodes: compiledNodes,
    edges: normalized.edges,
    ...(normalized.metadata === undefined ? {} : { metadata: normalized.metadata }),
    sourceDigest: sha256Canonical(normalized),
    registryDigest: registrySubsetDigest
  };
  const compiled = {
    ...stableCompiled,
    compiledDigest: computeCompiledWorkflowDigest(stableCompiled),
    compiledAt: new Date().toISOString()
  };

  return parseCompiledWorkflowV1(compiled);
}

function assertInertData(value: unknown): void {
  const issue = findNonDataValue(value, "$", new WeakSet<object>());
  if (issue !== undefined) {
    throw new WorkflowCompileError([{ code: "NON_DATA_SOURCE", ...issue }]);
  }
}

function findNonDataValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>
): Omit<WorkflowCompileIssue, "code"> | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return undefined;
  }
  if (typeof value !== "object") {
    return {
      message: `workflow source must contain inert JSON data; found ${typeof value} at ${path}`,
      path
    };
  }

  const object = value as object;
  if (ancestors.has(object)) {
    return { message: `workflow source must not contain reference cycles at ${path}`, path };
  }

  const prototype = Object.getPrototypeOf(object) as unknown;
  if (!Array.isArray(object) && prototype !== Object.prototype && prototype !== null) {
    return {
      message: `workflow source must contain only plain objects and arrays at ${path}`,
      path
    };
  }

  ancestors.add(object);
  const descriptors = Object.getOwnPropertyDescriptors(object);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      ancestors.delete(object);
      return { message: `symbol keys are not valid workflow data at ${path}`, path };
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      ancestors.delete(object);
      return {
        message: `unsafe object key '${key}' is not valid workflow data at ${path}`,
        path: `${path}.${key}`
      };
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      ancestors.delete(object);
      return {
        message: `accessor properties are not valid workflow data at ${path}.${key}`,
        path: `${path}.${key}`
      };
    }
    const nested = findNonDataValue(descriptor.value, `${path}.${key}`, ancestors);
    if (nested !== undefined) {
      ancestors.delete(object);
      return nested;
    }
  }
  ancestors.delete(object);
  return undefined;
}

function normalizeWorkflow(source: WorkflowSpecV1): WorkflowSpecV1 {
  const profile = {
    ...source.profile,
    terminalNodeIds: [...source.profile.terminalNodeIds].sort()
  };
  const nodes = [...source.nodes]
    .map((node) => canonicalClone(node))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...source.edges]
    .map((edge) => canonicalClone(edge))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: source.schemaVersion,
    workflowId: source.workflowId,
    revision: source.revision,
    profile,
    entryNodeId: source.entryNodeId,
    nodes,
    edges,
    ...(source.metadata === undefined ? {} : { metadata: canonicalClone(source.metadata) })
  };
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function indexNodes(
  nodes: readonly WorkflowNodeV1[],
  issues: WorkflowCompileIssue[]
): Map<string, WorkflowNodeV1> {
  const result = new Map<string, WorkflowNodeV1>();
  for (const node of nodes) {
    if (result.has(node.id)) {
      issues.push({
        code: "DUPLICATE_NODE_ID",
        message: `node id '${node.id}' is not unique`,
        path: `nodes.${node.id}.id`
      });
    } else {
      result.set(node.id, node);
    }
  }
  return result;
}

function indexEdges(
  edges: readonly WorkflowEdgeV1[],
  issues: WorkflowCompileIssue[]
): void {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (ids.has(edge.id)) {
      issues.push({
        code: "DUPLICATE_EDGE_ID",
        message: `edge id '${edge.id}' is not unique`,
        path: `edges.${edge.id}.id`
      });
    }
    ids.add(edge.id);
  }
}

function groupOutgoing(
  edges: readonly WorkflowEdgeV1[]
): ReadonlyMap<string, readonly WorkflowEdgeV1[]> {
  const result = new Map<string, WorkflowEdgeV1[]>();
  for (const edge of edges) {
    const current = result.get(edge.from) ?? [];
    current.push(edge);
    result.set(edge.from, current);
  }
  return result;
}

function groupIncoming(
  edges: readonly WorkflowEdgeV1[]
): ReadonlyMap<string, readonly WorkflowEdgeV1[]> {
  const result = new Map<string, WorkflowEdgeV1[]>();
  for (const edge of edges) {
    const current = result.get(edge.to) ?? [];
    current.push(edge);
    result.set(edge.to, current);
  }
  return result;
}

function validateJoins(
  nodes: readonly WorkflowNodeV1[],
  incoming: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  issues: WorkflowCompileIssue[]
): void {
  for (const node of nodes) {
    const edges = incoming.get(node.id) ?? [];
    if (edges.length > 1 && node.join === undefined) {
      issues.push({
        code: "AMBIGUOUS_JOIN",
        message: `node '${node.id}' has ${edges.length} incoming edges and must declare join as 'all' or 'any'`,
        path: `nodes.${node.id}.join`
      });
    }
    if (
      edges.length > 1 &&
      node.join === "all" &&
      new Set(edges.map((edge) => edge.from)).size !== edges.length
    ) {
      issues.push({
        code: "UNSATISFIABLE_JOIN",
        message: `join-all node '${node.id}' has multiple incoming edges from the same predecessor, so mutually exclusive route outcomes cannot all arrive`,
        path: `nodes.${node.id}.join`
      });
    }
    if (edges.length > 1 && node.join === "all") {
      const witness = findExclusiveRouteWitness(node.id, edges, nodes, outgoing);
      if (witness !== undefined) {
        issues.push({
          code: "UNSATISFIABLE_JOIN",
          message: `join-all node '${node.id}' waits for predecessors '${witness.leftPredecessor}' and '${witness.rightPredecessor}', but upstream route '${witness.routeNodeId}' can select only one of mutually exclusive edges '${witness.leftEdgeId}' and '${witness.rightEdgeId}'`,
          path: `nodes.${node.id}.join`
        });
      }
    }
  }
}

interface ExclusiveRouteWitness {
  readonly routeNodeId: string;
  readonly leftPredecessor: string;
  readonly rightPredecessor: string;
  readonly leftEdgeId: string;
  readonly rightEdgeId: string;
}

function findExclusiveRouteWitness(
  joinNodeId: string,
  incomingEdges: readonly WorkflowEdgeV1[],
  nodes: readonly WorkflowNodeV1[],
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>
): ExclusiveRouteWitness | undefined {
  const predecessors = [...new Set(incomingEdges.map((edge) => edge.from))].sort(
    (left, right) => left.localeCompare(right, "en")
  );
  if (predecessors.length < 2) return undefined;

  const routeNodes = nodes
    .filter(
      (node) =>
        node.dispatch === "route" && (outgoing.get(node.id)?.length ?? 0) > 1
    )
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  for (const routeNode of routeNodes) {
    // A route on either side of a cycle may execute again. v1 does not define
    // cross-iteration join tokens, so this local proof intentionally applies
    // only to an acyclic, strict upstream route.
    if (pathExists(joinNodeId, routeNode.id, outgoing)) continue;

    const routeEdges = [...(outgoing.get(routeNode.id) ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id, "en")
    );
    if (routeEdges.some((edge) => pathExists(edge.to, routeNode.id, outgoing))) continue;
    const reachableByPredecessor = new Map<string, readonly WorkflowEdgeV1[]>();
    for (const predecessor of predecessors) {
      reachableByPredecessor.set(
        predecessor,
        routeEdges.filter((edge) =>
          pathExistsAvoiding(
            edge.to,
            predecessor,
            outgoing,
            new Set([routeNode.id, joinNodeId])
          )
        )
      );
    }

    for (let leftIndex = 0; leftIndex < predecessors.length; leftIndex += 1) {
      const leftPredecessor = predecessors[leftIndex];
      if (leftPredecessor === undefined) continue;
      const leftEdges = reachableByPredecessor.get(leftPredecessor) ?? [];
      if (leftEdges.length === 0) continue;

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < predecessors.length;
        rightIndex += 1
      ) {
        const rightPredecessor = predecessors[rightIndex];
        if (rightPredecessor === undefined) continue;
        const rightEdges = reachableByPredecessor.get(rightPredecessor) ?? [];
        if (rightEdges.length === 0) continue;

        const allPairsExclusive = leftEdges.every((leftEdge) =>
          rightEdges.every((rightEdge) =>
            edgeConditionsAreMutuallyExclusive(
              leftEdge.condition,
              rightEdge.condition
            )
          )
        );
        if (!allPairsExclusive) continue;

        return {
          routeNodeId: routeNode.id,
          leftPredecessor,
          rightPredecessor,
          leftEdgeId: (leftEdges[0] as WorkflowEdgeV1).id,
          rightEdgeId: (rightEdges[0] as WorkflowEdgeV1).id
        };
      }
    }
  }
  return undefined;
}

function edgeConditionsAreMutuallyExclusive(
  left: EdgeConditionV1,
  right: EdgeConditionV1
): boolean {
  if (
    (left.kind === "node-succeeded" && right.kind === "node-failed") ||
    (left.kind === "node-failed" && right.kind === "node-succeeded")
  ) {
    return true;
  }
  return (
    left.kind === "decision-is" &&
    right.kind === "decision-is" &&
    left.decision !== right.decision
  );
}

function pathExistsAvoiding(
  from: string,
  to: string,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  excludedNodeIds: ReadonlySet<string>
): boolean {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || excludedNodeIds.has(current)) continue;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of outgoing.get(current) ?? []) queue.push(edge.to);
  }
  return false;
}

function validateReachability(
  entryNodeId: string,
  nodeById: ReadonlyMap<string, WorkflowNodeV1>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  issues: WorkflowCompileIssue[]
): void {
  if (!nodeById.has(entryNodeId)) return;
  const reached = new Set<string>();
  const queue = [entryNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || reached.has(current)) continue;
    reached.add(current);
    for (const edge of outgoing.get(current) ?? []) queue.push(edge.to);
  }
  for (const nodeId of nodeById.keys()) {
    if (!reached.has(nodeId)) {
      issues.push({
        code: "UNREACHABLE_NODE",
        message: `node '${nodeId}' is not reachable from entry '${entryNodeId}'`,
        path: `nodes.${nodeId}`
      });
    }
  }
}

function validateTerminalShape(
  nodeById: ReadonlyMap<string, WorkflowNodeV1>,
  terminalIds: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  issues: WorkflowCompileIssue[]
): void {
  for (const nodeId of nodeById.keys()) {
    const edges = outgoing.get(nodeId) ?? [];
    if (terminalIds.has(nodeId) && edges.length > 0) {
      issues.push({
        code: "TERMINAL_HAS_OUTGOING_EDGE",
        message: `terminal node '${nodeId}' has ${edges.length} outgoing edge(s)`,
        path: `nodes.${nodeId}`
      });
    }
    if (!terminalIds.has(nodeId) && edges.length === 0) {
      issues.push({
        code: "NON_TERMINAL_HAS_NO_OUTGOING_EDGE",
        message: `non-terminal node '${nodeId}' has no outgoing edge`,
        path: `nodes.${nodeId}`
      });
    }
  }
}

function validateTerminalReachability(
  nodeById: ReadonlyMap<string, WorkflowNodeV1>,
  terminalIds: ReadonlySet<string>,
  edges: readonly WorkflowEdgeV1[],
  issues: WorkflowCompileIssue[]
): void {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const current = incoming.get(edge.to) ?? [];
    current.push(edge.from);
    incoming.set(edge.to, current);
  }

  const canReachTerminal = new Set<string>();
  const queue = [...terminalIds].filter((nodeId) => nodeById.has(nodeId));
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || canReachTerminal.has(current)) continue;
    canReachTerminal.add(current);
    for (const predecessor of incoming.get(current) ?? []) {
      queue.push(predecessor);
    }
  }

  for (const nodeId of nodeById.keys()) {
    if (!canReachTerminal.has(nodeId)) {
      issues.push({
        code: "NODE_CANNOT_REACH_TERMINAL",
        message: `node '${nodeId}' has no path to a declared terminal node`,
        path: `nodes.${nodeId}`
      });
    }
  }
}

function resolveComponents(
  nodes: readonly WorkflowNodeV1[],
  registry: ComponentRegistry,
  issues: WorkflowCompileIssue[]
): Map<string, ComponentDescriptorV1> {
  const result = new Map<string, ComponentDescriptorV1>();
  for (const node of nodes) {
    let descriptor: ComponentDescriptorV1;
    try {
      descriptor = registry.resolveDescriptor(node.component);
    } catch (error) {
      if (hasCode(error, "UNRESOLVED_COMPONENT")) {
        issues.push({
          code: "UNRESOLVED_COMPONENT",
          message: `component '${componentRefKey(node.component)}' for node '${node.id}' is not registered`,
          path: `nodes.${node.id}.component`
        });
        continue;
      }
      throw error;
    }
    if (!sameComponentRef(node.component, descriptor.ref)) {
      issues.push({
        code: "RESOLVED_COMPONENT_MISMATCH",
        message: `registry resolved '${componentRefKey(descriptor.ref)}' for exact reference '${componentRefKey(node.component)}'`,
        path: `nodes.${node.id}.component`
      });
      continue;
    }
    result.set(node.id, descriptor);
  }
  return result;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function componentRefKey(ref: ExactComponentRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

function sameComponentRef(left: ExactComponentRef, right: ExactComponentRef): boolean {
  return (
    left.namespace === right.namespace &&
    left.name === right.name &&
    left.version === right.version
  );
}

function schemaRefKey(ref: ExactSchemaRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

function sameSchemaRef(left: ExactSchemaRef, right: ExactSchemaRef): boolean {
  return (
    left.namespace === right.namespace &&
    left.name === right.name &&
    left.version === right.version
  );
}

function resolveRegistrySubsetDigest(
  descriptors: ReadonlyMap<string, ComponentDescriptorV1>,
  registry: ComponentRegistry,
  issues: WorkflowCompileIssue[]
): string {
  const components = [...new Map(
    [...descriptors.values()].map((descriptor) => [
      componentRefKey(descriptor.ref),
      descriptor
    ] as const)
  ).values()].sort((left, right) =>
    componentRefKey(left.ref).localeCompare(componentRefKey(right.ref), "en")
  );
  const schemasByRef = new Map<string, ExactSchemaRef>();
  for (const component of components) {
    schemasByRef.set(schemaRefKey(component.inputSchema), component.inputSchema);
    schemasByRef.set(schemaRefKey(component.outputSchema), component.outputSchema);
  }
  const schemaRefs = [...schemasByRef.values()].sort((left, right) =>
    schemaRefKey(left).localeCompare(schemaRefKey(right), "en")
  );
  const schemas: SchemaDescriptorV1[] = [];

  for (const schemaRef of schemaRefs) {
    let schema: SchemaDescriptorV1;
    try {
      schema = registry.resolveSchema(schemaRef);
    } catch (error) {
      if (hasCode(error, "UNRESOLVED_SCHEMA")) {
        issues.push({
          code: "UNRESOLVED_SCHEMA",
          message: `schema '${schemaRefKey(schemaRef)}' referenced by a resolved component is not registered`,
          path: "registry.schemas"
        });
        continue;
      }
      throw error;
    }
    if (!sameSchemaRef(schemaRef, schema.ref)) {
      issues.push({
        code: "RESOLVED_SCHEMA_MISMATCH",
        message: `registry resolved '${schemaRefKey(schema.ref)}' for exact schema reference '${schemaRefKey(schemaRef)}'`,
        path: "registry.schemas"
      });
      continue;
    }
    schemas.push(schema);
  }

  return sha256Canonical({
    schemaVersion: "summer.component-registry-subset/v1",
    schemas,
    components
  });
}

function validateStaticInputs(
  nodes: readonly WorkflowNodeV1[],
  descriptors: ReadonlyMap<string, ComponentDescriptorV1>,
  registry: ComponentRegistry,
  issues: WorkflowCompileIssue[]
): void {
  for (const node of nodes) {
    if (node.input === undefined) continue;
    const descriptor = descriptors.get(node.id);
    if (descriptor === undefined) continue;

    let binding: ReturnType<ComponentRegistry["resolveSchemaBinding"]>;
    try {
      binding = registry.resolveSchemaBinding(descriptor.inputSchema);
    } catch (error) {
      if (hasCode(error, "UNRESOLVED_SCHEMA_BINDING")) {
        issues.push({
          code: "UNRESOLVED_INPUT_SCHEMA_BINDING",
          message: `static input for node '${node.id}' cannot be checked because exact schema binding '${schemaRefKey(descriptor.inputSchema)}' is not registered`,
          path: `nodes.${node.id}.input`
        });
        continue;
      }
      issues.push({
        code: "INPUT_SCHEMA_BINDING_ERROR",
        message: `input schema binding lookup failed for node '${node.id}': ${errorMessage(error)}`,
        path: `nodes.${node.id}.input`
      });
      continue;
    }

    try {
      const result = binding.safeParse(canonicalClone(node.input));
      if (!result.success) {
        issues.push({
          code: "INVALID_STATIC_NODE_INPUT",
          message: `static input for node '${node.id}' does not match exact schema '${schemaRefKey(descriptor.inputSchema)}'`,
          path: `nodes.${node.id}.input`
        });
      }
    } catch (error) {
      issues.push({
        code: "INPUT_SCHEMA_BINDING_ERROR",
        message: `input schema binding threw while checking static input for node '${node.id}': ${errorMessage(error)}`,
        path: `nodes.${node.id}.input`
      });
    }
  }
}

function validateDispatch(
  source: WorkflowSpecV1,
  terminalIds: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  descriptors: ReadonlyMap<string, ComponentDescriptorV1>,
  issues: WorkflowCompileIssue[]
): void {
  const decisionNodeId =
    source.profile.kind === "iterative-campaign" ? source.profile.decisionNodeId : undefined;

  for (const node of source.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (terminalIds.has(node.id)) continue;
    const descriptor = descriptors.get(node.id);

    if (node.dispatch === "fanout") {
      if (edges.length < 2 || edges.some((edge) => edge.condition.kind !== "always")) {
        issues.push({
          code: "INVALID_FANOUT",
          message: `fanout node '${node.id}' must have at least two unconditional outgoing edges`,
          path: `nodes.${node.id}.dispatch`
        });
      }
      if (new Set(edges.map((edge) => edge.to)).size !== edges.length) {
        issues.push({
          code: "INVALID_FANOUT",
          message: `fanout node '${node.id}' must target each child at most once`,
          path: `nodes.${node.id}.dispatch`
        });
      }
      if (descriptor !== undefined && !descriptor.supportsFanout) {
        issues.push({
          code: "FANOUT_NOT_SUPPORTED",
          message: `component '${componentRefKey(descriptor.ref)}' does not support fanout`,
          path: `nodes.${node.id}.component`
        });
      }
      continue;
    }

    const conditionKeys = edges.map((edge) => conditionKey(edge.condition));
    if (new Set(conditionKeys).size !== conditionKeys.length) {
      issues.push({
        code: "AMBIGUOUS_ROUTE",
        message: `route node '${node.id}' has duplicate outgoing conditions`,
        path: `nodes.${node.id}.dispatch`
      });
    }
    if (edges.length > 1 && edges.some((edge) => edge.condition.kind === "always")) {
      issues.push({
        code: "AMBIGUOUS_ROUTE",
        message: `route node '${node.id}' cannot combine an unconditional edge with other edges`,
        path: `nodes.${node.id}.dispatch`
      });
    }

    for (const edge of edges) {
      if (edge.condition.kind === "decision-is" && node.id !== decisionNodeId) {
        issues.push({
          code: "INVALID_DECISION_ROUTE",
          message: `decision condition on edge '${edge.id}' must originate at the campaign decision node`,
          path: `edges.${edge.id}.condition`
        });
      }
      if (node.id === decisionNodeId && edge.condition.kind !== "decision-is") {
        issues.push({
          code: "INVALID_DECISION_ROUTE",
          message: `campaign decision node edge '${edge.id}' must use a closed decision-is condition`,
          path: `edges.${edge.id}.condition`
        });
      }
    }
  }
}

function conditionKey(condition: EdgeConditionV1): string {
  return condition.kind === "decision-is"
    ? `${condition.kind}:${condition.decision}`
    : condition.kind;
}

function validateRetries(
  nodes: readonly WorkflowNodeV1[],
  descriptors: ReadonlyMap<string, ComponentDescriptorV1>,
  issues: WorkflowCompileIssue[]
): void {
  for (const node of nodes) {
    if (node.maxAttempts <= 1) continue;
    const descriptor = descriptors.get(node.id);
    if (descriptor === undefined || !descriptor.effect.startsWith("write-")) continue;

    if (node.idempotencyKey === undefined) {
      issues.push({
        code: "RETRY_REQUIRES_IDEMPOTENCY_KEY",
        message: `effectful node '${node.id}' retries without an idempotency key`,
        path: `nodes.${node.id}.idempotencyKey`
      });
    }
    if (descriptor.effect === "write-non-idempotent") {
      issues.push({
        code: "NON_IDEMPOTENT_COMPONENT_RETRY",
        message: `component '${componentRefKey(descriptor.ref)}' is declared non-idempotent and cannot be retried`,
        path: `nodes.${node.id}.maxAttempts`
      });
    }
  }
}

function validateCampaign(
  profile: IterativeCampaignProfileV1,
  entryNodeId: string,
  nodeById: ReadonlyMap<string, WorkflowNodeV1>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  descriptors: ReadonlyMap<string, ComponentDescriptorV1>,
  issues: WorkflowCompileIssue[]
): void {
  if (entryNodeId !== profile.activationNodeId) {
    issues.push({
      code: "CAMPAIGN_ENTRY_NOT_ACTIVATION",
      message: `campaign entry '${entryNodeId}' must equal activation node '${profile.activationNodeId}'`,
      path: "entryNodeId"
    });
  }

  const policyBindings = [
    ["activationNodeId", profile.activationNodeId, "activation"],
    ["iterationNodeId", profile.iterationNodeId, "iteration"],
    ["budgetNodeId", profile.budgetNodeId, "budget"],
    ["frameCheckNodeId", profile.frameCheckNodeId, "frame-check"],
    ["decisionNodeId", profile.decisionNodeId, "decision"]
  ] as const;

  const campaignRoleNodeIds = [
    ...policyBindings.map(([, nodeId]) => nodeId),
    profile.experimentNodeId
  ];
  if (new Set(campaignRoleNodeIds).size !== campaignRoleNodeIds.length) {
    issues.push({
      code: "DUPLICATE_POLICY_NODE",
      message:
        "campaign experiment and policy roles must be bound to six distinct nodes",
      path: "profile"
    });
  }

  for (const [field, nodeId, expectedPolicyKind] of policyBindings) {
    if (!nodeById.has(nodeId)) {
      issues.push({
        code: "POLICY_NODE_NOT_FOUND",
        message: `${field} references missing node '${nodeId}'`,
        path: `profile.${field}`
      });
      continue;
    }
    const descriptor = descriptors.get(nodeId);
    if (
      descriptor !== undefined &&
      (descriptor.kind !== "policy" || descriptor.policyKind !== expectedPolicyKind)
    ) {
      issues.push({
        code: "POLICY_COMPONENT_MISMATCH",
        message: `node '${nodeId}' must resolve to a '${expectedPolicyKind}' policy component`,
        path: `profile.${field}`
      });
    }
  }

  if (!nodeById.has(profile.experimentNodeId)) {
    issues.push({
      code: "EXPERIMENT_NODE_NOT_FOUND",
      message: `experimentNodeId references missing node '${profile.experimentNodeId}'`,
      path: "profile.experimentNodeId"
    });
  } else {
    const experimentDescriptor = descriptors.get(profile.experimentNodeId);
    if (
      experimentDescriptor !== undefined &&
      experimentDescriptor.kind !== "nested-workflow"
    ) {
      issues.push({
        code: "EXPERIMENT_COMPONENT_MISMATCH",
        message: `node '${profile.experimentNodeId}' must resolve to a 'nested-workflow' component`,
        path: "profile.experimentNodeId"
      });
    }
  }

  validateCampaignPolicyDominance(
    entryNodeId,
    profile,
    nodeById,
    outgoing,
    issues
  );
  validateDecisionRouteCoverage(profile, outgoing, issues);

  const cycle = findCycle(nodeById.keys(), outgoing);
  if (cycle === undefined) {
    issues.push({
      code: "ITERATIVE_CAMPAIGN_HAS_NO_CYCLE",
      message:
        "iterative-campaign must contain a cycle controlled by budget, frame-check, and decision policies",
      path: "edges"
    });
    return;
  }

  const withoutBudget = findCycle(nodeById.keys(), outgoing, profile.budgetNodeId);
  if (withoutBudget !== undefined) {
    issues.push({
      code: "CAMPAIGN_CYCLE_BYPASSES_BUDGET",
      message: `campaign cycle bypasses budget node '${profile.budgetNodeId}': ${withoutBudget.join(" -> ")}`,
      path: "edges"
    });
  }

  const withoutDecision = findCycle(nodeById.keys(), outgoing, profile.decisionNodeId);
  if (withoutDecision !== undefined) {
    issues.push({
      code: "CAMPAIGN_CYCLE_BYPASSES_DECISION",
      message: `campaign cycle bypasses decision node '${profile.decisionNodeId}': ${withoutDecision.join(" -> ")}`,
      path: "edges"
    });
  }

  const withoutFrameCheck = findCycle(
    nodeById.keys(),
    outgoing,
    profile.frameCheckNodeId
  );
  if (withoutFrameCheck !== undefined) {
    issues.push({
      code: "CAMPAIGN_CYCLE_BYPASSES_FRAME_CHECK",
      message: `campaign cycle bypasses frame-check node '${profile.frameCheckNodeId}': ${withoutFrameCheck.join(" -> ")}`,
      path: "edges"
    });
  }

  for (const edge of outgoing.get(profile.decisionNodeId) ?? []) {
    if (
      pathExists(edge.to, profile.decisionNodeId, outgoing) &&
      edge.condition.kind !== "decision-is"
    ) {
      issues.push({
        code: "INVALID_DECISION_ROUTE",
        message: `campaign back edge '${edge.id}' must use a closed decision-is condition`,
        path: `edges.${edge.id}.condition`
      });
    }
  }
}

function validateCampaignPolicyDominance(
  entryNodeId: string,
  profile: IterativeCampaignProfileV1,
  nodeById: ReadonlyMap<string, WorkflowNodeV1>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  issues: WorkflowCompileIssue[]
): void {
  if (!nodeById.has(entryNodeId)) return;

  if (
    nodeById.has(profile.frameCheckNodeId) &&
    nodeById.has(profile.budgetNodeId) &&
    pathExistsAvoiding(
      entryNodeId,
      profile.budgetNodeId,
      outgoing,
      new Set([profile.frameCheckNodeId])
    )
  ) {
    issues.push({
      code: "CAMPAIGN_FRAME_CHECK_DOES_NOT_DOMINATE_BUDGET",
      message: `entry '${entryNodeId}' can reach budget node '${profile.budgetNodeId}' without first passing frame-check node '${profile.frameCheckNodeId}'`,
      path: "edges"
    });
  }

  if (
    nodeById.has(profile.budgetNodeId) &&
    nodeById.has(profile.decisionNodeId) &&
    pathExistsAvoiding(
      entryNodeId,
      profile.decisionNodeId,
      outgoing,
      new Set([profile.budgetNodeId])
    )
  ) {
    issues.push({
      code: "CAMPAIGN_BUDGET_DOES_NOT_DOMINATE_DECISION",
      message: `entry '${entryNodeId}' can reach decision node '${profile.decisionNodeId}' without first passing budget node '${profile.budgetNodeId}'`,
      path: "edges"
    });
  }
}

function validateDecisionRouteCoverage(
  profile: IterativeCampaignProfileV1,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  issues: WorkflowCompileIssue[]
): void {
  const routes = new Map<string, WorkflowEdgeV1[]>();
  for (const edge of outgoing.get(profile.decisionNodeId) ?? []) {
    if (edge.condition.kind !== "decision-is") continue;
    const current = routes.get(edge.condition.decision) ?? [];
    current.push(edge);
    routes.set(edge.condition.decision, current);
  }

  for (const decision of DecisionKindSchema.options) {
    const decisionRoutes = routes.get(decision) ?? [];
    const count = decisionRoutes.length;
    if (count === 0) {
      issues.push({
        code: "DECISION_ROUTE_MISSING",
        message: `campaign decision node '${profile.decisionNodeId}' must have exactly one '${decision}' route; found none`,
        path: `nodes.${profile.decisionNodeId}.dispatch.${decision}`
      });
    } else if (count > 1) {
      issues.push({
        code: "DECISION_ROUTE_DUPLICATE",
        message: `campaign decision node '${profile.decisionNodeId}' must have exactly one '${decision}' route; found ${count}`,
        path: `nodes.${profile.decisionNodeId}.dispatch.${decision}`
      });
    } else {
      validateDecisionRouteTarget(decision, decisionRoutes[0] as WorkflowEdgeV1, profile, outgoing, issues);
    }
  }
}

function validateDecisionRouteTarget(
  decision: (typeof DecisionKindSchema.options)[number],
  edge: WorkflowEdgeV1,
  profile: IterativeCampaignProfileV1,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  issues: WorkflowCompileIssue[]
): void {
  let expectedTarget: string | undefined;
  if (
    decision === "replicate" ||
    decision === "repair-runtime" ||
    decision === "run-next-experiment" ||
    decision === "recompile-hypothesis"
  ) {
    expectedTarget = profile.experimentNodeId;
  }

  if (expectedTarget !== undefined) {
    if (edge.to !== expectedTarget) {
      issues.push({
        code: "DECISION_ROUTE_TARGET_MISMATCH",
        message: `'${decision}' edge '${edge.id}' must directly target '${expectedTarget}', not '${edge.to}'`,
        path: `edges.${edge.id}.to`
      });
    }
    return;
  }

  if (decision === "stop") {
    if (!profile.terminalNodeIds.includes(edge.to)) {
      issues.push({
        code: "DECISION_ROUTE_TARGET_MISMATCH",
        message: `'stop' edge '${edge.id}' must directly target a declared terminal node, not '${edge.to}'`,
        path: `edges.${edge.id}.to`
      });
    }
    return;
  }

  if (profile.terminalNodeIds.includes(edge.to)) {
    issues.push({
      code: "DECISION_ROUTE_TARGET_MISMATCH",
      message: `'wait' edge '${edge.id}' must not directly target terminal node '${edge.to}'`,
      path: `edges.${edge.id}.to`
    });
    return;
  }
  if (
    !pathExistsAvoiding(
      edge.to,
      profile.frameCheckNodeId,
      outgoing,
      new Set([profile.decisionNodeId])
    )
  ) {
    issues.push({
      code: "DECISION_ROUTE_TARGET_MISMATCH",
      message: `'wait' edge '${edge.id}' must target a path that reaches frame-check node '${profile.frameCheckNodeId}' before returning to decision node '${profile.decisionNodeId}'`,
      path: `edges.${edge.id}.to`
    });
  }
}

function findCycle(
  nodeIds: Iterable<string>,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>,
  excludedNodeId?: string
): readonly string[] | undefined {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): readonly string[] | undefined => {
    if (nodeId === excludedNodeId) return undefined;
    if (active.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      return [...stack.slice(start), nodeId];
    }
    if (visited.has(nodeId)) return undefined;
    visited.add(nodeId);
    active.add(nodeId);
    stack.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (edge.to === excludedNodeId) continue;
      const cycle = visit(edge.to);
      if (cycle !== undefined) return cycle;
    }
    stack.pop();
    active.delete(nodeId);
    return undefined;
  };

  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

function pathExists(
  from: string,
  to: string,
  outgoing: ReadonlyMap<string, readonly WorkflowEdgeV1[]>
): boolean {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const edge of outgoing.get(current) ?? []) queue.push(edge.to);
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
