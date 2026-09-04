import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";

import {
  ComponentRegistry,
  type ComponentExecutionContext,
  type ComponentExecutor
} from "@summer/components";
import {
  canonicalJson,
  type ComponentDescriptorV1,
  type JsonValue
} from "@summer/protocol";

import {
  IDEA_SPARK_PREPARE_COMPONENT_REF,
  IDEA_SPARK_PROVIDER_GATE_COMPONENT_REF,
  IDEA_SPARK_PROVIDERS,
  IDEA_SPARK_REQUEST_SCHEMA_REF,
  IDEA_SPARK_RESULT_SCHEMA_REF,
  IDEA_SPARK_RETRY_DECISION_COMPONENT_REF,
  IDEA_SPARK_STAGE_COMPONENT_REF,
  IDEA_SPARK_STATE_SCHEMA_REF,
  IDEA_SPARK_TRANSITION_COMPONENT_REF,
  IDEA_SPARK_VERIFY_COMPONENT_REF,
  IdeaSparkFlowStateV2Schema,
  IdeaSparkProviderStatusV1Schema,
  IdeaSparkResultV2Schema,
  RESEARCH_IDEATION_SCHEMA_BINDINGS,
  RESEARCH_IDEATION_SCHEMA_DESCRIPTORS,
  assertIdeaSparkExecutionGrantActive,
  prepareIdeaSparkRequest,
  type IdeaSparkArtifactV1,
  type IdeaSparkFlowStateV2,
  type IdeaSparkNavigatorSnapshotV1,
  type IdeaSparkNodeRunV2,
  type IdeaSparkProvider,
  type IdeaSparkProviderStatusV1,
  type IdeaSparkRoute,
  type IdeaSparkStage,
  type IdeaSparkTerminalStatus
} from "./contracts.js";
import {
  CodexIdeaSparkDriver,
  ResearchIdeationExecutionError,
  ensureInvocationManifest,
  ensureRunManifest,
  type IdeaSparkDriver
} from "./driver.js";

const STAGE_PERMISSIONS = [
  "filesystem.research-artifact.read",
  "filesystem.research-artifact.write",
  "network.research.retrieve",
  "process.codex.exec"
] as const;

export const RESEARCH_IDEATION_COMPONENT_DESCRIPTORS = Object.freeze([
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_PREPARE_COMPONENT_REF,
    kind: "validator",
    inputSchema: IDEA_SPARK_REQUEST_SCHEMA_REF,
    outputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    capabilities: ["research.ideation.prepare", "execution.grant.validate"],
    permissions: [],
    effect: "none",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_STAGE_COMPONENT_REF,
    kind: "nested-workflow",
    inputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    outputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    capabilities: ["research.ideation.idea-spark.stage.execute"],
    permissions: [...STAGE_PERMISSIONS],
    effect: "write-idempotent",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_PROVIDER_GATE_COMPONENT_REF,
    kind: "validator",
    inputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    outputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    capabilities: ["research.ideation.provider-status.verify"],
    permissions: [
      "filesystem.research-artifact.read",
      "filesystem.research-artifact.write"
    ],
    effect: "write-idempotent",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_RETRY_DECISION_COMPONENT_REF,
    kind: "validator",
    inputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    outputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    capabilities: ["research.ideation.retry-policy.decide"],
    permissions: [],
    effect: "none",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_TRANSITION_COMPONENT_REF,
    kind: "nested-workflow",
    inputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    outputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    capabilities: ["research.ideation.retry-policy.transition"],
    permissions: [
      "filesystem.research-artifact.read",
      "filesystem.research-artifact.write",
      "process.codex.exec"
    ],
    effect: "write-idempotent",
    supportsFanout: false
  },
  {
    schemaVersion: "summer.component-descriptor/v1",
    ref: IDEA_SPARK_VERIFY_COMPONENT_REF,
    kind: "validator",
    inputSchema: IDEA_SPARK_STATE_SCHEMA_REF,
    outputSchema: IDEA_SPARK_RESULT_SCHEMA_REF,
    capabilities: ["research.ideation.idea-spark.verify"],
    permissions: ["filesystem.research-artifact.read"],
    effect: "read",
    supportsFanout: false
  }
] as const satisfies readonly ComponentDescriptorV1[]);

