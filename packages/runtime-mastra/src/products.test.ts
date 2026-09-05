import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeProduct, resumeProduct, recoverProduct, validateProduct, saveJson, type Product } from "./products.js";
import { promoteProduct, verifyProduct, publishProduct, listProducts, loadProduct, selectProduct } from "./product-library.js";
import { planProduct } from "./product-planner.js";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
export function sampleProduct(): Product {
  return validateProduct({ schemaVersion: "summer.product/v2", id: "write-note", version: 1,
    title: "Write note", description: "A deterministic note workflow", parameters: ["message"], keywords: ["note"], maxCalls: 4,
    graph: [
      { type: "mapping", id: "prepare", mapConfig: { path: { value: "note.md" }, text: { template: "${initData.message}" } } },
      { type: "tool", id: "write", toolId: "summer.write-text@1" },
      { type: "tool", id: "read", toolId: "summer.read-text@1" }
    ], acceptance: [{ path: "note.md", kind: "contains", expected: "${input.message}" }]
  });
}
function request() {
  const workspaceDir = mkdtempSync(resolve(tmpdir(), "summer-product-")); roots.push(workspaceDir);
  return { input: { message: "hello" }, grant: {
    schemaVersion: "summer.product-grant/v2", grantId: "first", workspaceDir, runDir: resolve(workspaceDir, "run"),
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    maxCalls: 4, timeoutMs: 1000, allowWrite: true, providers: [], models: []
  } };
}
describe("native workflow products", () => {
  it("freezes a live-authored native graph and counts planner usage in execution", async () => {
    const input = request();
    Object.assign(input.grant, { providers: ["codex"], models: ["test-model"] });
    const { graph, sourceRun, ...brief } = sampleProduct();
    const commands: readonly string[][] = [];
    const runner = async (_command: string, args: readonly string[]) => {
      (commands as string[][]).push([...args]);
      return { exitCode: 0, stdout: args[0] === "debug" ? JSON.stringify({ models: [{ slug: "test-model", priority: 1, visibility: "list", supported_reasoning_levels: [{ effort: "ultra" }] }] }) : JSON.stringify({ graph }) };
    };
    const planned = await planProduct(brief, input, runner);
    expect(commands[1]).toContain("--sandbox");
    expect(commands[1]).not.toContain("--approve-for-me");
    expect((await executeProduct(planned.product, input)).status).toBe("accepted");
    await expect(planProduct(brief, input, runner)).rejects.toThrow("PLAN_EXISTS");
  });
  it("executes registered native tools and accepts actual artifacts", async () => {
    const input = request();
    const result = await executeProduct(sampleProduct(), input);
    expect(result.status).toBe("accepted");
    expect(readFileSync(resolve(input.grant.workspaceDir, "note.md"), "utf8")).toBe("hello");
  });
  it("resumes from a persisted Mastra checkpoint without replaying a completed write", async () => {
    const input = request();
    expect((await executeProduct(sampleProduct(), { ...input, pauseAfter: 1 })).status).toBe("suspended");
    expect((await resumeProduct(input.grant.runDir, { ...input.grant, grantId: "second" })).status).toBe("accepted");
    const events = readFileSync(resolve(input.grant.runDir, ".summer-v2/events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => event.kind === "call-started" && event.stepId === "write")).toHaveLength(1);
  });
  it("fails artifact acceptance even after successful tool execution", async () => {
    const input = request(); const product = sampleProduct();
    product.acceptance[0]!.expected = "not present";
    await expect(executeProduct(product, input)).rejects.toThrow("ARTIFACT_CONTENT_INVALID");
  });
  it("fails closed on unregistered executors and invalid parameters", async () => {
    const product = sampleProduct(); product.graph[1] = { type: "tool", id: "write", toolId: "arbitrary-shell" };
    expect(() => validateProduct(product)).toThrow("UNREGISTERED_TOOL");
    await expect(executeProduct(sampleProduct(), { ...request(), input: { wrong: "value" } })).rejects.toThrow("INPUT_PARAMETERS_MISMATCH");
  });
  it("enforces the cumulative dispatch budget", async () => {
    const input = request(); input.grant.maxCalls = 1;
    await expect(executeProduct(sampleProduct(), input)).rejects.toThrow("EXECUTION_FAILED");
  });
  it("requires explicit approval and resumes without duplicate writes", async () => {
    const product = sampleProduct();
    product.graph.splice(1, 0, { type: "tool", id: "approve", toolId: "summer.approval@1" });
    const input = request();
    expect((await executeProduct(product, input)).status).toBe("suspended");
    expect((await resumeProduct(input.grant.runDir, { ...input.grant, grantId: "approved", approvedSteps: ["approve"] })).status).toBe("accepted");
  });
  it("does not reset the call budget when a new grant resumes the same run", async () => {
    const input = request(); input.grant.maxCalls = 1;
    expect((await executeProduct(sampleProduct(), { ...input, pauseAfter: 1 })).status).toBe("suspended");
    await expect(resumeProduct(input.grant.runDir, { ...input.grant, grantId: "no-new-budget" })).rejects.toThrow("EXECUTION_FAILED");
  });
  it("rejects mutation of a frozen definition and unsafe recovery", async () => {
    const input = request();
    const product = sampleProduct();
    product.graph[1] = { type: "tool", id: "worker", toolId: "summer.codex@1" };
    await expect(executeProduct(product, input)).rejects.toThrow();
    await expect(recoverProduct(input.grant.runDir, { ...input.grant, grantId: "cannot-replay" })).rejects.toThrow("EFFECT_RECONCILIATION");
  });
  it("executes native conditional edges and bounds a native loop", async () => {
    const product = sampleProduct();
    product.graph[2] = { type: "conditional", steps: [{ type: "tool", id: "read", toolId: "summer.read-text@1" }], predicates: [{ op: "eq", left: { path: "initData.message" }, right: { literal: "hello" } }] };
    expect((await executeProduct(product, request())).status).toBe("accepted");
    product.graph[2] = { type: "loop", step: { type: "tool", id: "read", toolId: "summer.read-text@1" }, loopType: "dountil", predicate: { op: "eq", left: { path: "inputData.text" }, right: { literal: "never" } } };
    await expect(executeProduct(product, request())).rejects.toThrow("EXECUTION_FAILED");
  });
  it("recovers a failed read after repair without replaying the completed write", async () => {
    const product = sampleProduct();
    product.graph.splice(2, 0, { type: "mapping", id: "missing-input", mapConfig: { path: { value: "external.md" } } });
    const input = request();
    await expect(executeProduct(product, input)).rejects.toThrow("EXECUTION_FAILED");
    writeFileSync(resolve(input.grant.workspaceDir, "external.md"), "repaired input");
    expect((await recoverProduct(input.grant.runDir, { ...input.grant, grantId: "repair-grant" })).status).toBe("accepted");
    const events = readFileSync(resolve(input.grant.runDir, ".summer-v2/events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(events.filter((event) => event.kind === "call-started" && event.stepId === "write")).toHaveLength(1);
  });
  it("promotes, verifies different input and failure cases, publishes and reuses an immutable version", async () => {
    const source = request();
    await executeProduct(sampleProduct(), source);
    const draft = promoteProduct(source.grant.workspaceDir, source.grant.runDir, sampleProduct());
    const normal = request(); normal.input.message = "different input";
    const failure = request(); failure.grant.maxCalls = 1;
    await verifyProduct(draft.path, { cases: [
      { kind: "normal", request: normal },
      { kind: "invalid-input", request: { input: {} } },
      { kind: "failure", request: failure, expectedError: "EXECUTION_FAILED" }
    ] });
    publishProduct(source.grant.workspaceDir, draft.path);
    expect(listProducts(source.grant.workspaceDir)).toHaveLength(1);
    expect((await executeProduct(loadProduct(source.grant.workspaceDir, "write-note"), request())).status).toBe("accepted");
    expect(() => publishProduct(source.grant.workspaceDir, draft.path)).toThrow();
    expect(selectProduct(source.grant.workspaceDir, "write-note@1").selected).toBe("write-note@1");
    const changed = { ...sampleProduct(), title: "changed" };
    saveJson(draft.path, changed);
    expect(() => publishProduct(source.grant.workspaceDir, draft.path)).toThrow("VERIFICATION_STALE");
  });
});
