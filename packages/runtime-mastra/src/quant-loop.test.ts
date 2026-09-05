import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { digest, saveJson, validateProduct } from "./products.js";
import { runQuantLoop, resumeQuantLoop, QuantPlanSchema } from "./quant-loop.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "summer-quant-test-")); roots.push(root);
  const frozen = { dataDigest: "a".repeat(64), environmentDigest: "b".repeat(64), evaluatorDigest: "c".repeat(64), baselineDigest: "d".repeat(64) };
  // Model-free executor fixture; not a real backtest or an alpha evaluation.
  const product = validateProduct({ schemaVersion: "summer.product/v2", id: "evaluation-fixture", version: 1, title: "Evaluation fixture", description: "Test only", parameters: ["evaluation"], keywords: ["test"], maxCalls: 1,
    graph: [
      { type: "mapping", id: "input", mapConfig: { path: { value: "evaluation.json" }, text: { template: "${initData.evaluation}" } } },
      { type: "tool", id: "write", toolId: "summer.write-text@1" }
    ], acceptance: [{ path: "evaluation.json", kind: "json", requiredKeys: ["score", "frozen"] }]
  });
  saveJson(resolve(root, "products/published/evaluation-fixture@1.json"), { product, digest: digest(product), verification: { fixture: true } });
  const candidates = [0.2, 0.22, 0.8].map((score, index) => {
    const id = `candidate-${index + 1}`, parameters = { lookback: index + 1 };
    return { id, workflow: "evaluation-fixture@1", parameters, evaluationArtifact: "evaluation.json", input: { evaluation: JSON.stringify({ experimentId: id, frozen, parametersDigest: digest(parameters), split: "validation", score, gatesPassed: true, evidenceDigest: "e".repeat(64) }) } };
  });
  const plan = { schemaVersion: "summer.quant-loop/v2", mode: "offline-research", frozen, baselineScore: 0.1, baselineParameters: { lookback: 0 }, minImprovement: 0.05, maxNonImproving: 1, maxCalls: 8, candidates };
  const grant = { schemaVersion: "summer.product-grant/v2", grantId: "quant-test", workspaceDir: root, runDir: resolve(root, "run"), issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), maxCalls: 8, timeoutMs: 1000, allowWrite: true, models: [], providers: [] };
  return { root, plan, grant };
}
describe("quantitative experiment loop policy", () => {
  it("uses accepted experiments, stops on diminishing improvement and never trades", async () => {
    const { root, plan, grant } = fixture();
    const result = await runQuantLoop(root, plan, grant);
    expect(result).toMatchObject({ bestId: "candidate-1", bestScore: 0.2, stopReason: "no-material-improvement", liveTrading: false });
    expect(result.history.map((item) => item.decision)).toEqual(["improved", "rejected"]);
  });
  it("treats incomparable evidence as repair, not a negative strategy result", async () => {
    const { root, plan, grant } = fixture();
    const evaluation = JSON.parse(plan.candidates[0]!.input.evaluation);
    evaluation.frozen.evaluatorDigest = "f".repeat(64);
    plan.candidates[0]!.input.evaluation = JSON.stringify(evaluation);
    const result = await runQuantLoop(root, plan, grant);
    expect(result).toMatchObject({ bestScore: 0.1, bestId: null, stopReason: "repair-required" });
    expect(result.history[0]!.score).toBeNull();
  });
  it("rejects multi-variable experiments before execution", () => {
    const { plan } = fixture();
    Object.assign(plan.candidates[0]!.parameters, { second: 1 });
    expect(() => QuantPlanSchema.parse(plan)).toThrow("exactly one");
  });
  it("resumes a paused experiment loop without resetting evidence or budget", async () => {
    const { root, plan, grant } = fixture();
    const paused = await runQuantLoop(root, plan, grant, { pauseAfter: 1 });
    expect(paused.status).toBe("suspended");
    const result = await resumeQuantLoop(root, grant.runDir, { ...grant, grantId: "quant-resume" });
    const failure = resolve(grant.runDir, ".summer-quant/experiment-candidate-2.failure.json");
    expect(result, existsSync(failure) ? readFileSync(failure, "utf8") : JSON.stringify(result)).toMatchObject({ status: "completed", bestId: "candidate-1", calls: 2 });
    expect(result.history).toHaveLength(2);
  });
});