export interface ResearchIdeationRegistryOptions {
  readonly driver?: IdeaSparkDriver;
  readonly bindExecutors?: boolean;
  readonly now?: () => Date;
}

export function registerResearchIdeationComponents(
  registry: ComponentRegistry,
  options: ResearchIdeationRegistryOptions = {}
): ComponentRegistry {
  for (const [index, descriptor] of RESEARCH_IDEATION_SCHEMA_DESCRIPTORS.entries()) {
    const binding = RESEARCH_IDEATION_SCHEMA_BINDINGS[index]?.[1];
    if (binding === undefined) {
      throw new Error(`missing schema binding for ${descriptor.ref.name}`);
    }
    registry.registerSchema(descriptor, binding);
  }
  for (const descriptor of RESEARCH_IDEATION_COMPONENT_DESCRIPTORS) {
    registry.registerDescriptor(descriptor);
  }

  if (options.bindExecutors !== false) {
    const driver = (): IdeaSparkDriver =>
      options.driver ?? new CodexIdeaSparkDriver();
    registry.bindExecutor(
      IDEA_SPARK_PREPARE_COMPONENT_REF,
      createPrepareExecutor(options.now ?? (() => new Date()))
    );
    registry.bindExecutor(
      IDEA_SPARK_STAGE_COMPONENT_REF,
      createStageExecutor(driver)
    );
    registry.bindExecutor(
      IDEA_SPARK_PROVIDER_GATE_COMPONENT_REF,
      providerGateExecutor
    );
    registry.bindExecutor(
      IDEA_SPARK_RETRY_DECISION_COMPONENT_REF,
      retryDecisionExecutor
    );
    registry.bindExecutor(
      IDEA_SPARK_TRANSITION_COMPONENT_REF,
      createTransitionExecutor(driver)
    );
    registry.bindExecutor(IDEA_SPARK_VERIFY_COMPONENT_REF, verifyExecutor);
  }
  return registry;
}

function createPrepareExecutor(now: () => Date): ComponentExecutor {
  return (input, context) =>
    prepareIdeaSparkRequest(input, context.runId, now()) as unknown as JsonValue;
}

function createStageExecutor(driver: () => IdeaSparkDriver): ComponentExecutor {
  return async (input, context) => {
    const state = IdeaSparkFlowStateV2Schema.parse(input);
    const stage = stageForNode(context.nodeId);
    if (stage === undefined) {
      throw new ResearchIdeationExecutionError(
        "UNKNOWN_IDEA_SPARK_STAGE_NODE",
        `node '${context.nodeId}' is not an Idea Spark stage node`
      );
    }
    return (await executeStage(state, stage, driver(), context)) as unknown as JsonValue;
  };
}

function createTransitionExecutor(driver: () => IdeaSparkDriver): ComponentExecutor {
  return async (input, context) => {
    const state = IdeaSparkFlowStateV2Schema.parse(input);
    const transition = transitionForNode(context.nodeId);
    if (transition === undefined) {
      throw new ResearchIdeationExecutionError(
        "UNKNOWN_IDEA_SPARK_TRANSITION_NODE",
        `node '${context.nodeId}' is not an Idea Spark transition node`
      );
    }
    return (await executeTransition(
      state,
      transition.stage,
      transition.requiredRoute,
      driver(),
      context
    )) as unknown as JsonValue;
  };
}

