import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { normalizeWorkflowBuilderDefinition } from "@mastra/core/workflows/builder";
import { LibSQLStore } from "@mastra/libsql";
import { superviseProcess } from "@summer/components";
import { sha256Canonical, type JsonValue } from "@summer/protocol";
import { z } from "zod";

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
export const PRODUCT_TOOLS = ["summer.read-text@1", "summer.write-text@1", "summer.codex@1", "summer.minimax@1", "summer.approval@1"] as const;
const ArtifactCheck = z.object({
  path: z.string().min(1), kind: z.enum(["nonempty", "json", "contains"]),
  expected: z.string().optional(), requiredKeys: z.array(z.string()).default([])
}).strict().superRefine((value, ctx) => {
  if (value.kind === "contains" && !value.expected) ctx.addIssue({ code: "custom", message: "contains requires expected text" });
});
export const ProductSchema = z.object({
  schemaVersion: z.literal("summer.product/v2"), id: Id, version: z.number().int().positive(),
  title: z.string().min(1), description: z.string().min(1),
  parameters: z.array(Id).min(1), keywords: z.array(z.string().min(1)).min(1),
  graph: z.array(z.unknown()).min(1).max(64),
  acceptance: z.array(ArtifactCheck).min(1),
  maxCalls: z.number().int().min(1).max(64),
  sourceRun: z.string().optional()
}).strict();
export type Product = z.infer<typeof ProductSchema>;
export const ProductGrantSchema = z.object({
  schemaVersion: z.literal("summer.product-grant/v2"), grantId: Id,
  workspaceDir: z.string().refine(isAbsolute), runDir: z.string().refine(isAbsolute),
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  maxCalls: z.number().int().min(1).max(64), timeoutMs: z.number().int().min(100).max(28_800_000),
  allowWrite: z.boolean(), providers: z.array(z.enum(["codex", "minimax"])),
  models: z.array(z.string().min(1)),
  allowUnrestrictedHostWorker: z.boolean().default(false),
  approvedSteps: z.array(Id).default([])
}).strict().refine((value) => Date.parse(value.expiresAt) > Date.parse(value.issuedAt), "invalid grant window");
export const ProductRequestSchema = z.object({
  input: z.record(z.string(), z.string().min(1)), grant: ProductGrantSchema,
  pauseAfter: z.number().int().positive().optional()
}).strict();
export type ProductRequest = z.infer<typeof ProductRequestSchema>;
export function productContracts() {
  return { product: z.toJSONSchema(ProductSchema), request: z.toJSONSchema(ProductRequestSchema), grant: z.toJSONSchema(ProductGrantSchema), tools: PRODUCT_TOOLS };
}
export type ProductRunner = (command: string, args: readonly string[], options: {
  cwd: string; input: string; signal: AbortSignal; onHeartbeat: (value: unknown) => void;
}) => Promise<{ exitCode: number; stdout: string }>;
export const digest = (value: unknown) => sha256Canonical(value as JsonValue);
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
export function saveJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}

