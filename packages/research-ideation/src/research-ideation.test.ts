import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  IdeaSparkRequestV1Schema,
  parseNavigatorOutput,
  verifyIdeaSparkExecution,
  type IdeaSparkExecutionV1
} from "./index.js";

describe("research-ideation contracts", () => {
  it("confines each run to one child of the workspace Idea Spark root", () => {
    expect(
      IdeaSparkRequestV1Schema.safeParse({
        schemaVersion: "summer.research-ideation-request/v1",
        query: "one idea",
        workspaceDir: "/tmp/project",
        runDir: "/tmp/another-project/run"
      }).success
    ).toBe(false);
  });

  it("classifies the navigator by its next STEP instead of stale STATE history", () => {
    const snapshot = parseNavigatorOutput([
      "STATE  : Phase 0 complete — 42 papers retrieved.",
      "STEP   : Phase 1: identify the bottleneck",
      "TYPE   : llm_subagent"
    ].join("\n"));

    expect(snapshot.category).toBe("phase1");
  });

  it("recognizes all successful Idea Spark cards as one verified terminal", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-idea-verify-"));
    const runDir = resolve(directory, "ideaspark_run", "verified");
    const phase4 = resolve(runDir, "phase4");
    mkdirSync(phase4, {recursive: true});
    for (const file of ["idea.std.zh.md", "idea.std.en.md", "idea.detail.en.md"]) {
      writeFileSync(resolve(phase4, file), `# ${file}\n`, "utf8");
    }

    try {
      const terminal = parseNavigatorOutput([
        "STATE  : DONE — all cards complete.",
        "STEP   : No further action",
        "TYPE   : terminal"
      ].join("\n"));
      const execution: IdeaSparkExecutionV1 = {
        schemaVersion: "summer.research-ideation-execution/v1",
        request: {
          schemaVersion: "summer.research-ideation-prepared/v1",
          query: "one idea",
          workspaceDir: directory,
          runDir,
          requestDigest: "b".repeat(64)
        },
        terminalStatus: "done",
        navigator: terminal,
        stageRuns: [
          {
            schemaVersion: "summer.idea-spark-stage-run/v1",
            stage: "package-render",
            skipped: false,
            before: {
              ...terminal,
              state: "Phase 4",
              step: "Render cards",
              type: "bash",
              category: "phase4",
              terminalStatus: undefined
            },
            after: terminal
          }
        ]
      };

      const result = verifyIdeaSparkExecution(execution);
      expect(result.status).toBe("done");
      expect(result.artifacts.map(({artifactId}) => artifactId)).toEqual([
        "idea-std-zh",
        "idea-std-en",
        "idea-detail-en"
      ]);
      expect(result.artifacts.every(({digest}) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("fails closed when a declared terminal card is missing", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-idea-missing-"));
    const terminal = parseNavigatorOutput([
      "STATE  : DONE — all cards complete.",
      "STEP   : No further action",
      "TYPE   : terminal"
    ].join("\n"));

    try {
      expect(() =>
        verifyIdeaSparkExecution({
          schemaVersion: "summer.research-ideation-execution/v1",
          request: {
            schemaVersion: "summer.research-ideation-prepared/v1",
            query: "one idea",
            workspaceDir: directory,
            runDir: resolve(directory, "ideaspark_run", "missing"),
            requestDigest: "c".repeat(64)
          },
          terminalStatus: "done",
          navigator: terminal,
          stageRuns: [
            {
              schemaVersion: "summer.idea-spark-stage-run/v1",
              stage: "package-render",
              skipped: true,
              before: terminal,
              after: terminal
            }
          ]
        })
      ).toThrowError(expect.objectContaining({code: "IDEA_SPARK_ARTIFACT_INVALID"}));
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });
});