async function executeStage(
  input: IdeaSparkFlowStateV2,
  stage: IdeaSparkStage,
  driver: IdeaSparkDriver,
  context: ComponentExecutionContext
): Promise<IdeaSparkFlowStateV2> {
  const signal = grantBoundSignal(input, context.signal);
  let state = await withNavigator(input, driver, signal);
  const before = state.navigator as IdeaSparkNavigatorSnapshotV1;
  if (!shouldExecuteStage(stage, state)) {
    return appendNodeRun(state, nodeRun(context.nodeId, "stage", true, state.route, before, before));
  }

  ensureRunManifest(state.request);
  const advanced = await driver.advance(stage, state.request, signal, {
    nodeId: context.nodeId,
    attempt: context.attempt
  });
  validateStageBoundary(stage, advanced.snapshot);
  const route: IdeaSparkRoute =
    advanced.snapshot.category === "terminal"
      ? "terminal"
      : stage === "quality-gauntlet"
        ? "decide"
        : stage === "package-render"
          ? "terminal"
          : "continue";
  state = IdeaSparkFlowStateV2Schema.parse({
    ...state,
    navigator: advanced.snapshot,
    route
  });
  return appendNodeRun(
    state,
    nodeRun(
      context.nodeId,
      "stage",
      false,
      route,
      before,
      advanced.snapshot,
      advanced.workerMessagePath
    )
  );
}

async function executeTransition(
  input: IdeaSparkFlowStateV2,
  stage: IdeaSparkStage,
  requiredRoute: IdeaSparkRoute,
  driver: IdeaSparkDriver,
  context: ComponentExecutionContext
): Promise<IdeaSparkFlowStateV2> {
  const signal = grantBoundSignal(input, context.signal);
  const state = await withNavigator(input, driver, signal);
  const before = state.navigator as IdeaSparkNavigatorSnapshotV1;
  if (state.route !== requiredRoute) {
    return appendNodeRun(
      state,
      nodeRun(context.nodeId, "transition", true, state.route, before, before)
    );
  }
  const advanced = await driver.advance(stage, state.request, signal, {
    nodeId: context.nodeId,
    attempt: context.attempt
  });
  validateTransitionBoundary(stage, advanced.snapshot);
  const route: IdeaSparkRoute =
    advanced.snapshot.category === "terminal" ? "terminal" : "continue";
  const next = IdeaSparkFlowStateV2Schema.parse({
    ...state,
    navigator: advanced.snapshot,
    route
  });
  return appendNodeRun(
    next,
    nodeRun(
      context.nodeId,
      "transition",
      false,
      route,
      before,
      advanced.snapshot,
      advanced.workerMessagePath
    )
  );
}

const providerGateExecutor: ComponentExecutor = (input, context) => {
  const state = IdeaSparkFlowStateV2Schema.parse(input);
  assertIdeaSparkExecutionGrantActive(state.request.grant);
  const phase = context.nodeId === "phase0-provider-gate" ? "literature" : "collision";
  const precedingCoherenceRan = state.nodeRuns.some(
    (run) =>
      run.nodeId === context.nodeId.replace("-provider-gate", "-coherence-collision") &&
      !run.skipped
  );
  const alreadyChecked = state.providerStatuses.some(
    (status) => status.phase === phase
  );
  const navigator = state.navigator;
  const shouldRun =
    phase === "literature"
      ? !alreadyChecked
      : navigator?.terminalStatus === "do-not-generate"
        ? false
        : precedingCoherenceRan || !alreadyChecked;
  if (!shouldRun || navigator === undefined) {
    return appendNodeRun(
      state,
      nodeRun(
        context.nodeId,
        "provider-gate",
        true,
        state.route,
        navigator,
        navigator
      )
    ) as unknown as JsonValue;
  }

  const persisted = loadPersistedProviderStatuses(state, context.nodeId);
  const statuses =
    persisted ??
    inspectProviderStatuses(state.request.runDir, phase, context.nodeId);
  if (persisted === undefined) {
    persistProviderStatuses(state, context.nodeId, statuses);
  }
  verifyProviderPolicy(state, phase, statuses);
  const next = IdeaSparkFlowStateV2Schema.parse({
    ...state,
    providerStatuses: [...state.providerStatuses, ...statuses]
  });
  return appendNodeRun(
    next,
    nodeRun(
      context.nodeId,
      "provider-gate",
      false,
      next.route,
      navigator,
      navigator
    )
  ) as unknown as JsonValue;
};