function inside(root: string, path: string): string {
  const target = resolve(root, path);
  const delta = relative(root, target);
  if (!delta || delta.startsWith("..") || isAbsolute(delta)) throw new Error("PATH_OUTSIDE_WORKSPACE");
  // Resolve the nearest existing ancestor to reject symlink escapes on writes.
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const actual = relative(realpathSync(root), realpathSync(ancestor));
  if (actual.startsWith("..") || isAbsolute(actual)) throw new Error("SYMLINK_OUTSIDE_WORKSPACE");
  return target;
}
export { inside as resolveWorkspacePath };
function expand(value: string, input: Record<string, string>) {
  return value.replace(/\$\{input\.([a-z][a-z0-9-]*)\}/g, (_match, key: string) => {
    if (!(key in input)) throw new Error(`MISSING_PARAMETER: ${key}`);
    return input[key]!;
  });
}
function productIdentity(product: Product) { return `${product.id}@${product.version}`; }
export function validateProduct(value: unknown): Product {
  const product = ProductSchema.parse(value);
  if (new Set(product.parameters).size !== product.parameters.length) throw new Error("DUPLICATE_PARAMETER");
  const definition = normalizeWorkflowBuilderDefinition({
    id: productIdentity(product), inputSchema: inputSchema(product),
    outputSchema: { type: "object", additionalProperties: true }, graph: product.graph
  });
  const seen = new Set<string>();
  let toolCount = 0;
  const inspect = (entry: Record<string, unknown>) => {
    if (!["mapping", "tool", "parallel", "conditional", "loop"].includes(String(entry.type))) throw new Error(`UNSUPPORTED_PRODUCT_STEP: ${entry.type}`);
    if (entry.id) {
      if (seen.has(String(entry.id))) throw new Error("DUPLICATE_STEP_ID");
      seen.add(String(entry.id));
    }
    if (entry.type === "tool" && !PRODUCT_TOOLS.includes(entry.toolId as typeof PRODUCT_TOOLS[number])) throw new Error(`UNREGISTERED_TOOL: ${entry.toolId}`);
    if (entry.type === "tool") toolCount++;
    if (entry.type === "tool" || entry.type === "mapping") Id.parse(entry.id);
    if (entry.type === "loop" && (entry.step as { type?: string })?.type !== "tool") throw new Error("LOOP_REQUIRES_BUDGETED_TOOL");
    if (entry.type === "loop" && (entry.step as { toolId?: string })?.toolId === "summer.approval@1") throw new Error("APPROVAL_LOOP_NOT_ALLOWED");
    if (entry.options) throw new Error("STEP_OPTIONS_NOT_ALLOWED: retry is owned by the execution boundary");
    if (entry.steps) for (const child of entry.steps as Record<string, unknown>[]) inspect(child);
    if (entry.step) inspect(entry.step as Record<string, unknown>);
  };
  for (const entry of definition.graph) inspect(entry as unknown as Record<string, unknown>);
  if (!toolCount) throw new Error("PRODUCT_REQUIRES_EXECUTOR");
  // Native loops are additionally bounded by the durable dispatch budget.
  return { ...product, graph: definition.graph };
}
function inputSchema(product: Product) {
  return { type: "object", properties: Object.fromEntries(product.parameters.map((key) => [key, { type: "string", minLength: 1 }])), required: product.parameters, additionalProperties: false };
}
export function checkInput(product: Product, input: Record<string, string>) {
  if (Object.keys(input).sort().join("\n") !== [...product.parameters].sort().join("\n")) throw new Error("INPUT_PARAMETERS_MISMATCH");
}
export function acceptArtifacts(product: Product, input: Record<string, string>, workspace: string) {
  return product.acceptance.map((check) => {
    const path = inside(workspace, expand(check.path, input));
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`ARTIFACT_MISSING: ${check.path}`);
    const text = readFileSync(path, "utf8");
    if (!text.trim()) throw new Error(`ARTIFACT_EMPTY: ${check.path}`);
    if (check.kind === "contains" && !text.includes(expand(check.expected!, input))) throw new Error(`ARTIFACT_CONTENT_INVALID: ${check.path}`);
    if (check.kind === "json") {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || check.requiredKeys.some((key) => !Object.hasOwn(parsed, key))) throw new Error(`ARTIFACT_JSON_INVALID: ${check.path}`);
    }
    return { path, digest: digest(text), kind: check.kind };
  });
}

const EventSchema = z.object({
  eventId: z.string().min(1), invocationId: z.string().min(1),
  kind: z.enum(["call-started", "call-completed", "call-failed", "heartbeat", "invocation-started", "invocation-failed", "approved", "accepted"]),
  at: z.string().datetime(), stepId: z.string().optional(), toolId: z.string().optional(),
  call: z.number().int().positive().optional(), inputDigest: z.string().optional(),
  output: z.unknown().optional(), outputDigest: z.string().optional(), error: z.string().optional(), grantId: z.string().optional(),
  requestedModel: z.string().optional(), provider: z.enum(["codex", "minimax"]).optional()
}).strict();
type Event = z.infer<typeof EventSchema>;
const ToolInput = z.object({ prompt: z.string().optional(), path: z.string().optional(), text: z.string().optional(), model: z.string().optional(), reasoningEffort: z.string().optional() }).strict();
const ToolOutput = z.object({ text: z.string().min(1), path: z.string().optional() });

