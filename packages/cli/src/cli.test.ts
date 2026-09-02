import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FIXTURE_CONFORMANCE_REGISTRY_ID,
  createFixtureConformanceRegistry
} from "./conformance-registry.js";
import {
  FIXTURE_WORKFLOWS,
  compileFixtureWorkflows,
  compileWorkflowFile
} from "./commands.js";
import { SUMMER_PROJECT_ROOT, runCli, type CliIo } from "./cli.js";

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
});