const retryDecisionExecutor: ComponentExecutor = (input, context) => {
  const state = IdeaSparkFlowStateV2Schema.parse(input);
  assertIdeaSparkExecutionGrantActive(state.request.grant);
  const navigator = state.navigator;
  if (state.route !== "decide" || navigator === undefined) {
    return appendNodeRun(
      state,
      nodeRun(
        context.nodeId,
        "retry-decision",
        true,
        state.route,
        navigator,
        navigator
      )
    ) as unknown as JsonValue;
  }
  const route = routeFromNavigator(navigator);
  assertDecisionAllowed(context.nodeId, route);
  const next = IdeaSparkFlowStateV2Schema.parse({ ...state, route });
  return appendNodeRun(
    next,
    nodeRun(
      context.nodeId,
      "retry-decision",
      false,
      route,
      navigator,
      navigator
    )
  ) as unknown as JsonValue;
};

const verifyExecutor: ComponentExecutor = (input) =>
  verifyIdeaSparkState(input) as unknown as JsonValue;

export function verifyIdeaSparkState(input: unknown) {
  const state = IdeaSparkFlowStateV2Schema.parse(input);
  assertIdeaSparkExecutionGrantActive(state.request.grant);
  const navigator = state.navigator;
  if (
    navigator === undefined ||
    navigator.category !== "terminal" ||
    navigator.terminalStatus === undefined ||
    state.route !== "terminal"
  ) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_TERMINAL_MISMATCH",
      "flow state and navigator do not agree on a terminal state"
    );
  }
  if (!state.providerStatuses.some(({ phase }) => phase === "literature")) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_PROVIDER_STATUS_MISSING",
      "terminal verification requires a successful literature provider gate"
    );
  }
  if (
    navigator.terminalStatus !== "do-not-generate" &&
    !state.providerStatuses.some(({ phase }) => phase === "collision")
  ) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_PROVIDER_STATUS_MISSING",
      "terminal verification requires a successful collision provider gate"
    );
  }

  const artifacts = expectedArtifacts(
    state.request.runDir,
    navigator.terminalStatus
  ).map(({ artifactId, uri }) => digestArtifact(artifactId, uri));

  return IdeaSparkResultV2Schema.parse({
    schemaVersion: "summer.research-ideation-result/v2",
    status: navigator.terminalStatus,
    requestDigest: state.request.requestDigest,
    invocationId: state.request.invocationId,
    grantDigest: state.request.grantDigest,
    runDir: state.request.runDir,
    navigator,
    nodeRuns: state.nodeRuns,
    providerStatuses: state.providerStatuses,
    artifacts
  });
}

function stageForNode(nodeId: string): IdeaSparkStage | undefined {
  if (nodeId === "literature-grounding") return "literature-grounding";
  if (nodeId === "bottleneck-diagnosis" || nodeId === "bottleneck-rediagnosis") {
    return "bottleneck-diagnosis";
  }
  if (nodeId.endsWith("-generation")) return "candidate-generation";
  if (nodeId.endsWith("-coherence-collision")) return "coherence-collision";
  if (nodeId.endsWith("-gauntlet")) return "quality-gauntlet";
  if (nodeId === "package-render") return "package-render";
  return undefined;
}

function transitionForNode(nodeId: string):
  | { readonly stage: IdeaSparkStage; readonly requiredRoute: IdeaSparkRoute }
  | undefined {
  if (nodeId === "candidate-2-transition" || nodeId === "candidate-3-transition") {
    return {
      stage: "candidate-retry-transition",
      requiredRoute: "retry-candidate"
    };
  }
  if (nodeId === "bottleneck-retry-transition") {
    return {
      stage: "bottleneck-retry-transition",
      requiredRoute: "retry-bottleneck"
    };
  }
  if (nodeId === "finalize-failure") {
    return { stage: "finalize-failure", requiredRoute: "finalize-failure" };
  }
  return undefined;
}

