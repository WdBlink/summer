import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  IdeaSparkRequestV2Schema,
  CodexIdeaSparkDriver,
  parseNavigatorOutput,
  prepareIdeaSparkRequest,
  spawnCapture,
  verifyIdeaSparkState,
  type IdeaSparkFlowStateV2,
  type IdeaSparkProviderStatusV1
} from "./index.js";

function grant(workspaceDir: string, runDir: string) {
  return {
    schemaVersion: "summer.execution-grant/v1" as const,
    grantId: "grant-test",
    workflowId: "research-ideation" as const,
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scope: { workspaceDir, runDir },
    permissions: [
      "filesystem.research-artifact.read",
      "filesystem.research-artifact.write",
      "network.research.retrieve",
      "process.codex.exec"
    ] as const,
    networkDisclosure: {
      schemaVersion: "summer.network-disclosure/v1" as const,
      purpose: "public-literature-retrieval" as const,
      allowedProviders: [
        "arxiv",
        "openalex",
        "openreview",
        "semanticscholar"
      ] as const,
      allowedPayloads: [
        "scientific-query",
        "query-derived-search-terms",
        "public-reference-identifiers"
      ] as const,
      forbiddenPayloads: [
        "credentials",
        "unpublished-data",
        "unrelated-local-file-content"
      ] as const
    },
    providerPolicy: {
      literature: {
        requiredProviders: ["arxiv"] as const,
        minimumSuccessfulProviders: 1,
        requireBibliographicProvider: false
      },
      collision: {
        requiredProviders: ["arxiv"] as const,
        minimumSuccessfulProviders: 1,
        requireBibliographicProvider: false
      }
    }
  };
}

