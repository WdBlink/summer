import { existsSync, mkdirSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { Mastra } from "@mastra/core/mastra";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { loadProduct } from "./product-library.js";
import { digest, executeProduct, ProductGrantSchema, readJson, saveJson, resolveWorkspacePath, type ProductRunner } from "./products.js";

const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const Frozen = z.object({ dataDigest: Fingerprint, environmentDigest: Fingerprint, evaluatorDigest: Fingerprint, baselineDigest: Fingerprint }).strict();
const Params = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]));
export const QuantPlanSchema = z.object({
  schemaVersion: z.literal("summer.quant-loop/v2"), mode: z.literal("offline-research"),
  frozen: Frozen, baselineScore: z.number().finite(), baselineParameters: Params,
  minImprovement: z.number().positive(), maxNonImproving: z.number().int().min(1).max(64),
  maxCalls: z.number().int().min(1).max(64),
  pauseAfter: z.number().int().positive().optional(),
  candidates: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), workflow: z.string().regex(/^[a-z][a-z0-9-]*@[1-9][0-9]*$/), input: z.record(z.string(), z.string().min(1)), parameters: Params, evaluationArtifact: z.string().min(1) }).strict()).min(1).max(64)
}).strict().superRefine((plan, ctx) => {
  if (new Set(plan.candidates.map((candidate) => candidate.id)).size !== plan.candidates.length) ctx.addIssue({ code: "custom", message: "candidate identities must be unique" });
  for (const candidate of plan.candidates) {
    const keys = new Set([...Object.keys(plan.baselineParameters), ...Object.keys(candidate.parameters)]);
    const changed = [...keys].filter((key) => plan.baselineParameters[key] !== candidate.parameters[key]);
    if (changed.length !== 1) ctx.addIssue({ code: "custom", message: `${candidate.id} must change exactly one baseline parameter` });
  }
});
const Evaluation = z.object({
  experimentId: z.string(), frozen: Frozen, parametersDigest: Fingerprint,
  split: z.literal("validation"), score: z.number().finite(), gatesPassed: z.boolean(),
  evidenceDigest: Fingerprint
}).strict();
const State = z.object({ index: z.number().int(), bestScore: z.number(), bestId: z.string().nullable(), nonImproving: z.number().int(), calls: z.number().int(), stopReason: z.string().nullable(), history: z.array(z.object({ id: z.string(), score: z.number().nullable(), decision: z.enum(["improved", "rejected", "repair-required"]), evidenceDigest: z.string().optional() })) });

/** Executes predeclared candidate experiments, never trades or optimizes on holdout.
 * The caller must supply published backtest workflows; this is not an alpha claim. */