export async function executeProduct(value: unknown, requestValue: unknown, options: { resume?: boolean; recover?: boolean; runner?: ProductRunner } = {}) {
  const product = validateProduct(value);
  const request = ProductRequestSchema.parse(requestValue);
  checkInput(product, request.input);
  const grant = request.grant;
  if (Date.now() < Date.parse(grant.issuedAt) || Date.now() >= Date.parse(grant.expiresAt)) throw new Error("GRANT_INACTIVE");
  const workspace = realpathSync(grant.workspaceDir);
  const runDir = inside(workspace, relative(resolve(grant.workspaceDir), resolve(grant.runDir)));
  mkdirSync(runDir, { recursive: true });
  const stateDir = inside(workspace, resolve(runDir, ".summer-v2"));
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lockDir = resolve(stateDir, "lock");
  try { mkdirSync(lockDir); } catch { throw new Error("RUN_LOCKED: another invocation or unreconciled crash owns this run"); }
  writeFileSync(resolve(lockDir, "owner.json"), JSON.stringify({ pid: process.pid }));
  let storage: LibSQLStore | undefined;
  const invocationId = randomUUID();
  const eventPath = resolve(stateDir, "events.jsonl");
  const events: Event[] = [];
  const emit = (event: Omit<Event, "eventId" | "at" | "invocationId">) => {
    const record = EventSchema.parse({ ...event, eventId: randomUUID(), invocationId, at: new Date().toISOString() });
    appendFileSync(eventPath, JSON.stringify(record) + "\n", { mode: 0o600 });
    events.push(record);
  };
  const active = () => {
    if (Date.now() < Date.parse(grant.issuedAt) || Date.now() >= Date.parse(grant.expiresAt)) throw new Error("GRANT_INACTIVE");
  };
  try {
    if (existsSync(eventPath)) events.push(...readFileSync(eventPath, "utf8").trim().split("\n").filter(Boolean).map((line) => EventSchema.parse(JSON.parse(line))));
    if (new Set(events.map((event) => event.eventId)).size !== events.length) throw new Error("DUPLICATE_RECEIPT_ID");
    active();
    const plannedPath = resolve(stateDir, "planned-product.json");
    if (existsSync(plannedPath) && digest(validateProduct(readJson(plannedPath))) !== digest(product)) throw new Error("FROZEN_PLAN_MISMATCH");
    const manifestPath = resolve(stateDir, "manifest.json");
    const identity = { product, input: request.input, workspaceDir: workspace, runDir };
    let runId: string;
    if (options.resume) {
      const manifest = readJson(manifestPath) as { identity: typeof identity; digest: string; runId: string };
      if (manifest.digest !== digest(manifest.identity) || manifest.digest !== digest(identity)) throw new Error("RESUME_IDENTITY_MISMATCH");
      if (events.some((event) => event.grantId === grant.grantId)) throw new Error("RESUME_GRANT_REUSED");
      runId = manifest.runId;
    } else {
      if (existsSync(manifestPath)) throw new Error("RUN_EXISTS: use resume with a fresh grant");
      runId = randomUUID();
      saveJson(manifestPath, { identity, digest: digest(identity), runId });
    }
    emit({ kind: "invocation-started", grantId: grant.grantId });
    saveJson(resolve(stateDir, "invocations", invocationId, "grant.json"), grant);
    let calls = events.filter((event) => event.kind === "call-started").length;
    let completedThisInvocation = 0;
    const tools: Record<string, ReturnType<typeof createTool>> = {};
    const graph = structuredClone(product.graph) as Record<string, unknown>[];
    const bind = (entry: Record<string, unknown>) => {
      if (entry.steps) for (const child of entry.steps as Record<string, unknown>[]) bind(child);
      if (entry.step) bind(entry.step as Record<string, unknown>);
      if (entry.type !== "tool") return;
      const stepId = String(entry.id), toolId = String(entry.toolId);
      const binding = `summer-${stepId}`;
      entry.toolId = binding;
      tools[binding] = createTool({
        id: binding, description: toolId, inputSchema: ToolInput, outputSchema: ToolOutput,
        execute: async (input, context) => {
          active();
          if (toolId === "summer.approval@1") {
            if (!grant.approvedSteps.includes(stepId)) {
              if (!context?.workflow?.suspend) throw new Error("SUSPEND_UNAVAILABLE");
              return await context.workflow.suspend({ reason: "human-approval", stepId });
            }
            emit({ kind: "approved", stepId, grantId: grant.grantId });
            return { text: input.text ?? "approved", ...(input.path ? { path: input.path } : {}) };
          }
          if (request.pauseAfter && completedThisInvocation >= request.pauseAfter) {
            if (!context?.workflow?.suspend) throw new Error("SUSPEND_UNAVAILABLE");
            return await context.workflow.suspend({ reason: "requested-pause", stepId });
          }
          const previous = events.filter((event) => event.stepId === stepId && event.kind === "call-started").at(-1);
          if (options.resume && previous && !["summer.read-text@1", "summer.write-text@1"].includes(toolId) && !events.some((event) => event.call === previous.call && event.kind === "call-completed")) {
            throw new Error(`EFFECT_UNKNOWN: ${stepId}; inspect artifacts before retrying in a new run`);
          }
          if (calls >= Math.min(grant.maxCalls, product.maxCalls)) throw new Error("CALL_BUDGET_EXHAUSTED");
          const call = ++calls;
          emit({ kind: "call-started", stepId, toolId, call, inputDigest: digest(input),
            ...(input.model ? { requestedModel: input.model } : {}),
            ...(toolId === "summer.codex@1" ? { provider: "codex" as const } : toolId === "summer.minimax@1" ? { provider: "minimax" as const } : {})
          });
          try {
            let result: z.infer<typeof ToolOutput>;
            if (toolId === "summer.read-text@1" || toolId === "summer.write-text@1") {
              if (!input.path) throw new Error("PATH_REQUIRED");
              const path = inside(workspace, input.path);
              if (toolId === "summer.write-text@1") {
                if (!grant.allowWrite) throw new Error("WRITE_DENIED");
                if (path.startsWith(stateDir + "/")) throw new Error("RUNTIME_STATE_WRITE_DENIED");
                if (!input.text?.trim()) throw new Error("EMPTY_WRITE");
                mkdirSync(dirname(path), { recursive: true });
                // Atomic replacement is idempotent for these exact bytes, unlike a shell worker.
                const temp = `${path}.${randomUUID()}.tmp`;
                writeFileSync(temp, input.text, { flag: "wx" });
                renameSync(temp, path);
              }
              result = { text: readFileSync(path, "utf8"), path: input.path };
            } else {
              const provider = toolId === "summer.codex@1" ? "codex" : "minimax";
              if (!grant.providers.includes(provider) || !input.model || !grant.models.includes(input.model)) throw new Error("MODEL_DENIED");
              if (provider === "codex" && !grant.allowUnrestrictedHostWorker) throw new Error("HOST_WORKER_SCOPE_UNENFORCEABLE: explicit opt-in required");
              if (!input.prompt?.trim()) throw new Error("PROMPT_REQUIRED");
              const signal = AbortSignal.timeout(Math.min(grant.timeoutMs, Date.parse(grant.expiresAt) - Date.now()));
              const command = provider === "codex" ? "codex" : "claude";
              const args = provider === "codex"
                ? ["exec", "--ephemeral", ...(grant.allowWrite ? ["--approve-for-me"] : ["--sandbox", "read-only"]), "--skip-git-repo-check", "--cd", workspace, "--model", input.model, ...(input.reasoningEffort ? ["--config", `model_reasoning_effort=\"${input.reasoningEffort}\"`] : []), "-"]
                : ["--print", "--model", input.model, ...(input.reasoningEffort ? ["--effort", input.reasoningEffort === "ultra" ? "max" : input.reasoningEffort] : []), "--tools", "", "--permission-mode", "dontAsk", "--no-session-persistence", "--output-format", "text"];
              const runner = options.runner ?? (async (command, args, options) => {
                const result = await superviseProcess(command, args, { ...options, preserveStdout: true });
                return { exitCode: result.exitCode, stdout: result.stdoutTail };
              });
              const response = await runner(command, args, { cwd: workspace, input: input.prompt, signal, onHeartbeat: () => emit({ kind: "heartbeat", stepId, call }) });
              signal.throwIfAborted();
              active();
              if (response.exitCode !== 0) throw new Error(`WORKER_EXIT_${response.exitCode}`);
              result = { text: response.stdout.trim() };
            }
            result = ToolOutput.parse(result);
            active();
            emit({ kind: "call-completed", stepId, toolId, call, output: result, outputDigest: digest(result) });
            completedThisInvocation++;
            return result;
          } catch (error) {
            emit({ kind: "call-failed", stepId, toolId, call, error: error instanceof Error ? error.message : "UNKNOWN" });
            throw error;
          }
        }
      });
    };
    for (const entry of graph) bind(entry);
    storage = new LibSQLStore({ id: `summer-${runId}`, url: `file:${resolve(stateDir, "mastra.db")}` });
    const mastra = new Mastra({ storage, tools: tools as never });
    const definition = normalizeWorkflowBuilderDefinition({ id: productIdentity(product), inputSchema: inputSchema(product), outputSchema: { type: "object", additionalProperties: true }, graph });
    await mastra.addDynamicWorkflow(definition);
    const workflow = mastra.getWorkflow(definition.id);
    const run = await workflow.createRun({ runId });
    const prior = options.resume ? await workflow.getWorkflowRunById(runId) : undefined;
    if (options.resume && prior?.status !== "suspended" && !options.recover) throw new Error("RESUME_REQUIRES_SUSPENDED_CHECKPOINT: failed or interrupted effects require reconciliation");
    const failedSteps = Object.entries(prior?.steps ?? {}).filter(([, step]) => !Array.isArray(step) && step.status === "failed").map(([id]) => id);
    if (options.recover && prior?.status === "failed" && failedSteps.length !== 1) throw new Error("RECOVERY_REQUIRES_SINGLE_FAILED_STEP");
    const execution = options.resume
      ? prior?.status === "suspended" ? await run.resume({ resumeData: {} })
        : prior?.status === "failed" ? await run.timeTravel({ step: failedSteps[0]! }) : await run.restart()
      : await run.start({ inputData: request.input });
    const status = execution.status;
    if (status === "suspended") {
      saveJson(resolve(stateDir, "result.json"), { status, runId, definitionDigest: digest(product) });
      return { status, runId, runDir };
    }
    if (status !== "success") throw new Error(`EXECUTION_${status.toUpperCase()}`);
    const artifacts = acceptArtifacts(product, request.input, workspace);
    const result = { status: "accepted", runId, runDir, definitionDigest: digest(product), inputDigest: digest(request.input), artifacts };
    saveJson(resolve(stateDir, "result.json"), result);
    emit({ kind: "accepted" });
    return result;
  } catch (error) {
    emit({ kind: "invocation-failed", error: error instanceof Error ? error.message : "UNKNOWN" });
    saveJson(resolve(stateDir, "last-failure.json"), { invocationId, at: new Date().toISOString(), error: error instanceof Error ? error.message : "UNKNOWN" });
    throw error;
  } finally {
    try { await storage?.close(); } finally { rmSync(lockDir, { recursive: true }); }
  }
}