async function withNavigator(
  state: IdeaSparkFlowStateV2,
  driver: IdeaSparkDriver,
  signal?: AbortSignal
): Promise<IdeaSparkFlowStateV2> {
  if (state.navigator !== undefined) return state;
  ensureRunManifest(state.request);
  ensureInvocationManifest(state.request);
  const navigator = await driver.inspect(state.request, signal);
  return IdeaSparkFlowStateV2Schema.parse({
    ...state,
    navigator,
    route: navigator.category === "terminal" ? "terminal" : state.route
  });
}

function grantBoundSignal(
  state: IdeaSparkFlowStateV2,
  outerSignal?: AbortSignal
): AbortSignal {
  assertIdeaSparkExecutionGrantActive(state.request.grant);
  const remainingMs = Date.parse(state.request.grant.expiresAt) - Date.now();
  const expirySignal = AbortSignal.timeout(Math.min(remainingMs, 2_147_483_647));
  return outerSignal === undefined
    ? expirySignal
    : AbortSignal.any([outerSignal, expirySignal]);
}

function shouldExecuteStage(
  stage: IdeaSparkStage,
  state: IdeaSparkFlowStateV2
): boolean {
  const category = state.navigator?.category;
  if (category === undefined || category === "terminal") return false;
  if (state.route !== "continue" && !(stage === "package-render" && state.route === "package")) {
    return false;
  }
  switch (stage) {
    case "literature-grounding":
      return category === "phase0";
    case "bottleneck-diagnosis":
      return category === "phase1";
    case "candidate-generation":
      return category === "phase2-generation";
    case "coherence-collision":
      return category === "phase2-coherence";
    case "quality-gauntlet":
      return category === "phase3";
    case "package-render":
      return category === "phase4";
    default:
      return false;
  }
}

function validateStageBoundary(
  stage: IdeaSparkStage,
  snapshot: IdeaSparkNavigatorSnapshotV1
): void {
  if (snapshot.category === "terminal") return;
  const expected: Readonly<Record<string, readonly string[]>> = {
    "literature-grounding": ["phase1"],
    "bottleneck-diagnosis": ["phase2-generation"],
    "candidate-generation": ["phase2-coherence"],
    "coherence-collision": ["phase3"],
    "quality-gauntlet": ["phase3", "phase4"],
    "package-render": []
  };
  if (!(expected[stage] ?? []).includes(snapshot.category)) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_STAGE_BOUNDARY_VIOLATION",
      `stage '${stage}' stopped at '${snapshot.category}'`,
      { state: snapshot.state, step: snapshot.step }
    );
  }
  if (stage === "quality-gauntlet" && snapshot.category === "phase3") {
    routeFromNavigator(snapshot);
  }
}

function validateTransitionBoundary(
  stage: IdeaSparkStage,
  snapshot: IdeaSparkNavigatorSnapshotV1
): void {
  const expected =
    stage === "candidate-retry-transition"
      ? "phase2-generation"
      : stage === "bottleneck-retry-transition"
        ? "phase1"
        : "terminal";
  if (snapshot.category !== expected) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_TRANSITION_BOUNDARY_VIOLATION",
      `transition '${stage}' stopped at '${snapshot.category}', expected '${expected}'`,
      { state: snapshot.state, step: snapshot.step }
    );
  }
}

function routeFromNavigator(snapshot: IdeaSparkNavigatorSnapshotV1): IdeaSparkRoute {
  if (snapshot.category === "terminal") return "terminal";
  if (snapshot.category === "phase4") return "package";
  if (snapshot.category !== "phase3") {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_RETRY_DECISION_INVALID",
      `cannot make a retry decision from navigator category '${snapshot.category}'`
    );
  }
  const text = `${snapshot.state}\n${snapshot.step}`.toLowerCase();
  if (text.includes("re-diagnose") || text.includes("bottleneck-level retry")) {
    return "retry-bottleneck";
  }
  if (
    text.includes("archive attempt") &&
    (text.includes("regenerate") || text.includes("retry"))
  ) {
    return "retry-candidate";
  }
  if (
    text.includes("write phase_3_failed") ||
    text.includes("phase_3_failed.md") ||
    text.includes("retry budget exhausted")
  ) {
    return "finalize-failure";
  }
  throw new ResearchIdeationExecutionError(
    "IDEA_SPARK_RETRY_DECISION_UNKNOWN",
    "Idea Spark gauntlet did not expose a declared retry, package, or terminal action",
    { state: snapshot.state, step: snapshot.step }
  );
}

