import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import type {
  IdeaSparkDriver,
  IdeaSparkNavigatorCategory,
  IdeaSparkNavigatorSnapshotV1,
  IdeaSparkPreparedV2,
  IdeaSparkStage,
  IdeaSparkStageAdvance
} from "@summer/research-ideation";

import {
  FIXTURE_CONFORMANCE_REGISTRY_ID,
  createFixtureConformanceRegistry
} from "./conformance-registry.js";
import {
  FIXTURE_WORKFLOWS,
  checkRepositoryExtension,
  compileFixtureWorkflows,
  compileWorkflowFile,
  matchRepositoryCatalog
} from "./commands.js";
import { SUMMER_PROJECT_ROOT, runCli, type CliIo } from "./cli.js";
import { compileRepositoryCatalog } from "./repository-catalog.js";
import { runNativeResearch } from "@summer/research-ideation";

interface CapturedIo {
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
}

function captureIo(): CapturedIo {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line)
    },
    stdout,
    stderr
  };
}

async function withTemporaryFile(
  value: unknown,
  action: (file: string) => void | Promise<void>
): Promise<void> {
  const directory = mkdtempSync(resolve(tmpdir(), "summer-cli-"));
  const file = resolve(directory, "workflow.json");
  try {
    writeFileSync(file, JSON.stringify(value), "utf8");
    await action(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function loadFixtureSource(fileName: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(SUMMER_PROJECT_ROOT, "fixtures", "workflows", fileName),
      "utf8"
    )
  ) as unknown;
}

describe("fixture conformance registry", () => {
  it("registers exact fixture-only references and enables ResearchStudio fanout", () => {
    const registry = createFixtureConformanceRegistry();
    const freeze = registry.resolveDescriptor({
      namespace: "researchstudio",
      name: "freeze-brief",
      version: "1.0.0"
    });

    expect(FIXTURE_CONFORMANCE_REGISTRY_ID).toBe(
      "summer.fixture-conformance-registry/v1"
    );
    expect(freeze.supportsFanout).toBe(true);
    expect(freeze.capabilities).toContain("fixture.researchstudio.freeze-brief");
    expect(() =>
      registry.resolveDescriptor({
        namespace: "researchstudio",
        name: "freeze-brief",
        version: "1.0.1"
      })
    ).toThrowError(expect.objectContaining({ code: "UNRESOLVED_COMPONENT" }));
  });

  it("compiles the remaining repository fixture", () => {
    const result = compileFixtureWorkflows(SUMMER_PROJECT_ROOT);

    expect(result.fixtureCount).toBe(1);
    expect(result.fixtures.map((fixture) => fixture.workflowId)).toEqual(
      FIXTURE_WORKFLOWS.map((fixture) => fixture.workflowId)
    );
    for (const fixture of result.fixtures) {
      expect(fixture.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.registryDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.compiledDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("compiles a complete catalog for every registered fixture component", () => {
    const catalog = compileRepositoryCatalog(SUMMER_PROJECT_ROOT);

    expect(catalog.componentCoverage).toBe("complete");
    expect(catalog.workflows).toHaveLength(2);
    expect(catalog.components).toHaveLength(27);
    expect(catalog.runtimes.map(({ runtimeId }) => runtimeId)).toEqual([
      "mastra-v0",
      "summer-core-v0"
    ]);
    expect(catalog.catalogDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("emits a fully compiled workflow, not an execution binding", () => {
    const result = compileWorkflowFile(
      resolve(
        SUMMER_PROJECT_ROOT,
        "fixtures",
        "workflows",
        "research-ideation.v1.json"
      )
    );

    expect(result.registry.executorBindings).toBe(false);
    expect(result.workflow.schemaVersion).toBe("summer.compiled-workflow/v1");
    expect(result.workflow.nodes.find((node) => node.id === "freeze-brief")?.resolvedComponent.supportsFanout).toBe(true);
  });
});

describe("runCli", () => {
  it("validates strict summer.workflow/v1 JSON and emits one JSON line", async () => {
    const captured = captureIo();
    const file = resolve(
      SUMMER_PROJECT_ROOT,
      "fixtures",
      "workflows",
      "research-ideation.v1.json"
    );

    const exitCode = await runCli(["validate", file], captured.io);

    expect(exitCode).toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(captured.stdout).toHaveLength(1);
    expect(JSON.parse(captured.stdout[0]!)).toMatchObject({
      ok: true,
      command: "validate",
      workflow: {
        schemaVersion: "summer.workflow/v1",
        workflowId: "research-ideation"
      }
    });
  });

  it("rejects protocol extensions with a non-zero exit", async () => {
    const fixture = loadFixtureSource(
      "research-ideation.v1.json"
    ) as Record<string, unknown>;
    const source = {
      ...fixture,
      javascript: "process.exit(0)"
    };

    await withTemporaryFile(source, async (file) => {
      const captured = captureIo();
      const exitCode = await runCli(["validate", file], captured.io);
      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(JSON.parse(captured.stderr[0]!)).toMatchObject({
        ok: false,
        command: "validate",
        error: { code: "INVALID_WORKFLOW" }
      });
    });
  });

  it("fails closed when compile sees an unknown component", async () => {
    const fixture = loadFixtureSource("research-ideation.v1.json") as {
      readonly workflowId: string;
      readonly revision: number;
      readonly profile: unknown;
      readonly entryNodeId: string;
      readonly nodes: Array<Record<string, unknown>>;
      readonly edges: unknown;
      readonly metadata?: unknown;
    };
    const source = {
      schemaVersion: "summer.workflow/v1",
      workflowId: fixture.workflowId,
      revision: fixture.revision,
      profile: fixture.profile,
      entryNodeId: fixture.entryNodeId,
      nodes: fixture.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              component: {
                namespace: "unknown",
                name: "component",
                version: "1.0.0"
              }
            }
          : node
      ),
      edges: fixture.edges,
      ...(fixture.metadata === undefined ? {} : { metadata: fixture.metadata })
    };

    await withTemporaryFile(source, async (file) => {
      const captured = captureIo();
      const exitCode = await runCli(["compile", file], captured.io);
      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      const output = JSON.parse(captured.stderr[0]!);
      expect(output).toMatchObject({
        ok: false,
        command: "compile",
        error: { code: "WORKFLOW_COMPILE_FAILED" }
      });
      expect(output.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "UNRESOLVED_COMPONENT" })
        ])
      );
    });
  });

  it("returns usage errors as machine-readable JSON with exit code 2", async () => {
    const captured = captureIo();

    const exitCode = await runCli(["fixtures", "unexpected"], captured.io);

    expect(exitCode).toBe(2);
    expect(captured.stdout).toEqual([]);
    expect(JSON.parse(captured.stderr[0]!)).toMatchObject({
      ok: false,
      command: "fixtures",
      error: { code: "USAGE_ERROR" }
    });
  });

  it("exposes catalog and natural-language matching through the CLI", async () => {
    const catalogOutput = captureIo();
    expect(await runCli(["catalog"], catalogOutput.io)).toBe(0);
    expect(JSON.parse(catalogOutput.stdout[0]!)).toMatchObject({
      ok: true,
      command: "catalog",
      catalog: { componentCoverage: "complete" }
    });

    const matchOutput = captureIo();
    expect(
      await runCli(
        ["match-intent", "生成三个经过审计的研究构思"],
        matchOutput.io
      )
    ).toBe(0);
    expect(JSON.parse(matchOutput.stdout[0]!)).toMatchObject({
      ok: true,
      command: "match-intent",
      result: {
        workflows: {
          status: "matched",
          selected: {
            workflowId: "research-ideation",
            revision: 3,
            dispatchable: true
          }
        }
      }
    });
  });

  it("runs the available research-ideation flow through Mastra", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-run-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "test-idea");
    const inputFile = resolve(directory, "input.json");
    const resumeGrantFile = resolve(directory, "resume-grant.json");
    mkdirSync(workspaceDir, {recursive: true});
    writeFileSync(
      inputFile,
      JSON.stringify({
        schemaVersion: "summer.research-ideation-request/v2",
        query: "Find one testable uncertainty-aware geometry idea",
        workspaceDir,
        runDir,
        executionGrant: executionGrant(workspaceDir, runDir)
      }),
      "utf8"
    );
    writeFileSync(
      resumeGrantFile,
      JSON.stringify({
        ...executionGrant(workspaceDir, runDir),
        grantId: "grant-cli-resume-test"
      }),
      "utf8"
    );

    try {
      const driver = new FakeIdeaSparkDriver();
      const captured = captureIo();
      const exitCode = await runCli(
        ["run", "research-ideation", inputFile],
        captured.io,
        SUMMER_PROJECT_ROOT,
        {driver}
      );

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      const output = JSON.parse(captured.stdout[0]!);
      expect(output).toMatchObject({
        ok: true,
        command: "run",
        workflowId: "research-ideation",
        revision: 3,
        plan: {
          executionShape: "linear",
          nodeOrder: RESEARCH_IDEATION_NODE_ORDER
        },
        result: {
          current: {
            schemaVersion: "summer.research-ideation-result/v2",
            status: "done",
            runDir
          }
        }
      });
      expect(output.result.receipts).toHaveLength(31);
      expect(output.result.receipts.map((receipt: {nodeId: string}) => receipt.nodeId)).toEqual(
        RESEARCH_IDEATION_NODE_ORDER
      );
      expect(output.result.receipts[30].artifactRefs).toHaveLength(3);
      expect(output.receiptJournal).toMatchObject({receiptCount: 31});
      expect(driver.stages).toEqual([
        "literature-grounding",
        "bottleneck-diagnosis",
        "candidate-generation",
        "coherence-collision",
        "quality-gauntlet",
        "package-render"
      ]);

      const resumed = captureIo();
      const resumedExit = await runCli(
        ["resume", "research-ideation", runDir, resumeGrantFile],
        resumed.io,
        SUMMER_PROJECT_ROOT,
        {driver}
      );
      expect(resumedExit).toBe(0);
      const resumedOutput = JSON.parse(resumed.stdout[0]!);
      expect(resumedOutput).toMatchObject({
        command: "resume",
        requestManifest: resolve(runDir, ".summer", "request.json"),
        grantFile: resumeGrantFile
      });
      expect(resumedOutput.receiptJournal).toMatchObject({receiptCount: 62});
      expect(
        readFileSync(resolve(runDir, ".summer", "receipts.jsonl"), "utf8")
          .trim()
          .split("\n")
      ).toHaveLength(62);
      expect(driver.stages).toHaveLength(6);

      const reusedGrant = captureIo();
      expect(
        await runCli(
          ["resume", "research-ideation", runDir, resumeGrantFile],
          reusedGrant.io,
          SUMMER_PROJECT_ROOT,
          {driver}
        )
      ).toBe(1);
      expect(JSON.parse(reusedGrant.stderr[0]!)).toMatchObject({
        error: {code: "RESUME_GRANT_REUSED"}
      });
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("plans and executes a native Mastra dynamic workflow with both worker providers", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-dynamic-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, ".summer-runs", "dynamic-test");
    const inputFile = resolve(directory, "dynamic-input.json");
    mkdirSync(workspaceDir, {recursive: true});
    writeFileSync(
      inputFile,
      JSON.stringify({
        schemaVersion: "summer.dynamic-task-request/v1",
        task: "Analyze the code, then produce the smallest safe implementation.",
        workspaceDir,
        runDir,
        executionGrant: dynamicExecutionGrant(workspaceDir, runDir)
      }),
      "utf8"
    );
    const calls: Array<{command: string; args: readonly string[]}> = [];
    const runCommand = async (command: string, args: readonly string[]) => {
      calls.push({command, args});
      if (args[0] === "debug") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            models: [
              {
                slug: "gpt-5.6-luna",
                visibility: "list",
                priority: 8,
                supported_reasoning_levels: [{effort: "max"}]
              },
              {
                slug: "gpt-5.6-sol",
                visibility: "list",
                priority: 6,
                supported_reasoning_levels: [{effort: "xhigh"}, {effort: "ultra"}]
              }
            ]
          }),
          stderr: ""
        };
      }
      if (command === "codex" && args.includes("--output-schema")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            description: "Review with MiniMax, then implement with Codex.",
            graph: [
              {
                type: "mapping",
                id: "prepare-review",
                mapConfig: JSON.stringify({
                  model: {value: "MiniMax-M3"},
                  reasoningEffort: {value: "max"},
                  prompt: {template: "Review: ${initData.task}"}
                })
              },
              {type: "tool", id: "review", toolId: "minimax-worker"},
              {
                type: "mapping",
                id: "prepare-implementation",
                mapConfig: JSON.stringify({
                  model: {value: "codex/gpt-5.6-sol"},
                  reasoningEffort: {value: "ultra"},
                  prompt: {template: "Implement ${initData.task}; review=${stepResults.review.text}"}
                })
              },
              {type: "tool", id: "implement", toolId: "codex-worker"}
            ]
          }),
          stderr: ""
        };
      }
      return {
        exitCode: 0,
        stdout: command === "claude" ? "independent review" : "implementation complete",
        stderr: ""
      };
    };

    try {
      const captured = captureIo();
      expect(
        await runCli(
          ["run", "dynamic-agent-workflow", inputFile],
          captured.io,
          SUMMER_PROJECT_ROOT,
          {dynamicTask: {codexBin: "codex", claudeBin: "claude", runCommand}}
        )
      ).toBe(0);
      const output = JSON.parse(captured.stdout[0]!);
      expect(output).toMatchObject({
        command: "run",
        workflowId: "dynamic-agent-workflow",
        revision: 1,
        result: {
          current: {
            schemaVersion: "summer.dynamic-task-result/v1",
            planner: {model: "gpt-5.6-sol", reasoningEffort: "ultra"},
            workers: [{provider: "minimax"}, {provider: "codex"}],
            result: {provider: "codex", text: "implementation complete"}
          }
        }
      });
      expect(calls.map(({command}) => command)).toEqual([
        "codex",
        "codex",
        "claude",
        "codex"
      ]);
      expect(calls[1]!.args).toContain("--sandbox");
      expect(calls[1]!.args).not.toContain("--approve-for-me");
      expect(calls[3]!.args).toContain("--approve-for-me");
      expect(calls[3]!.args).not.toContain("--sandbox");
      expect(calls[3]!.args).toContain("gpt-5.6-sol");
      expect(calls[3]!.args).not.toContain("codex/gpt-5.6-sol");
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("fails closed when a resume request manifest was changed", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-resume-tamper-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "tampered");
    const grantFile = resolve(directory, "grant.json");
    mkdirSync(resolve(runDir, ".summer"), {recursive: true});
    writeFileSync(
      resolve(runDir, ".summer", "request.json"),
      JSON.stringify({
        schemaVersion: "summer.idea-spark-request-manifest/v2",
        requestDigest: "a".repeat(64),
        query: "a query changed after the digest was recorded",
        workspaceDir,
        runDir
      }),
      "utf8"
    );
    writeFileSync(
      grantFile,
      JSON.stringify(executionGrant(workspaceDir, runDir)),
      "utf8"
    );

    try {
      const captured = captureIo();
      expect(
        await runCli(
          ["resume", "research-ideation", runDir, grantFile],
          captured.io,
          SUMMER_PROJECT_ROOT,
          {driver: new FakeIdeaSparkDriver()}
        )
      ).toBe(1);
      expect(JSON.parse(captured.stderr[0]!)).toMatchObject({
        ok: false,
        command: "resume",
        error: {code: "RESUME_REQUEST_MANIFEST_TAMPERED"}
      });
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("fails closed when a required research provider has no positive evidence", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-provider-fail-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "provider-fail");
    const inputFile = resolve(directory, "input.json");
    mkdirSync(workspaceDir, {recursive: true});
    writeFileSync(
      inputFile,
      JSON.stringify({
        schemaVersion: "summer.research-ideation-request/v2",
        query: "Find one idea",
        workspaceDir,
        runDir,
        executionGrant: executionGrant(workspaceDir, runDir)
      }),
      "utf8"
    );
    try {
      const captured = captureIo();
      const exitCode = await runCli(
        ["run", "research-ideation", inputFile],
        captured.io,
        SUMMER_PROJECT_ROOT,
        {driver: new FakeIdeaSparkDriver(false)}
      );
      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(JSON.parse(captured.stderr[0]!)).toMatchObject({
        error: {
          code: "WORKFLOW_EXECUTION_FAILED",
          details: {
            error: {
              code: "IDEA_SPARK_PROVIDER_POLICY_FAILED",
              details: {
                statuses: expect.arrayContaining([
                  expect.objectContaining({
                    provider: "arxiv",
                    state: "unknown",
                    diagnosticCode: "no-evidence",
                    observations: expect.arrayContaining([
                      expect.objectContaining({state: "missing"})
                    ])
                  })
                ])
              }
            },
            receiptJournal: {receiptCount: 3}
          }
        }
      });
      const invocationDirs = readdirSync(
        resolve(runDir, ".summer", "provider-status")
      );
      expect(invocationDirs).toHaveLength(1);
      expect(
        readFileSync(
          resolve(
            runDir,
            ".summer",
            "provider-status",
            invocationDirs[0]!,
            "phase0-provider-gate.json"
          ),
          "utf8"
        )
      ).toContain('"state": "unknown"');
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("executes candidate and bottleneck retry conditions as explicit nodes", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "summer-retries-"));
    const workspaceDir = resolve(directory, "workspace");
    const runDir = resolve(workspaceDir, "ideaspark_run", "retries");
    const inputFile = resolve(directory, "input.json");
    mkdirSync(workspaceDir, {recursive: true});
    writeFileSync(
      inputFile,
      JSON.stringify({
        schemaVersion: "summer.research-ideation-request/v2",
        query: "Find one idea through bounded retries",
        workspaceDir,
        runDir,
        executionGrant: executionGrant(workspaceDir, runDir)
      }),
      "utf8"
    );
    try {
      const driver = new FakeIdeaSparkDriver(true, [
        "retry-candidate",
        "retry-bottleneck",
        "package"
      ]);
      const captured = captureIo();
      expect(
        await runCli(
          ["run", "research-ideation", inputFile],
          captured.io,
          SUMMER_PROJECT_ROOT,
          {driver}
        )
      ).toBe(0);
      const output = JSON.parse(captured.stdout[0]!);
      const nodeRuns = output.result.current.nodeRuns as Array<{
        nodeId: string;
        route: string;
        skipped: boolean;
      }>;
      expect(nodeRuns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            nodeId: "candidate-1-retry-decision",
            route: "retry-candidate",
            skipped: false
          }),
          expect.objectContaining({
            nodeId: "candidate-2-retry-decision",
            route: "retry-bottleneck",
            skipped: false
          }),
          expect.objectContaining({
            nodeId: "candidate-3-transition",
            route: "retry-bottleneck",
            skipped: true
          }),
          expect.objectContaining({
            nodeId: "bottleneck-retry-transition",
            route: "continue",
            skipped: false
          }),
          expect.objectContaining({
            nodeId: "post-rediagnosis-retry-decision",
            route: "package",
            skipped: false
          })
        ])
      );
      expect(driver.stages).toEqual([
        "literature-grounding",
        "bottleneck-diagnosis",
        "candidate-generation",
        "coherence-collision",
        "quality-gauntlet",
        "candidate-retry-transition",
        "candidate-generation",
        "coherence-collision",
        "quality-gauntlet",
        "bottleneck-retry-transition",
        "bottleneck-diagnosis",
        "candidate-generation",
        "coherence-collision",
        "quality-gauntlet",
        "package-render"
      ]);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });

  it("matches an explicit dynamic multi-model request", async () => {
    await withTemporaryFile(
      {
        schemaVersion: "summer.match-request/v1",
        intent: "请用 dynamic workflow 现场编排 Codex 和 MiniMax 智能体",
        target: "workflow",
        profile: "bounded-flow"
      },
      (file) => {
        const result = matchRepositoryCatalog(SUMMER_PROJECT_ROOT, file);
        expect(result.result.workflows).toMatchObject({
          status: "matched",
          selected: {
            workflowId: "dynamic-agent-workflow",
            dispatchable: true
          }
        });
        expect(result.result.components.status).toBe("not-requested");
      }
    );
  });

  it("does not retain the deleted factor workflows in matching", async () => {
    await withTemporaryFile(
      {
        schemaVersion: "summer.match-request/v1",
        intent: "量化因子回测和调优",
        target: "workflow"
      },
      (file) => {
        const result = matchRepositoryCatalog(SUMMER_PROJECT_ROOT, file);
        expect(result.result.workflows.status).toBe("no-match");
      }
    );
  });

  it("validates a protocol-complete new component proposal", async () => {
    const catalog = compileRepositoryCatalog(SUMMER_PROJECT_ROOT);
    const proposal = {
      schemaVersion: "summer.extension-proposal/v1",
      proposalId: "report-exporter-proposal",
      kind: "component",
      rationale: "The current catalog has no report exporter.",
      requestedCapabilities: ["report.export"],
      reuseAssessment: {
        catalogDigest: catalog.catalogDigest,
        reviewedWorkflowIds: ["research-ideation"],
        conclusion: "add-component",
        justification: "The reviewed workflow aggregates ideas but cannot export a report."
      },
      verification: {
        contractCases: ["valid report input produces a typed output"],
        failureCases: ["invalid path fails closed"],
        conformanceFixtures: ["fixtures/extensions/report-exporter.v1.json"],
        idempotencyCases: ["same idempotency key writes one report"]
      },
      schemas: [],
      component: {
        schemaVersion: "summer.component-descriptor/v1",
        ref: { namespace: "report", name: "export", version: "1.0.0" },
        kind: "tool",
        inputSchema: {
          namespace: "summer-fixture",
          name: "component-input",
          version: "1.0.0"
        },
        outputSchema: {
          namespace: "summer-fixture",
          name: "component-output",
          version: "1.0.0"
        },
        capabilities: ["report.export"],
        permissions: ["filesystem.report.write"],
        effect: "write-idempotent",
        supportsFanout: false
      },
      catalogEntry: {
        schemaVersion: "summer.component-catalog-entry/v1",
        component: { namespace: "report", name: "export", version: "1.0.0" },
        title: "Export report",
        summary: "Export a typed report artifact.",
        status: "candidate",
        keywords: ["export", "report", "导出报告"],
        domains: ["report"],
        runtimeIds: ["mastra-v0"]
      },
      implementation: {
        packagePath: "packages/report-exporter",
        registryModule: "packages/report-exporter/src/registry.ts",
        runtimeId: "mastra-v0"
      },
      controls: {
        humanAuthorization: "none",
        retryPolicy: "idempotent-only"
      }
    };

    await withTemporaryFile(proposal, (file) => {
      const result = checkRepositoryExtension(SUMMER_PROJECT_ROOT, file);
      expect(result.ok).toBe(true);
      expect(result.result.issues).toEqual([]);
    });
  });

  it("compiles and runtime-checks a workflow extension made only from registered components", async () => {
    const catalog = compileRepositoryCatalog(SUMMER_PROJECT_ROOT);
    const base = loadFixtureSource("research-ideation.v1.json") as {
      readonly profile: unknown;
      readonly entryNodeId: string;
      readonly nodes: unknown;
      readonly edges: unknown;
      readonly metadata?: unknown;
    };
    const workflow = {
      ...base,
      schemaVersion: "summer.workflow/v1",
      workflowId: "research-ideation-custom",
      revision: 1
    };
    const proposal = {
      schemaVersion: "summer.extension-proposal/v1",
      proposalId: "research-ideation-custom-proposal",
      kind: "workflow",
      rationale: "Compose registered ResearchStudio components under a new workflow identity.",
      requestedCapabilities: ["workflow.research.custom-ideation"],
      reuseAssessment: {
        catalogDigest: catalog.catalogDigest,
        reviewedWorkflowIds: ["research-ideation"],
        conclusion: "add-workflow",
        justification: "The topology is reusable but the intended contract needs an independent identity."
      },
      verification: {
        contractCases: ["terminal contract is reachable"],
        failureCases: ["invalid branch fails compilation"],
        conformanceFixtures: ["fixtures/workflows/research-ideation-custom.v1.json"]
      },
      workflow,
      catalogEntry: {
        schemaVersion: "summer.workflow-catalog-entry/v1",
        workflowId: "research-ideation-custom",
        revision: 1,
        profile: "bounded-flow",
        title: "Custom research ideation",
        summary: "A candidate workflow composed only from registered ResearchStudio components.",
        sourcePath: "workflows/research-ideation-custom.v1.json",
        status: "candidate",
        capabilities: ["workflow.research.custom-ideation"],
        selectors: {
          phrases: ["custom research ideation"],
          keywords: ["custom", "research", "ideation"]
        },
        runtimeIds: ["mastra-v0"]
      },
      implementation: {
        sourcePath: "workflows/research-ideation-custom.v1.json",
        runtimeIds: ["mastra-v0"]
      }
    };

    await withTemporaryFile(proposal, (file) => {
      const result = checkRepositoryExtension(SUMMER_PROJECT_ROOT, file);
      expect(result.ok).toBe(true);
      expect(result.result.compiledWorkflowDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(result.result.issues).toEqual([]);
    });
  });
});

