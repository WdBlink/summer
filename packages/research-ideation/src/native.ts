import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { ComponentRegistry } from "@summer/components";
import { sha256Canonical, type JsonValue } from "@summer/protocol";
import { z } from "zod";
import { IdeaSparkFlowStateV2Schema, IdeaSparkRequestV2Schema, IdeaSparkResultV2Schema, prepareIdeaSparkRequest } from "./contracts.js";
import { registerResearchIdeationComponents, type ResearchIdeationRegistryOptions } from "./registry.js";
import { ensureInvocationManifest, ensureRunManifest } from "./driver.js";

const State = z.object({ flow: IdeaSparkFlowStateV2Schema, candidate: z.number().int().min(1).max(4) });
type State = z.infer<typeof State>;

/** v4 uses native branches and a bounded loop. v3 runs are never migrated. */
export async function runNativeResearch(input: unknown, options: ResearchIdeationRegistryOptions & { resume?: boolean; pauseAfter?: number } = {}) {
  const request = IdeaSparkRequestV2Schema.parse(input);
  const prepared = prepareIdeaSparkRequest(request, randomUUID());
  const directory = resolve(request.runDir, ".summer", "native-v4");
  mkdirSync(directory, { recursive: true });
  const lock = resolve(directory, "lock");
  try { mkdirSync(lock); } catch { throw new Error("RESEARCH_RUN_LOCKED"); }
  let storage: LibSQLStore | undefined;
  try {
    const grantsPath = resolve(directory, "grants.jsonl");
    const priorGrants = existsSync(grantsPath) ? readFileSync(grantsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { grantId: string }) : [];
    if (priorGrants.some((value) => value.grantId === request.executionGrant.grantId)) throw new Error("RESEARCH_GRANT_REUSED");
    appendFileSync(grantsPath, JSON.stringify({ grantId: request.executionGrant.grantId, invocationId: prepared.request.invocationId }) + "\n");
    ensureRunManifest(prepared.request);
    ensureInvocationManifest(prepared.request);
    const manifestPath = resolve(directory, "identity.json");
    const identity = { requestDigest: prepared.request.requestDigest, version: 4 };
    let runId: string;
    if (options.resume) {
      const prior = JSON.parse(readFileSync(manifestPath, "utf8")) as { requestDigest: string; runId: string; version: number };
      if (prior.requestDigest !== identity.requestDigest || prior.version !== 4) throw new Error("RESEARCH_RESUME_IDENTITY_MISMATCH");
      runId = prior.runId;
    } else {
      if (existsSync(manifestPath)) throw new Error("RESEARCH_RUN_EXISTS");
      runId = randomUUID();
      writeFileSync(manifestPath, JSON.stringify({ ...identity, runId }), { flag: "wx" });
    }
    const registry = registerResearchIdeationComponents(new ComponentRegistry(), options);
    let completed = 0;
    const journal = resolve(directory, "events.jsonl");
    const emit = (value: unknown) => appendFileSync(journal, JSON.stringify({ invocationId: prepared.request.invocationId, at: new Date().toISOString(), event: value }) + "\n");
    const step = (id: string, component: string, nodeId: (state: State) => string = () => id) => createStep({
      id, inputSchema: State, outputSchema: State,
      execute: async ({ inputData, suspend }) => {
        if (options.pauseAfter && completed >= options.pauseAfter) return await suspend({ step: id });
        const state: State = { ...inputData, flow: { ...inputData.flow, request: prepared.request } };
        if (id === "decide" && state.flow.route === "decide" && state.flow.navigator?.retryDecision === undefined) throw new Error("TYPED_RESEARCH_DECISION_REQUIRED");
        const exactId = nodeId(state);
        const context = { workflowId: "research-ideation", workflowRevision: 4, runId: prepared.request.invocationId, nodeId: exactId, attempt: 1 };
        emit({ kind: "started", nodeId: exactId, candidate: state.candidate });
        try {
          const result = await registry.resolveExecutor({ namespace: "researchstudio", name: component, version: "2.0.0" })(state.flow as unknown as JsonValue, context);
          const flow = IdeaSparkFlowStateV2Schema.parse(result);
          emit({ kind: "completed", nodeId: exactId, outputDigest: sha256Canonical(result) });
          completed++;
          return { ...state, flow };
        } catch (error) { emit({ kind: "failed", nodeId: exactId, error: String(error) }); throw error; }
      }
    });
    const stage = "idea-spark-stage", transition = "idea-spark-transition";
    const prefix = (state: State) => state.candidate <= 3 ? `candidate-${state.candidate}` : "bottleneck-retry";
    const nextCandidate = createStep({ id: "advance-candidate", inputSchema: State, outputSchema: State, execute: async ({ inputData }) => ({ ...inputData, candidate: inputData.candidate + 1 }) });
    const markRediagnosed = createStep({ id: "mark-rediagnosed", inputSchema: State, outputSchema: State, execute: async ({ inputData }) => ({ ...inputData, candidate: 4 }) });
    const retry = createWorkflow({ id: "research-candidate-retry-v4", inputSchema: State, outputSchema: State })
      .then(step("candidate-retry", transition, (state) => `candidate-${state.candidate + 1}-transition`)).then(nextCandidate).commit();
    const rediagnose = createWorkflow({ id: "research-rediagnose-v4", inputSchema: State, outputSchema: State })
      .then(step("bottleneck-retry-transition", transition)).then(step("bottleneck-rediagnosis", stage)).then(markRediagnosed).commit();
    const pass = createStep({ id: "round-finished", inputSchema: State, outputSchema: State, execute: async ({ inputData }) => inputData });
    const round = createWorkflow({ id: "research-candidate-v4", inputSchema: State, outputSchema: State })
      .then(step("generate", stage, (state) => `${prefix(state)}-generation`))
      .then(step("coherence", stage, (state) => `${prefix(state)}-coherence-collision`))
      .then(step("provider-gate", "idea-spark-provider-gate", (state) => `${prefix(state)}-provider-gate`))
      .then(step("gauntlet", stage, (state) => `${prefix(state)}-gauntlet`))
      .then(step("decide", "idea-spark-retry-decision", (state) => `${prefix(state)}-retry-decision`))
      .branch([
        [async ({ inputData }) => inputData.flow.route === "retry-candidate", Object.assign(retry, { description: "Retry candidate", metadata: {} })],
        [async ({ inputData }) => inputData.flow.route === "retry-bottleneck", Object.assign(rediagnose, { description: "Rediagnose bottleneck", metadata: {} })],
        [async ({ inputData }) => !["retry-candidate", "retry-bottleneck"].includes(inputData.flow.route), pass]
      ])
      .map(async ({ inputData }) => State.parse(Object.values(inputData).find(Boolean))).commit();
    const packageStep = step("package-render", stage);
    const failureStep = step("finalize-failure", transition);
    const terminal = createStep({ id: "already-terminal", inputSchema: State, outputSchema: State, execute: async ({ inputData }) => inputData });
    const verify = createStep({ id: "verify-terminal", inputSchema: State, outputSchema: IdeaSparkResultV2Schema,
      execute: async ({ inputData }) => IdeaSparkResultV2Schema.parse(await registry.resolveExecutor({ namespace: "researchstudio", name: "idea-spark-verify", version: "2.0.0" })({ ...inputData.flow, request: prepared.request } as unknown as JsonValue, { workflowId: "research-ideation", workflowRevision: 4, runId: prepared.request.invocationId, nodeId: "verify-terminal", attempt: 1 })) });
    const workflow = createWorkflow({ id: "research-ideation-v4", inputSchema: State, outputSchema: IdeaSparkResultV2Schema })
      .then(step("literature-grounding", stage)).then(step("phase0-provider-gate", "idea-spark-provider-gate"))
      .then(step("bottleneck-diagnosis", stage))
      .dowhile(Object.assign(round, { description: "Bounded candidate round", metadata: {} }), async ({ inputData }) => inputData.flow.route === "continue" && inputData.flow.navigator?.category !== "terminal")
      .branch([
        [async ({ inputData }) => inputData.flow.route === "package", packageStep],
        [async ({ inputData }) => inputData.flow.route === "finalize-failure", failureStep],
        [async ({ inputData }) => inputData.flow.route === "terminal", terminal]
      ])
      .map(async ({ inputData }) => State.parse(Object.values(inputData).find(Boolean)))
      .then(verify).commit();
    storage = new LibSQLStore({ id: "summer-research-v4", url: `file:${resolve(directory, "mastra.db")}` });
    const mastra = new Mastra({ storage, workflows: { "research-ideation-v4": workflow } });
    const bound = mastra.getWorkflow("research-ideation-v4");
    const run = await bound.createRun({ runId });
    if (options.resume && (await bound.getWorkflowRunById(runId))?.status !== "suspended") throw new Error("RESEARCH_RESUME_REQUIRES_SUSPENDED_CHECKPOINT");
    const result = options.resume ? await run.resume({ resumeData: {} }) : await run.start({ inputData: { flow: prepared, candidate: 1 } });
    if (result.status !== "success" && result.status !== "suspended") throw new Error(`RESEARCH_NATIVE_${result.status}`);
    return { status: result.status, runId, version: 4, result: result.status === "success" ? result.result : null, journal };
  } finally { try { await storage?.close(); } finally { rmSync(lock, { recursive: true }); } }
}