function assertDecisionAllowed(nodeId: string, route: IdeaSparkRoute): void {
  const allowed =
    nodeId === "candidate-1-retry-decision"
      ? ["retry-candidate", "package", "finalize-failure", "terminal"]
      : nodeId === "candidate-2-retry-decision"
        ? [
            "retry-candidate",
            "retry-bottleneck",
            "package",
            "finalize-failure",
            "terminal"
          ]
        : nodeId === "candidate-3-retry-decision"
          ? ["retry-bottleneck", "package", "finalize-failure", "terminal"]
          : ["package", "finalize-failure", "terminal"];
  if (!allowed.includes(route)) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_RETRY_BUDGET_VIOLATION",
      `decision node '${nodeId}' cannot route to '${route}'`
    );
  }
}

function inspectProviderStatuses(
  runDir: string,
  phase: "literature" | "collision",
  gateNodeId: string
): readonly IdeaSparkProviderStatusV1[] {
  const root =
    phase === "literature"
      ? resolve(runDir, "phase0")
      : resolve(runDir, "phase3_collision");
  const degraded = readDegradedProviders(resolve(root, ".connectors_degraded"));
  const observedAt = new Date().toISOString();
  return IDEA_SPARK_PROVIDERS.map((provider) => {
    const expectedPaths = providerEvidencePaths(root, phase, provider);
    const inspected = expectedPaths.map(inspectProviderEvidence);
    const paths = expectedPaths.filter(existsSync);
    const invalid = inspected.some(({ observation }) => observation.state === "invalid");
    const evidence = inspected.flatMap(({ evidence }) =>
      evidence === undefined ? [] : [evidence]
    );
    const observations = inspected.map(({ observation }) => observation);
    const recordCount = evidence.reduce(
      (total, item) => total + item.recordCount,
      0
    );
    const state =
      invalid
        ? "invalid"
        : recordCount > 0
        ? "succeeded"
        : paths.length > 0
          ? "empty"
          : degraded.has(provider)
            ? "unavailable"
            : "unknown";
    const diagnosticCode =
      state === "succeeded"
        ? "positive-evidence"
        : state === "empty"
          ? "empty-evidence"
          : state === "invalid"
            ? "invalid-evidence"
            : state === "unavailable"
              ? "connector-declared-unavailable"
              : "no-evidence";
    const diagnosticMessage =
      state === "succeeded"
        ? `${provider} produced ${recordCount} parseable record(s)`
        : state === "empty"
          ? `${provider} evidence files parsed successfully but contained zero records; Idea Spark did not persist a transport-level cause`
          : state === "invalid"
            ? `${provider} produced at least one unreadable or invalid JSON evidence file`
            : state === "unavailable"
              ? `${provider} was listed as skipped in Idea Spark's .connectors_degraded marker; no transport-level cause was persisted`
              : `${provider} produced no evidence file and was not listed in Idea Spark's degraded-provider marker`;
    return IdeaSparkProviderStatusV1Schema.parse({
      schemaVersion: "summer.idea-spark-provider-status/v1",
      gateNodeId,
      phase,
      provider,
      state,
      recordCount,
      evidencePaths: paths,
      evidence,
      diagnosticCode,
      diagnosticMessage,
      observations,
      observedAt
    });
  });
}