const CATEGORY_AFTER_STAGE: Readonly<Record<IdeaSparkStage, IdeaSparkNavigatorCategory>> = {
  "literature-grounding": "phase1",
  "bottleneck-diagnosis": "phase2-generation",
  "candidate-generation": "phase2-coherence",
  "coherence-collision": "phase3",
  "quality-gauntlet": "phase4",
  "package-render": "terminal",
  "candidate-retry-transition": "phase2-generation",
  "bottleneck-retry-transition": "phase1",
  "finalize-failure": "terminal"
};

class FakeIdeaSparkDriver implements IdeaSparkDriver {
  readonly stages: IdeaSparkStage[] = [];
  readonly #emitProviderEvidence: boolean;
  readonly #gauntletRoutes: readonly (
    | "package"
    | "retry-candidate"
    | "retry-bottleneck"
  )[];
  #gauntletIndex = 0;
  #category: IdeaSparkNavigatorCategory = "phase0";

  constructor(
    emitProviderEvidence = true,
    gauntletRoutes: readonly (
      | "package"
      | "retry-candidate"
      | "retry-bottleneck"
    )[] = ["package"]
  ) {
    this.#emitProviderEvidence = emitProviderEvidence;
    this.#gauntletRoutes = gauntletRoutes;
  }

  async inspect(): Promise<IdeaSparkNavigatorSnapshotV1> {
    return snapshot(this.#category);
  }

  async advance(
    stage: IdeaSparkStage,
    request: IdeaSparkPreparedV2
  ): Promise<IdeaSparkStageAdvance> {
    this.stages.push(stage);
    this.#category = CATEGORY_AFTER_STAGE[stage];
    if (this.#emitProviderEvidence && stage === "literature-grounding") {
      const phase0 = resolve(request.runDir, "phase0");
      mkdirSync(phase0, {recursive: true});
      writeFileSync(resolve(phase0, "arxiv_phase0.json"), "[{}]\n", "utf8");
    }
    if (this.#emitProviderEvidence && stage === "coherence-collision") {
      const collision = resolve(request.runDir, "phase3_collision");
      mkdirSync(collision, {recursive: true});
      writeFileSync(resolve(collision, "arxiv_collision.json"), "[{}]\n", "utf8");
    }
    if (this.#category === "terminal") {
      const phase4 = resolve(request.runDir, "phase4");
      mkdirSync(phase4, {recursive: true});
      for (const file of ["idea.std.zh.md", "idea.std.en.md", "idea.detail.en.md"]) {
        writeFileSync(resolve(phase4, file), `# ${file}\n`, "utf8");
      }
    }
    if (stage === "quality-gauntlet") {
      const route = this.#gauntletRoutes[this.#gauntletIndex] ?? "package";
      this.#gauntletIndex += 1;
      if (route === "retry-candidate") {
        this.#category = "phase3";
        return {
          snapshot: navigatorSnapshot(
            "phase3",
            "Phase 3.2 verdict = abandon — internal retry available",
            "Archive attempt 1 and regenerate Phase 2.1+2.2 under negative constraints"
          )
        };
      }
      if (route === "retry-bottleneck") {
        this.#category = "phase3";
        return {
          snapshot: navigatorSnapshot(
            "phase3",
            "Abandon with a repeated unaddressable-subsumption lesson; one bottleneck-level retry available",
            "Archive attempt 2 including phase1 and re-diagnose the bottleneck"
          )
        };
      }
    }
    return {snapshot: snapshot(this.#category)};
  }
}

describe("native research v4", () => {
  it("uses typed conditional retry routes and persisted nested workflow checkpoints", async () => {
    const workspaceDir = mkdtempSync(resolve(tmpdir(), "summer-native-research-"));
    const runDir = resolve(workspaceDir, "ideaspark_run", "native");
    const base = new FakeIdeaSparkDriver(true, ["retry-candidate", "retry-bottleneck", "package"]);
    let gauntlet = 0;
    const routes = ["retry-candidate", "retry-bottleneck", "package"] as const;
    const driver: IdeaSparkDriver = {
      inspect: (...args) => base.inspect(),
      advance: async (stage, request) => {
        const advanced = await base.advance(stage, request);
        return { ...advanced, snapshot: { ...advanced.snapshot,
          ...(stage === "quality-gauntlet" ? { retryDecision: routes[gauntlet++]! } : {})
        } };
      }
    };
    const input = { schemaVersion: "summer.research-ideation-request/v2", query: "Find one idea", workspaceDir, runDir, executionGrant: executionGrant(workspaceDir, runDir) };
    try {
      const paused = await runNativeResearch(input, { driver, pauseAfter: 2 });
      expect(paused.status).toBe("suspended");
      const result = await runNativeResearch({ ...input, executionGrant: { ...input.executionGrant, grantId: "native-resume-grant" } }, { driver, resume: true });
      expect(result.status).toBe("success");
      expect(base.stages.filter((stage) => stage === "literature-grounding")).toHaveLength(1);
      expect(base.stages.filter((stage) => stage === "candidate-generation")).toHaveLength(3);
      expect(base.stages).toContain("bottleneck-retry-transition");
    } finally { rmSync(workspaceDir, { recursive: true, force: true }); }
  });
});

const RESEARCH_IDEATION_NODE_ORDER = [
  "freeze-request",
  "literature-grounding",
  "phase0-provider-gate",
  "bottleneck-diagnosis",
  "candidate-1-generation",
  "candidate-1-coherence-collision",
  "candidate-1-provider-gate",
  "candidate-1-gauntlet",
  "candidate-1-retry-decision",
  "candidate-2-transition",
  "candidate-2-generation",
  "candidate-2-coherence-collision",
  "candidate-2-provider-gate",
  "candidate-2-gauntlet",
  "candidate-2-retry-decision",
  "candidate-3-transition",
  "candidate-3-generation",
  "candidate-3-coherence-collision",
  "candidate-3-provider-gate",
  "candidate-3-gauntlet",
  "candidate-3-retry-decision",
  "bottleneck-retry-transition",
  "bottleneck-rediagnosis",
  "post-rediagnosis-generation",
  "post-rediagnosis-coherence-collision",
  "post-rediagnosis-provider-gate",
  "post-rediagnosis-gauntlet",
  "post-rediagnosis-retry-decision",
  "finalize-failure",
  "package-render",
  "verify-terminal"
] as const;

function executionGrant(workspaceDir: string, runDir: string) {
  return {
    schemaVersion: "summer.execution-grant/v1",
    grantId: "grant-cli-test",
    workflowId: "research-ideation",
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scope: {workspaceDir, runDir},
    permissions: [
      "filesystem.research-artifact.read",
      "filesystem.research-artifact.write",
      "network.research.retrieve",
      "process.codex.exec"
    ],
    networkDisclosure: {
      schemaVersion: "summer.network-disclosure/v1",
      purpose: "public-literature-retrieval",
      allowedProviders: ["arxiv", "openalex", "openreview", "semanticscholar"],
      allowedPayloads: [
        "scientific-query",
        "query-derived-search-terms",
        "public-reference-identifiers"
      ],
      forbiddenPayloads: [
        "credentials",
        "unpublished-data",
        "unrelated-local-file-content"
      ]
    },
    providerPolicy: {
      literature: {
        requiredProviders: ["arxiv"],
        minimumSuccessfulProviders: 1,
        requireBibliographicProvider: false
      },
      collision: {
        requiredProviders: ["arxiv"],
        minimumSuccessfulProviders: 1,
        requireBibliographicProvider: false
      }
    }
  };
}

function dynamicExecutionGrant(workspaceDir: string, runDir: string) {
  return {
    schemaVersion: "summer.dynamic-task-execution-grant/v1",
    grantId: "grant-dynamic-test",
    workflowId: "dynamic-agent-workflow",
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scope: {workspaceDir, runDir},
    permissions: [
      "filesystem.workspace.read",
      "filesystem.workspace.write",
      "network.model.inference",
      "process.codex.exec",
      "process.minimax.exec"
    ],
    workerPolicy: {
      providers: ["codex", "minimax"],
      minimaxModels: ["MiniMax-M3", "MiniMax-M3[1M]"],
      maxWorkerCalls: 4
    }
  };
}

function snapshot(
  category: IdeaSparkNavigatorCategory
): IdeaSparkNavigatorSnapshotV1 {
  const terminal = category === "terminal";
  return {
    schemaVersion: "summer.idea-spark-navigator-snapshot/v1",
    state: terminal ? "DONE — all cards complete" : `state-${category}`,
    step: terminal ? "No further action" : `step-${category}`,
    type: terminal ? "terminal" : "llm_subagent",
    category,
    digest: "a".repeat(64),
    ...(terminal ? {terminalStatus: "done" as const} : {})
  };
}

function navigatorSnapshot(
  category: IdeaSparkNavigatorCategory,
  state: string,
  step: string
): IdeaSparkNavigatorSnapshotV1 {
  return {
    schemaVersion: "summer.idea-spark-navigator-snapshot/v1",
    state,
    step,
    type: "llm_subagent",
    category,
    digest: "c".repeat(64)
  };
}
