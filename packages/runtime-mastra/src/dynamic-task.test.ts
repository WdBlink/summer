import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDynamicTask, type DynamicTaskCommandRunner } from "./dynamic-task.js";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function request() {
  const workspaceDir = mkdtempSync(resolve(tmpdir(), "summer-dynamic-guard-"));
  directories.push(workspaceDir);
  const runDir = resolve(workspaceDir, "run");
  return {
    schemaVersion: "summer.dynamic-task-request/v1",
    task: "Review a document", workspaceDir, runDir,
    executionGrant: {
      schemaVersion: "summer.dynamic-task-execution-grant/v1",
      grantId: "test-grant", workflowId: "dynamic-agent-workflow",
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      scope: { workspaceDir, runDir },
      permissions: ["filesystem.workspace.read", "filesystem.workspace.write", "network.model.inference", "process.codex.exec"],
      workerPolicy: { providers: ["codex"], minimaxModels: [], maxWorkerCalls: 1 }
    }
  };
}

const context = { workflowId: "dynamic-agent-workflow", workflowRevision: 1, runId: "test-run", nodeId: "dynamic", attempt: 1 };
const output = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
const models = JSON.stringify({ models: [{ slug: "test-model", visibility: "list", priority: 1, supported_reasoning_levels: [{ effort: "high" }] }] });
const plan = JSON.stringify({ description: "Review", graph: [
  { type: "mapping", id: "input", mapConfig: JSON.stringify({ model: { value: "test-model" }, reasoningEffort: { value: "high" }, prompt: { value: "Review document" } }) },
  { type: "tool", id: "review", toolId: "codex-worker" }
] });

describe("dynamic execution boundaries", () => {
  it("rejects an initially expired grant without dispatch", async () => {
    const input = request();
    input.executionGrant.expiresAt = new Date(Date.now() - 1).toISOString();
    const runner = vi.fn();
    await expect(runDynamicTask(input, context, { runCommand: runner })).rejects.toMatchObject({ code: "DYNAMIC_EXECUTION_GRANT_INACTIVE" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects expiry during discovery before planning", async () => {
    const input = request();
    const runner = vi.fn(async () => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse(input.executionGrant.expiresAt));
      return output(models);
    });
    await expect(runDynamicTask(input, context, { runCommand: runner })).rejects.toMatchObject({ code: "DYNAMIC_EXECUTION_GRANT_INACTIVE" });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("aborts an active subprocess at grant expiry", async () => {
    const input = request();
    input.executionGrant.expiresAt = new Date(Date.now() + 100).toISOString();
    const runner: DynamicTaskCommandRunner = async (_command, _args, { signal }) => await new Promise((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
    });
    await expect(runDynamicTask(input, context, { runCommand: runner })).rejects.toMatchObject({ code: "DYNAMIC_EXECUTION_GRANT_INACTIVE" });
  });

  it.each(["", "   \n"])("does not accept blank worker output %j as success", async (text) => {
    const runner: DynamicTaskCommandRunner = async (_command, args) => output(
      args[0] === "debug" ? models : args.includes("--output-schema") ? plan : text
    );
    await expect(runDynamicTask(request(), context, { runCommand: runner })).rejects.toMatchObject({ code: "DYNAMIC_WORKFLOW_FAILED" });
  });

  it("preserves successful nonempty output and reserved call identity", async () => {
    const runner: DynamicTaskCommandRunner = async (_command, args) => output(
      args[0] === "debug" ? models : args.includes("--output-schema") ? plan : "reviewed"
    );
    const result = await runDynamicTask(request(), context, { runCommand: runner });
    expect(result.workers).toMatchObject([{ call: 1, text: "reviewed" }]);
  });
});