function providerEvidencePaths(
  root: string,
  phase: "literature" | "collision",
  provider: IdeaSparkProvider
): readonly string[] {
  if (phase === "literature") {
    const jobs: Readonly<Record<IdeaSparkProvider, readonly string[]>> = {
      arxiv: ["arxiv_phase0.json"],
      openalex: ["oa_recent_phase0.json", "openalex_phase0.json"],
      openreview: ["openreview_phase0.json"],
      semanticscholar: ["ss_recent_phase0.json", "semanticscholar_phase0.json"]
    };
    return jobs[provider].map((name) => resolve(root, name));
  }
  return [
    resolve(root, `${provider}_collision.json`),
    resolve(root, `${provider}_alias_collision.json`)
  ];
}

function readDegradedProviders(path: string): ReadonlySet<string> {
  if (!existsSync(path)) return new Set();
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { skipped?: unknown };
    return new Set(
      Array.isArray(value.skipped)
        ? value.skipped.filter((item): item is string => typeof item === "string")
        : []
    );
  } catch {
    return new Set(IDEA_SPARK_PROVIDERS);
  }
}

interface ProviderEvidenceInspection {
  readonly observation: {
    readonly uri: string;
    readonly state: "missing" | "parsed" | "invalid";
    readonly byteLength?: number;
    readonly recordCount?: number;
    readonly error?: string;
  };
  readonly evidence?: {
    readonly uri: string;
    readonly digest: string;
    readonly recordCount: number;
  };
}

