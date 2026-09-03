import {
  mkdirSync,
  mkdtempSync,
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
  IdeaSparkPreparedV1,
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

  it("compiles exactly the three repository fixtures", () => {
    const result = compileFixtureWorkflows(SUMMER_PROJECT_ROOT);

    expect(result.fixtureCount).toBe(3);
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
    expect(catalog.workflows).toHaveLength(3);
    expect(catalog.components).toHaveLength(23);
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
      "factor-strategy-experiment.v1.json"
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
        workflowId: "factor-strategy-experiment"
      }
    });
  });

  it("rejects protocol extensions with a non-zero exit", async () => {
    const fixture = loadFixtureSource(
      "factor-strategy-experiment.v1.json"
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
    const fixture = loadFixtureSource("factor-strategy-experiment.v1.json") as {
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
            revision: 2,
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
    mkdirSync(workspaceDir, {recursive: true});
    writeFileSync(
      inputFile,
      JSON.stringify({
        schemaVersion: "summer.research-ideation-request/v1",
        query: "Find one testable uncertainty-aware geometry idea",
        workspaceDir,
        runDir
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
        revision: 2,
        plan: {
          executionShape: "linear",
          nodeOrder: ["freeze-request", "run-idea-spark", "verify-terminal"]
        },
        result: {
          current: {
            schemaVersion: "summer.research-ideation-result/v1",
            status: "done",
            runDir
          }
        }
      });
      expect(output.result.receipts).toHaveLength(3);
      expect(output.result.receipts.map((receipt: {nodeId: string}) => receipt.nodeId)).toEqual([
        "freeze-request",
        "run-idea-spark",
        "verify-terminal"
      ]);
      expect(output.result.receipts[2].artifactRefs).toHaveLength(3);
      expect(driver.stages).toEqual([
        "literature-grounding",
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

  it("matches a Chinese iterative-research request to the factor campaign", async () => {
    await withTemporaryFile(
      {
        schemaVersion: "summer.match-request/v1",
        intent: "请持续进行量化因子发现和策略迭代调优",
        target: "workflow",
        profile: "iterative-campaign"
      },
      (file) => {
        const result = matchRepositoryCatalog(SUMMER_PROJECT_ROOT, file);
        expect(result.result.workflows).toMatchObject({
          status: "matched",
          selected: {
            workflowId: "factor-discovery-tuning",
            dispatchable: false,
            dispatchBlockers: expect.arrayContaining(["entry-status:fixture"])
          }
        });
        expect(result.result.components.status).toBe("not-requested");
      }
    );
  });

  it("reports ambiguity instead of guessing between equally scored factor flows", async () => {
    await withTemporaryFile(
      {
        schemaVersion: "summer.match-request/v1",
        intent: "因子",
        target: "workflow"
      },
      (file) => {
        const result = matchRepositoryCatalog(SUMMER_PROJECT_ROOT, file);
        expect(result.result.workflows.status).toBe("ambiguous");
        expect(
          result.result.workflows.candidates.map(({ workflowId }) => workflowId)
        ).toEqual([
          "factor-discovery-tuning",
          "factor-strategy-experiment"
        ]);
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
  "package-render": "terminal"
};

class FakeIdeaSparkDriver implements IdeaSparkDriver {
  readonly stages: IdeaSparkStage[] = [];
  #category: IdeaSparkNavigatorCategory = "phase0";

  async inspect(): Promise<IdeaSparkNavigatorSnapshotV1> {
    return snapshot(this.#category);
  }

  async advance(
    stage: IdeaSparkStage,
    request: IdeaSparkPreparedV1
  ): Promise<IdeaSparkStageAdvance> {
    this.stages.push(stage);
    this.#category = CATEGORY_AFTER_STAGE[stage];
    if (this.#category === "terminal") {
      const phase4 = resolve(request.runDir, "phase4");
      mkdirSync(phase4, {recursive: true});
      for (const file of ["idea.std.zh.md", "idea.std.en.md", "idea.detail.en.md"]) {
        writeFileSync(resolve(phase4, file), `# ${file}\n`, "utf8");
      }
    }
    return {snapshot: snapshot(this.#category)};
  }
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