export function productStatus(runDir: string) {
  const root = resolve(runDir, ".summer-v2");
  const manifest = readJson(resolve(root, "manifest.json")) as { digest: string; identity: unknown };
  if (manifest.digest !== digest(manifest.identity)) throw new Error("MANIFEST_TAMPERED");
  return { manifest, result: existsSync(resolve(root, "result.json")) ? readJson(resolve(root, "result.json")) : null, lastFailure: existsSync(resolve(root, "last-failure.json")) ? readJson(resolve(root, "last-failure.json")) : null, locked: existsSync(resolve(root, "lock")), eventsPath: resolve(root, "events.jsonl") };
}

export async function resumeProduct(runDir: string, grant: unknown, options: { runner?: ProductRunner } = {}) {
  const state = productStatus(runDir);
  const identity = state.manifest.identity as { product: Product; input: Record<string, string> };
  return executeProduct(identity.product, { input: identity.input, grant }, { ...options, resume: true });
}

/** Explicit recovery only for known read/atomic-replacement components. Arbitrary
 * host-worker writes require human reconciliation, not an idempotent label. */
export async function recoverProduct(runDir: string, grant: unknown) {
  const checkedGrant = ProductGrantSchema.parse(grant);
  if (Date.now() < Date.parse(checkedGrant.issuedAt) || Date.now() >= Date.parse(checkedGrant.expiresAt) || resolve(checkedGrant.runDir) !== resolve(runDir)) throw new Error("RECOVERY_GRANT_INVALID");
  const state = productStatus(runDir);
  const identity = state.manifest.identity as { product: Product; input: Record<string, string> };
  if (JSON.stringify(identity.product.graph).includes("summer.codex@1") || JSON.stringify(identity.product.graph).includes("summer.minimax@1")) throw new Error("RECOVERY_REQUIRES_EFFECT_RECONCILIATION");
  if (identity.product.graph.some((entry) => !["mapping", "tool"].includes(String((entry as { type: string }).type)))) throw new Error("RECOVERY_REQUIRES_LINEAR_SAFE_GRAPH");
  const lock = resolve(runDir, ".summer-v2/lock");
  if (existsSync(lock)) {
    const owner = readJson(resolve(lock, "owner.json")) as { pid: number };
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error("INVALID_LOCK_OWNER");
    try { process.kill(owner.pid, 0); throw new Error("RUN_STILL_ACTIVE"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      renameSync(lock, `${lock}.abandoned-${randomUUID()}`);
    }
  }
  return executeProduct(identity.product, { input: identity.input, grant }, { resume: true, recover: true });
}