function inspectProviderEvidence(path: string): ProviderEvidenceInspection {
  if (!existsSync(path)) {
    return { observation: { uri: path, state: "missing" } };
  }
  try {
    const content = readFileSync(path);
    const value = JSON.parse(content.toString("utf8")) as unknown;
    let recordCount = 0;
    if (Array.isArray(value)) recordCount = value.length;
    if (typeof value === "object" && value !== null) {
      for (const key of ["results", "papers", "hits"] as const) {
        const candidate = (value as Record<string, unknown>)[key];
        if (Array.isArray(candidate)) {
          recordCount = candidate.length;
          break;
        }
      }
    }
    return {
      observation: {
        uri: path,
        state: "parsed",
        byteLength: content.byteLength,
        recordCount
      },
      evidence: {
        uri: path,
        digest: createHash("sha256").update(content).digest("hex"),
        recordCount
      }
    };
  } catch (error) {
    return {
      observation: {
        uri: path,
        state: "invalid",
        byteLength: statSync(path).size,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function verifyProviderPolicy(
  state: IdeaSparkFlowStateV2,
  phase: "literature" | "collision",
  statuses: readonly IdeaSparkProviderStatusV1[]
): void {
  const requirement = state.request.grant.providerPolicy[phase];
  const byProvider = new Map(statuses.map((status) => [status.provider, status]));
  const failedRequired = requirement.requiredProviders.filter(
    (provider) => byProvider.get(provider)?.state !== "succeeded"
  );
  const succeeded = statuses.filter(({ state: providerState }) => providerState === "succeeded");
  const bibliographicSucceeded = succeeded.some(({ provider }) =>
    provider === "openalex" || provider === "semanticscholar"
  );
  if (
    failedRequired.length > 0 ||
    succeeded.length < requirement.minimumSuccessfulProviders ||
    (requirement.requireBibliographicProvider && !bibliographicSucceeded)
  ) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_PROVIDER_POLICY_FAILED",
      `${phase} provider evidence did not satisfy the typed execution grant`,
      {
        failedRequired,
        minimumSuccessfulProviders: requirement.minimumSuccessfulProviders,
        requireBibliographicProvider: requirement.requireBibliographicProvider,
        statuses
      }
    );
  }
}

function persistProviderStatuses(
  state: IdeaSparkFlowStateV2,
  gateNodeId: string,
  statuses: readonly IdeaSparkProviderStatusV1[]
): void {
  const directory = resolve(
    state.request.runDir,
    ".summer",
    "provider-status",
    state.request.invocationId
  );
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${gateNodeId}.json`);
  const document = {
    schemaVersion: "summer.idea-spark-provider-status-set/v1",
    requestDigest: state.request.requestDigest,
    invocationId: state.request.invocationId,
    gateNodeId,
    statuses
  };
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (canonicalJson(existing) !== canonicalJson(document)) {
      throw new ResearchIdeationExecutionError(
        "IDEA_SPARK_PROVIDER_STATUS_CONFLICT",
        `provider status artifact '${path}' already contains different evidence`
      );
    }
    return;
  }
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
}

function loadPersistedProviderStatuses(
  state: IdeaSparkFlowStateV2,
  gateNodeId: string
): readonly IdeaSparkProviderStatusV1[] | undefined {
  const path = resolve(
    state.request.runDir,
    ".summer",
    "provider-status",
    state.request.invocationId,
    `${gateNodeId}.json`
  );
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_PROVIDER_STATUS_INVALID",
      `provider status artifact '${path}' is not valid JSON`,
      { message: error instanceof Error ? error.message : String(error) }
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_PROVIDER_STATUS_INVALID",
      `provider status artifact '${path}' is not an object`
    );
  }
  const document = parsed as Record<string, unknown>;
  if (
    document.requestDigest !== state.request.requestDigest ||
    document.invocationId !== state.request.invocationId ||
    document.gateNodeId !== gateNodeId ||
    !Array.isArray(document.statuses)
  ) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_PROVIDER_STATUS_CONFLICT",
      `provider status artifact '${path}' is bound to a different invocation or gate`
    );
  }
  return document.statuses.map((status) =>
    IdeaSparkProviderStatusV1Schema.parse(status)
  );
}

function nodeRun(
  nodeId: string,
  kind: IdeaSparkNodeRunV2["kind"],
  skipped: boolean,
  route: IdeaSparkRoute,
  before?: IdeaSparkNavigatorSnapshotV1,
  after?: IdeaSparkNavigatorSnapshotV1,
  workerMessagePath?: string
): IdeaSparkNodeRunV2 {
  return {
    schemaVersion: "summer.idea-spark-node-run/v2",
    nodeId,
    kind,
    skipped,
    route,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(workerMessagePath === undefined ? {} : { workerMessagePath })
  };
}

function appendNodeRun(
  state: IdeaSparkFlowStateV2,
  run: IdeaSparkNodeRunV2
): IdeaSparkFlowStateV2 {
  return IdeaSparkFlowStateV2Schema.parse({
    ...state,
    nodeRuns: [...state.nodeRuns, run]
  });
}

function expectedArtifacts(
  runDir: string,
  status: IdeaSparkTerminalStatus
): readonly { readonly artifactId: string; readonly uri: string }[] {
  if (status === "done") {
    return [
      { artifactId: "idea-std-zh", uri: resolve(runDir, "phase4", "idea.std.zh.md") },
      { artifactId: "idea-std-en", uri: resolve(runDir, "phase4", "idea.std.en.md") },
      { artifactId: "idea-detail-en", uri: resolve(runDir, "phase4", "idea.detail.en.md") }
    ];
  }
  if (status === "do-not-generate") {
    return [
      { artifactId: "do-not-generate", uri: resolve(runDir, "do_not_generate.md") }
    ];
  }
  return [
    { artifactId: "phase-3-failed", uri: resolve(runDir, "phase_3_failed.md") }
  ];
}

function digestArtifact(artifactId: string, uri: string): IdeaSparkArtifactV1 {
  let content: Buffer;
  try {
    const stat = statSync(uri);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error("artifact is not a non-empty regular file");
    }
    content = readFileSync(uri);
  } catch (error) {
    throw new ResearchIdeationExecutionError(
      "IDEA_SPARK_ARTIFACT_INVALID",
      `required terminal artifact '${uri}' is missing or invalid`,
      { message: error instanceof Error ? error.message : String(error) }
    );
  }
  return {
    artifactId,
    uri,
    digest: createHash("sha256").update(content).digest("hex"),
    mediaType: "text/markdown"
  };
}

export type { IdeaSparkDriver } from "./driver.js";