export async function runQuantLoop(root: string, planValue: unknown, grantValue: unknown, options: { runner?: ProductRunner; resume?: boolean; pauseAfter?: number } = {}) {
  const plan = QuantPlanSchema.parse(planValue), grant = ProductGrantSchema.parse(grantValue);
  // Resolve all exact definitions before any experiment starts.
  const products = plan.candidates.map((candidate) => loadProduct(root, candidate.workflow));
  const parent = realpathSync(grant.workspaceDir);
  const directory = resolveWorkspacePath(parent, relative(resolve(grant.workspaceDir), resolve(grant.runDir, ".summer-quant")));
  if (Date.now() >= Date.parse(grant.expiresAt) || Date.now() < Date.parse(grant.issuedAt)) throw new Error("GRANT_INACTIVE");
  mkdirSync(directory, { recursive: true });
  const lock = resolve(directory, "lock");
  try { mkdirSync(lock); } catch { throw new Error("QUANT_RUN_LOCKED"); }
  let storage: LibSQLStore | undefined;
  try {
    const path = resolve(directory, "plan.json");
    const definitions = products.map(digest);
    const frozenIdentity = { plan, definitions, workspaceDir: parent, runDir: resolve(grant.runDir) };
    let runId: string;
    if (options.resume) {
      const saved = readJson(path) as { identity: typeof frozenIdentity; digest: string; runId: string };
      if (saved.digest !== digest(saved.identity) || saved.digest !== digest(frozenIdentity)) throw new Error("QUANT_RESUME_IDENTITY_MISMATCH");
      runId = saved.runId;
    } else {
      if (existsSync(path)) throw new Error("QUANT_RUN_EXISTS: inspect or resume the existing campaign");
      runId = randomUUID();
      saveJson(path, { identity: frozenIdentity, digest: digest(frozenIdentity), runId });
    }
    const grantPath = resolve(directory, "grants.json");
    const grants = existsSync(grantPath) ? z.array(z.string()).parse(readJson(grantPath)) : [];
    if (grants.includes(grant.grantId)) throw new Error("QUANT_GRANT_REUSED");
    saveJson(grantPath, [...grants, grant.grantId]);
    let completed = 0;
    let latest = State.parse({ index: 0, bestScore: plan.baselineScore, bestId: null, nonImproving: 0, calls: 0, stopReason: null, history: [] });
    const round = createStep({ id: "experiment-and-decision", inputSchema: State, outputSchema: State,
      execute: async ({ inputData, suspend }) => {
        latest = inputData;
        const pauseAfter = options.pauseAfter ?? plan.pauseAfter;
        if (pauseAfter && completed >= pauseAfter) return await suspend({ reason: "requested-pause", nextExperiment: inputData.index });
        const candidate = plan.candidates[inputData.index];
        if (!candidate) return { ...inputData, stopReason: "candidate-plan-exhausted" };
        if (Date.now() >= Date.parse(grant.expiresAt)) return { ...inputData, stopReason: "grant-expired" };
        const remaining = Math.min(plan.maxCalls, grant.maxCalls) - inputData.calls;
        if (remaining <= 0) return { ...inputData, stopReason: "budget-exhausted" };
        const runDir = resolve(grant.runDir, "experiments", candidate.id);
        const childGrant = { ...grant, runDir, maxCalls: remaining, grantId: `experiment-${candidate.id}` };
        const eventPath = resolve(runDir, ".summer-v2/events.jsonl");
        const used = () => existsSync(eventPath) ? readFileSync(eventPath, "utf8").trim().split("\n").filter((line) => (JSON.parse(line) as { kind: string }).kind === "call-started").length : 0;
        try {
          // Resuming the parent advances to a new experiment, not a resumed child.
          const result = await executeProduct(products[inputData.index], { input: candidate.input, grant: childGrant }, options.runner ? { runner: options.runner } : {});
          if (result.status !== "accepted" || !("artifacts" in result)) throw new Error("EXPERIMENT_NOT_ACCEPTED");
          const artifact = result.artifacts.find((item) => item.path === resolveWorkspacePath(parent, candidate.evaluationArtifact));
          if (!artifact) throw new Error("EVALUATION_ARTIFACT_NOT_ACCEPTED");
          const evaluation = Evaluation.parse(readJson(artifact.path));
          if (evaluation.experimentId !== candidate.id || digest(evaluation.frozen) !== digest(plan.frozen) || evaluation.parametersDigest !== digest(candidate.parameters)) throw new Error("EXPERIMENT_NOT_COMPARABLE");
          const improved = evaluation.gatesPassed && evaluation.score >= inputData.bestScore + plan.minImprovement;
          const nonImproving = improved ? 0 : inputData.nonImproving + 1;
          const next = {
            index: inputData.index + 1,
            bestScore: improved ? evaluation.score : inputData.bestScore,
            bestId: improved ? candidate.id : inputData.bestId, nonImproving,
            calls: inputData.calls + used(),
            stopReason: nonImproving >= plan.maxNonImproving ? "no-material-improvement" : null,
            history: [...inputData.history, { id: candidate.id, score: evaluation.score, decision: improved ? "improved" as const : "rejected" as const, evidenceDigest: evaluation.evidenceDigest }]
          };
          saveJson(resolve(directory, `experiment-${candidate.id}.json`), { evaluation, decision: next.history.at(-1), artifactDigest: artifact.digest });
          completed++;
          return next;
        } catch (error) {
          saveJson(resolve(directory, `experiment-${candidate.id}.failure.json`), { error: String(error), classification: "repair-required", updatesResearchBelief: false });
          return { ...inputData, index: inputData.index + 1, calls: inputData.calls + used(), stopReason: "repair-required", history: [...inputData.history, { id: candidate.id, score: null, decision: "repair-required" as const }] };
        }
      }
    });
    const workflow = createWorkflow({ id: "quant-factor-tuning-v2", inputSchema: State, outputSchema: State }).dowhile(round, async ({ inputData }) => inputData.stopReason === null && inputData.index < plan.candidates.length).commit();
    storage = new LibSQLStore({ id: "summer-quant", url: `file:${resolve(directory, "mastra.db")}` });
    const mastra = new Mastra({ storage, workflows: { "quant-factor-tuning-v2": workflow } });
    const bound = mastra.getWorkflow("quant-factor-tuning-v2");
    const run = await bound.createRun({ runId });
    if (options.resume && (await bound.getWorkflowRunById(runId))?.status !== "suspended") throw new Error("QUANT_RESUME_REQUIRES_SUSPENDED_CHECKPOINT");
    const execution = options.resume ? await run.resume({ resumeData: {} }) : await run.start({ inputData: latest });
    if (execution.status === "suspended") {
      const result = { ...latest, status: "suspended", mode: "offline-research", liveTrading: false };
      saveJson(resolve(directory, "result.json"), result);
      return result;
    }
    if (execution.status !== "success") throw new Error("QUANT_LOOP_EXECUTION_FAILED");
    const result = { ...execution.result, status: "completed", stopReason: execution.result.stopReason ?? "candidate-plan-exhausted", mode: "offline-research", liveTrading: false };
    saveJson(resolve(directory, "result.json"), result);
    return result;
  } finally { try { await storage?.close(); } finally { rmSync(lock, { recursive: true }); } }
}

export async function resumeQuantLoop(root: string, runDir: string, grant: unknown) {
  const saved = readJson(resolve(runDir, ".summer-quant/plan.json")) as { identity: { plan: unknown; runDir: string } };
  if (resolve(saved.identity.runDir) !== resolve(runDir)) throw new Error("QUANT_RESUME_SCOPE_MISMATCH");
  return runQuantLoop(root, saved.identity.plan, grant, { resume: true });
}
