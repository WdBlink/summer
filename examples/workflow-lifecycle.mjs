// Model-free walkthrough of the real CLI and Mastra runtime, with isolated storage.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = realpathSync(mkdtempSync(join(tmpdir(), "summer-demo-")));
const cliUrl = new URL("../packages/cli/dist/cli.js", import.meta.url).href;
const entry = `import { runCli } from ${JSON.stringify(cliUrl)}; process.exitCode = await runCli(process.argv.slice(1), undefined, ${JSON.stringify(root)});`;
let invocation = 0;
console.log("Summer demo | real Mastra execution, no model calls");
console.log(`Evidence directory: ${root}`);

function json(name, value) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return path;
}

function cli(...args) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", entry, ...args], {
    cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024
  });
  json(`cli-${++invocation}-${args[0]}.json`, {
    args, exitCode: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, error: result.error?.message
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  return response;
}

function request(name, message, maxCalls = 4) {
  const workspaceDir = join(root, name);
  mkdirSync(workspaceDir);
  return { input: { message }, grant: {
    schemaVersion: "summer.product-grant/v2", grantId: name,
    workspaceDir, runDir: join(workspaceDir, "run"),
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    maxCalls, timeoutMs: 30_000, allowWrite: true,
    providers: [], models: [], allowUnrestrictedHostWorker: false, approvedSteps: []
  } };
}

// This graph is predefined, not model-generated. The candidate is already parameterized.
const candidate = json("note.product.json", {
  schemaVersion: "summer.product/v2", id: "write-note", version: 1,
  title: "Write a note", description: "Write and verify a parameterized Markdown note.",
  parameters: ["message"], keywords: ["write a note"], maxCalls: 4,
  graph: [
    { type: "mapping", id: "prepare", mapConfig: { path: { value: "note.md" }, text: { template: "${initData.message}" } } },
    { type: "tool", id: "write", toolId: "summer.write-text@1" },
    { type: "tool", id: "read", toolId: "summer.read-text@1" }
  ],
  acceptance: [{ path: "note.md", kind: "contains", expected: "${input.message}" }]
});
cli("validate-product", candidate);
const source = request("source", "A verified note");
assert.equal(cli("run-draft", candidate, json("source.request.json", source)).result.status, "accepted");
assert.equal(readFileSync(join(source.grant.workspaceDir, "note.md"), "utf8"), source.input.message);
console.log('[1/5] run-draft  accepted: note.md = "A verified note"');

const draft = cli("promote", source.grant.runDir, candidate).result;
assert.equal(draft.status, "draft");
console.log("[2/5] promote    draft: write-note@1 (explicit candidate)");

const invalid = request("invalid", "Will be rejected");
invalid.input = {}; // A valid grant isolates the missing-parameter check.
const report = cli("verify", draft.path, json("verification-suite.json", { cases: [
  { kind: "normal", request: request("normal", "A different note") },
  { kind: "invalid-input", request: invalid },
  { kind: "failure", request: request("failure", "Budget case", 1), expectedError: "EXECUTION_FAILED" }
] })).result;
assert.deepEqual(report.cases.map(({ kind, passed }) => ({ kind, passed })), [
  { kind: "normal", passed: true }, { kind: "invalid-input", passed: true }, { kind: "failure", passed: true }
]);
const failureState = cli("status", join(root, "failure", "run"));
assert.equal(failureState.lastFailure.error, "EXECUTION_FAILED");
assert.equal(failureState.result, null);
console.log("[3/5] verify     passed: new input, invalid input, exhausted budget");

const release = cli("publish", draft.path).result;
assert.equal(release.reference, "write-note@1");
assert.equal(release.status, "published");
console.log("[4/5] publish    write-note@1 (temporary local library)");

const reuse = request("reuse", "Next week's note");
assert.equal(cli("run-product", release.reference, json("reuse.request.json", reuse)).result.status, "accepted");
assert.equal(readFileSync(join(reuse.grant.workspaceDir, "note.md"), "utf8"), reuse.input.message);
const state = cli("status", reuse.grant.runDir);
const events = readFileSync(state.eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
assert.equal(state.result.status, "accepted");
assert.deepEqual(events.filter((event) => event.kind === "call-completed").map((event) => event.toolId), ["summer.write-text@1", "summer.read-text@1"]);
assert.ok(events.some((event) => event.kind === "accepted"));
console.log('[5/5] reuse      accepted: note.md = "Next week\'s note"');
console.log("Checks passed. Evidence saved in the directory above.");