describe("research-ideation contracts", () => {
  it("confines each run and its typed grant to one workspace child", () => {
    const workspaceDir = "/tmp/project";
    const runDir = "/tmp/another-project/run";
    expect(
      IdeaSparkRequestV2Schema.safeParse({
        schemaVersion: "summer.research-ideation-request/v2",
        query: "one idea",
        workspaceDir,
        runDir,
        executionGrant: grant(workspaceDir, runDir)
      }).success
    ).toBe(false);
  });

  it("fails closed when a required execution permission is absent", () => {
    const workspaceDir = "/tmp/project";
    const runDir = "/tmp/project/ideaspark_run/one";
    const executionGrant = grant(workspaceDir, runDir);
    expect(
      IdeaSparkRequestV2Schema.safeParse({
        schemaVersion: "summer.research-ideation-request/v2",
        query: "one idea",
        workspaceDir,
        runDir,
        executionGrant: {
          ...executionGrant,
          permissions: executionGrant.permissions.filter(
            (permission) => permission !== "network.research.retrieve"
          )
        }
      }).success
    ).toBe(false);
  });

  it("rejects a required provider outside the typed disclosure envelope", () => {
    const workspaceDir = "/tmp/project";
    const runDir = "/tmp/project/ideaspark_run/one";
    const executionGrant = grant(workspaceDir, runDir);
    expect(
      IdeaSparkRequestV2Schema.safeParse({
        schemaVersion: "summer.research-ideation-request/v2",
        query: "one idea",
        workspaceDir,
        runDir,
        executionGrant: {
          ...executionGrant,
          networkDisclosure: {
            ...executionGrant.networkDisclosure,
            allowedProviders: ["openalex"]
          }
        }
      }).success
    ).toBe(false);
  });

  it("rejects expired grants before producing workflow state", () => {
    const workspaceDir = "/tmp/project";
    const runDir = "/tmp/project/ideaspark_run/one";
    expect(() =>
      prepareIdeaSparkRequest(
        {
          schemaVersion: "summer.research-ideation-request/v2",
          query: "one idea",
          workspaceDir,
          runDir,
          executionGrant: {
            ...grant(workspaceDir, runDir),
            expiresAt: "2026-10-01T00:00:00.000Z"
          }
        },
        "run-expired",
        new Date("2026-11-01T00:00:00.000Z")
      )
    ).toThrow(/expired/);
  });

  it("classifies the navigator by its next STEP instead of stale STATE history", () => {
    const snapshot = parseNavigatorOutput([
      "STATE  : Phase 0 complete — 42 papers retrieved.",
      "STEP   : Phase 1: identify the bottleneck",
      "TYPE   : llm_subagent"
    ].join("\n"));
    expect(snapshot.category).toBe("phase1");
  });

  it("recognizes verified provider evidence and all terminal cards", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-idea-verify-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "verified");
    const phase4 = resolve(runDir, "phase4");
    mkdirSync(phase4, { recursive: true });
    for (const file of ["idea.std.zh.md", "idea.std.en.md", "idea.detail.en.md"]) {
      writeFileSync(resolve(phase4, file), `# ${file}\n`, "utf8");
    }

    try {
      const terminal = parseNavigatorOutput([
        "STATE  : DONE — all cards complete.",
        "STEP   : No further action",
        "TYPE   : terminal"
      ].join("\n"));
      const prepared = prepareIdeaSparkRequest(
        {
          schemaVersion: "summer.research-ideation-request/v2",
          query: "one idea",
          workspaceDir,
          runDir,
          executionGrant: grant(workspaceDir, runDir)
        },
        "run-verified",
        new Date("2026-09-04T00:00:00.000Z")
      );
      const state: IdeaSparkFlowStateV2 = {
        ...prepared,
        navigator: terminal,
        route: "terminal",
        nodeRuns: [
          {
            schemaVersion: "summer.idea-spark-node-run/v2",
            nodeId: "package-render",
            kind: "stage",
            skipped: false,
            route: "terminal",
            after: terminal
          }
        ],
        providerStatuses: [
          providerStatus("phase0-provider-gate", "literature", runDir),
          providerStatus("candidate-1-provider-gate", "collision", runDir)
        ]
      };

      const result = verifyIdeaSparkState(state);
      expect(result.status).toBe("done");
      expect(result.schemaVersion).toBe("summer.research-ideation-result/v2");
      expect(result.artifacts.map(({ artifactId }) => artifactId)).toEqual([
        "idea-std-zh",
        "idea-std-en",
        "idea-detail-en"
      ]);
      expect(result.artifacts.every(({ digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when provider status is missing", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-idea-provider-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "missing");
    const terminal = parseNavigatorOutput([
      "STATE  : DONE — all cards complete.",
      "STEP   : No further action",
      "TYPE   : terminal"
    ].join("\n"));
    try {
      const state = prepareIdeaSparkRequest(
        {
          schemaVersion: "summer.research-ideation-request/v2",
          query: "one idea",
          workspaceDir,
          runDir,
          executionGrant: grant(workspaceDir, runDir)
        },
        "run-missing-provider",
        new Date("2026-09-04T00:00:00.000Z")
      );
      expect(() =>
        verifyIdeaSparkState({
          ...state,
          navigator: terminal,
          route: "terminal",
          nodeRuns: [
            {
              schemaVersion: "summer.idea-spark-node-run/v2",
              nodeId: "package-render",
              kind: "stage",
              skipped: true,
              route: "terminal"
            }
          ]
        })
      ).toThrowError(
        expect.objectContaining({ code: "IDEA_SPARK_PROVIDER_STATUS_MISSING" })
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("emits child-process heartbeats and terminates on abort", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-heartbeat-"));
    try {
      const heartbeats: string[] = [];
      const completed = await spawnCapture(
        process.execPath,
        ["-e", "setTimeout(() => process.exit(0), 80)"],
        {
          cwd: directory,
          heartbeatIntervalMs: 10,
          onHeartbeat: ({observedAt}) => heartbeats.push(observedAt)
        }
      );
      expect(completed.exitCode).toBe(0);
      expect(heartbeats.length).toBeGreaterThan(0);

      await expect(
        spawnCapture(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          {
            cwd: directory,
            signal: AbortSignal.timeout(20),
            terminationGraceMs: 20
          }
        )
      ).rejects.toMatchObject({code: "IDEA_SPARK_WORKER_ABORTED"});
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("binds Codex writes to the granted run directory", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-grant-scope-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "scoped");
    const skillDir = resolve(directory, "idea-spark");
    mkdirSync(resolve(skillDir, "scripts"), {recursive: true});
    writeFileSync(resolve(skillDir, "SKILL.md"), "# Idea Spark\n", "utf8");
    writeFileSync(resolve(skillDir, "scripts", "run.py"), "# fixture\n", "utf8");
    const calls: Array<{
      command: string;
      args: readonly string[];
      cwd: string;
      input?: string;
    }> = [];
    let navigatorCalls = 0;
    try {
      const state = prepareIdeaSparkRequest(
        {
          schemaVersion: "summer.research-ideation-request/v2",
          query: "one idea",
          workspaceDir,
          runDir,
          executionGrant: grant(workspaceDir, runDir)
        },
        "run-grant-scope",
        new Date("2026-09-04T00:00:00.000Z")
      );
      const driver = new CodexIdeaSparkDriver({
        ideaSparkSkillDir: skillDir,
        codexBin: "codex-fixture",
        pythonBin: "python-fixture",
        spawnProcess: async (command, args, options) => {
          calls.push({
            command,
            args,
            cwd: options.cwd,
            ...(options.input === undefined ? {} : {input: options.input})
          });
          if (command === "python-fixture") {
            navigatorCalls += 1;
            const category = navigatorCalls === 1 ? "phase0" : "phase1";
            return {
              exitCode: 0,
              stdoutTail:
                category === "phase0"
                  ? "STATE  : Fresh run\nSTEP   : Phase 0\nTYPE   : bash\n"
                  : "STATE  : Phase 0 complete\nSTEP   : Phase 1\nTYPE   : llm_subagent\n",
              stderrTail: ""
            };
          }
          return {exitCode: 0, stdoutTail: "", stderrTail: ""};
        }
      });
      await driver.advance("literature-grounding", state.request);
      const codex = calls.find(({command}) => command === "codex-fixture");
      expect(codex?.cwd).toBe(runDir);
      expect(codex?.args).toEqual(expect.arrayContaining([
        "--approve-for-me",
        "--cd",
        runDir
      ]));
      expect(codex?.args).not.toContain("--sandbox");
      expect(codex?.input).toContain('"purpose":"public-literature-retrieval"');
      expect(codex?.input).toContain("do not ask the user to approve those transmissions again");
      expect(codex?.input).toContain("Never copy authorization prose into the scientific query");
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });
});

function providerStatus(
  gateNodeId: string,
  phase: "literature" | "collision",
  runDir: string
): IdeaSparkProviderStatusV1 {
  return {
    schemaVersion: "summer.idea-spark-provider-status/v1",
    gateNodeId,
    phase,
    provider: "arxiv",
    state: "succeeded",
    recordCount: 1,
    evidencePaths: [resolve(runDir, `${phase}.json`)],
    evidence: [
      {
        uri: resolve(runDir, `${phase}.json`),
        digest: "b".repeat(64),
        recordCount: 1
      }
    ],
    observedAt: "2026-09-04T00:00:00.000Z"
  };
}
