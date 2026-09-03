import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ComponentRegistry, type ComponentExecutor } from "@summer/components";
import {
  COMPILED_WORKFLOW_SCHEMA_VERSION,
  computeCompiledWorkflowDigest,
  parseCompiledWorkflowV1,
  sha256Canonical,
  type CompiledWorkflowV1,
  type ComponentDescriptorV1,
  type ComponentEffect,
  type ComponentKind,
  type JsonValue,
  type NodeReceiptV1,
  type WorkflowEdgeV1
} from "@summer/protocol";

import {
  MastraAdapterError,
  MASTRA_V0_SUPPORT_MATRIX,
  SummerMastraEnvelopeV1Schema,
  createMastraWorkflow,
  planMastraWorkflow
} from "./index.js";

const schemaRef = { namespace: "test", name: "json", version: "1.0.0" } as const;

interface TestComponent {
  readonly descriptor: ComponentDescriptorV1;
  readonly executor: ComponentExecutor;
}

function component(
  name: string,
  executor: ComponentExecutor,
  options: {
    readonly supportsFanout?: boolean;
    readonly effect?: ComponentEffect;
    readonly kind?: ComponentKind;
  } = {}
): TestComponent {
  return {
    descriptor: {
      schemaVersion: "summer.component-descriptor/v1",
      ref: { namespace: "test", name, version: "1.0.0" },
      kind: options.kind ?? "tool",
      inputSchema: schemaRef,
      outputSchema: schemaRef,
      capabilities: [],
      permissions: [],
      effect: options.effect ?? "none",
      supportsFanout: options.supportsFanout ?? false
    },
    executor
  };
}

function makeRegistry(
  components: readonly TestComponent[],
  options: { readonly bindSchemas?: boolean; readonly bindExecutors?: boolean } = {}
): ComponentRegistry {
  const registry = new ComponentRegistry();
  registry.registerSchema(
    {
      schemaVersion: "summer.schema-descriptor/v1",
      ref: schemaRef,
      jsonSchema: {}
    },
    options.bindSchemas === false ? undefined : z.json()
  );
  for (const item of components) {
    registry.registerDescriptor(item.descriptor);
    if (options.bindExecutors !== false) {
      registry.bindExecutor(item.descriptor.ref, item.executor);
    }
  }
  return registry;
}

function registrySubsetDigest(components: readonly TestComponent[]): string {
  return sha256Canonical({
    schemaVersion: "summer.component-registry-subset/v1",
    schemas: [
      {
        schemaVersion: "summer.schema-descriptor/v1",
        ref: schemaRef,
        jsonSchema: {}
      }
    ],
    components: components
      .map((item) => item.descriptor)
      .sort((left, right) => left.ref.name.localeCompare(right.ref.name, "en"))
  });
}

interface NodeInput {
  readonly id: string;
  readonly component: TestComponent;
  readonly dispatch?: "route" | "fanout";
  readonly join?: "all" | "any";
  readonly input?: JsonValue;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly idempotencyKey?: string;
}

function makeCompiled(
  nodes: readonly NodeInput[],
  edges: readonly WorkflowEdgeV1[],
  options: {
    readonly profile?: CompiledWorkflowV1["profile"];
    readonly entryNodeId?: string;
  } = {}
): CompiledWorkflowV1 {
  const unique = [
    ...new Map(nodes.map((node) => [node.component.descriptor.ref.name, node.component])).values()
  ];
  const profile =
    options.profile ??
    ({
      kind: "bounded-flow",
      terminalNodeIds: [nodes.at(-1)?.id]
    } as CompiledWorkflowV1["profile"]);
  const stable = {
    schemaVersion: COMPILED_WORKFLOW_SCHEMA_VERSION,
    workflowId: "test-workflow",
    revision: 1,
    profile,
    entryNodeId: options.entryNodeId ?? (nodes[0]?.id as string),
    nodes: nodes.map((node) => ({
      id: node.id,
      component: node.component.descriptor.ref,
      dispatch: node.dispatch ?? "route",
      ...(node.join === undefined ? {} : { join: node.join }),
      maxAttempts: node.maxAttempts ?? 1,
      ...(node.input === undefined ? {} : { input: node.input }),
      ...(node.timeoutMs === undefined ? {} : { timeoutMs: node.timeoutMs }),
      ...(node.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: node.idempotencyKey }),
      resolvedComponent: node.component.descriptor
    })),
    edges: [...edges],
    sourceDigest: sha256Canonical({ fixture: "source" }),
    registryDigest: registrySubsetDigest(unique)
  };
  return parseCompiledWorkflowV1({
    ...stable,
    compiledDigest: computeCompiledWorkflowDigest(stable),
    compiledAt: "2026-09-03T00:00:00.000Z"
  });
}

function edge(
  id: string,
  from: string,
  to: string,
  kind: "always" | "node-succeeded" | "node-failed" = "node-succeeded"
): WorkflowEdgeV1 {
  return { id, from, to, condition: { kind } };
}

describe("Mastra v0 adapter", () => {
  it("publishes the exact support boundary as data", () => {
    expect(MASTRA_V0_SUPPORT_MATRIX).toEqual({
      profiles: ["bounded-flow"],
      executionShapes: ["linear", "single-fork-join"],
      routeEdgeCondition: "node-succeeded",
      fanoutEdgeCondition: "always",
      joins: ["all"],
      maxStructuredFanouts: 1,
      campaignScheduling: false,
      humanGateSuspension: false,
      nonIdempotentWrites: false
    });
  });

  it("executes a compiled linear bounded flow with schema validation", async () => {
    const contexts: Array<{ readonly nodeId: string; readonly attempt: number }> = [];
    const first = component("first", (input, context) => {
      contexts.push(context);
      return (input as number) + 1;
    });
    const second = component("second", (input, context) => {
      contexts.push(context);
      return (input as number) * 2;
    });
    const compiled = makeCompiled(
      [
        { id: "first", component: first },
        { id: "second", component: second }
      ],
      [edge("first-second", "first", "second")]
    );
    const binding = createMastraWorkflow(
      compiled,
      makeRegistry([first, second])
    );

    expect(binding.plan).toMatchObject({
      executionShape: "linear",
      nodeOrder: ["first", "second"]
    });
    const run = await binding.workflow.createRun({ runId: "run-linear" });
    const result = await run.start({
      inputData: {
        schemaVersion: "summer.mastra-run-input/v1",
        input: 2,
        campaignId: "campaign-1",
        experimentId: "experiment-1"
      }
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    const envelope = SummerMastraEnvelopeV1Schema.parse(result.result);
    expect(envelope.current).toBe(6);
    expect(envelope.outputs).toEqual({ first: 3, second: 6 });
    expect(envelope.receipts).toMatchObject([
      {nodeId: "first", attempt: 1, status: "succeeded"},
      {nodeId: "second", attempt: 1, status: "succeeded"}
    ]);
    expect(envelope.receipts.every(({outputDigest}) => outputDigest !== undefined)).toBe(true);
    expect(contexts).toMatchObject([
      { nodeId: "first", attempt: 1 },
      { nodeId: "second", attempt: 1 }
    ]);
  });

  it("uses a node's static input, including null, instead of predecessor output", async () => {
    const first = component("first", () => 99);
    const second = component("second", (input) =>
      input === null ? "explicit-null" : "wrong-input"
    );
    const compiled = makeCompiled(
      [
        { id: "first", component: first },
        { id: "second", component: second, input: null }
      ],
      [edge("first-second", "first", "second")]
    );
    const { workflow } = createMastraWorkflow(
      compiled,
      makeRegistry([first, second])
    );
    const result = await (await workflow.createRun()).start({
      inputData: { schemaVersion: "summer.mastra-run-input/v1", input: 1 }
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(SummerMastraEnvelopeV1Schema.parse(result.result).current).toBe(
      "explicit-null"
    );
  });

  it("maps maxAttempts to Mastra retries without changing attempt numbering", async () => {
    const attempts: number[] = [];
    const flaky = component("flaky", (input, context) => {
      attempts.push(context.attempt);
      if (context.attempt === 1) throw new Error("retry me");
      return input;
    });
    const compiled = makeCompiled(
      [{ id: "flaky", component: flaky, maxAttempts: 2 }],
      []
    );
    const { workflow } = createMastraWorkflow(compiled, makeRegistry([flaky]));
    const result = await (await workflow.createRun()).start({
      inputData: { schemaVersion: "summer.mastra-run-input/v1", input: "ok" }
    });
    expect(result.status).toBe("success");
    expect(attempts).toEqual([1, 2]);
  });

  it("enforces node timeouts and aborts the component signal", async () => {
    let observedAbort = false;
    const receipts: NodeReceiptV1[] = [];
    const slow = component(
      "slow",
      (_input, context) =>
        new Promise((_resolve, reject) => {
          context.signal?.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(context.signal?.reason);
            },
            { once: true }
          );
        })
    );
    const compiled = makeCompiled(
      [{ id: "slow", component: slow, timeoutMs: 5 }],
      []
    );
    const { workflow } = createMastraWorkflow(compiled, makeRegistry([slow]), {
      onReceipt: (receipt) => {
        receipts.push(receipt);
      }
    });
    const result = await (await workflow.createRun()).start({
      inputData: { schemaVersion: "summer.mastra-run-input/v1", input: "wait" }
    });
    expect(result.status).toBe("failed");
    expect(observedAbort).toBe(true);
    if (result.status !== "failed") throw new Error("expected failure");
    expect(result.error).toMatchObject({ code: "MASTRA_COMPONENT_TIMEOUT" });
    expect(receipts).toMatchObject([
      {
        status: "failed",
        error: {code: "MASTRA_COMPONENT_TIMEOUT"}
      }
    ]);
  });

  it("executes one structured fork/join with deterministic join input", async () => {
    const fork = component("fork", (input) => (input as number) + 1, {
      supportsFanout: true
    });
    const left = component("left", (input) => (input as number) + 1);
    const right = component("right", (input) => (input as number) + 2);
    const join = component("join", (input) => {
      const values = input as Record<string, number>;
      return (values.left as number) + (values.right as number);
    });
    const terminal = component("terminal", (input) => input);
    const components = [fork, left, right, join, terminal] as const;
    const compiled = makeCompiled(
      [
        { id: "fork", component: fork, dispatch: "fanout" },
        { id: "left", component: left },
        { id: "right", component: right },
        { id: "join", component: join, join: "all" },
        { id: "terminal", component: terminal }
      ],
      [
        edge("fork-left", "fork", "left", "always"),
        edge("fork-right", "fork", "right", "always"),
        edge("left-join", "left", "join"),
        edge("right-join", "right", "join"),
        edge("join-terminal", "join", "terminal")
      ]
    );
    const binding = createMastraWorkflow(compiled, makeRegistry(components));
    expect(binding.plan).toMatchObject({
      executionShape: "single-fork-join",
      prefixNodeIds: ["fork"],
      branches: [["left"], ["right"]],
      joinNodeId: "join",
      suffixNodeIds: ["join", "terminal"]
    });

    const result = await (await binding.workflow.createRun()).start({
      inputData: { schemaVersion: "summer.mastra-run-input/v1", input: 1 }
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    const envelope = SummerMastraEnvelopeV1Schema.parse(result.result);
    expect(envelope.current).toBe(7);
    expect(envelope.outputs).toMatchObject({
      fork: 2,
      left: 3,
      right: 4,
      join: 7,
      terminal: 7
    });
  });

  it("rejects campaign control instead of turning it into a Mastra loop", () => {
    const policy = component("policy", (input) => input);
    const compiled = makeCompiled(
      [{ id: "policy", component: policy }],
      [],
      {
        profile: {
          kind: "iterative-campaign",
          terminalNodeIds: ["policy"],
          activationNodeId: "policy",
          iterationNodeId: "policy",
          experimentNodeId: "policy",
          budgetNodeId: "policy",
          frameCheckNodeId: "policy",
          decisionNodeId: "policy",
          budgets: { maxExperiments: 2, maxAttemptsPerExperiment: 1 }
        }
      }
    );

    expect(() => planMastraWorkflow(compiled)).toThrowError(MastraAdapterError);
    try {
      planMastraWorkflow(compiled);
    } catch (error) {
      expect((error as MastraAdapterError).issues).toContainEqual(
        expect.objectContaining({ code: "UNSUPPORTED_PROFILE" })
      );
    }
  });

  it("rejects failure routing because Mastra then() would change its meaning", () => {
    const first = component("first", (input) => input);
    const terminal = component("terminal", (input) => input);
    const compiled = makeCompiled(
      [
        { id: "first", component: first },
        { id: "terminal", component: terminal }
      ],
      [edge("recover", "first", "terminal", "node-failed")]
    );
    expect(() => planMastraWorkflow(compiled)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "UNSUPPORTED_EDGE_CONDITION" })
        ])
      })
    );
  });

  it("rejects join-any instead of guessing winner and cancellation semantics", () => {
    const fork = component("fork", (input) => input, { supportsFanout: true });
    const left = component("left", (input) => input);
    const right = component("right", (input) => input);
    const join = component("join", (input) => input);
    const compiled = makeCompiled(
      [
        { id: "fork", component: fork, dispatch: "fanout" },
        { id: "left", component: left },
        { id: "right", component: right },
        { id: "join", component: join, join: "any" }
      ],
      [
        edge("fork-left", "fork", "left", "always"),
        edge("fork-right", "fork", "right", "always"),
        edge("left-join", "left", "join"),
        edge("right-join", "right", "join")
      ]
    );
    expect(() => planMastraWorkflow(compiled)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "UNSUPPORTED_JOIN_SEMANTICS" })
        ])
      })
    );
  });

  it("rejects non-idempotent writes until receipt-guarded replay exists", () => {
    const write = component("write", (input) => input, {
      effect: "write-non-idempotent"
    });
    const compiled = makeCompiled([{ id: "write", component: write }], []);
    expect(() => createMastraWorkflow(compiled, makeRegistry([write]))).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "UNSUPPORTED_COMPONENT_EFFECT" })
        ])
      })
    );
  });

  it("rejects human gates until suspend/resume has a typed protocol", () => {
    const gate = component("gate", (input) => input, { kind: "human-gate" });
    const compiled = makeCompiled([{ id: "gate", component: gate }], []);
    expect(() => createMastraWorkflow(compiled, makeRegistry([gate]))).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "UNSUPPORTED_COMPONENT_KIND" })
        ])
      })
    );
  });

  it("fails closed when an executor or schema binding is absent", () => {
    const only = component("only", (input) => input);
    const compiled = makeCompiled([{ id: "only", component: only }], []);
    expect(() =>
      createMastraWorkflow(
        compiled,
        makeRegistry([only], { bindExecutors: false, bindSchemas: false })
      )
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "RUNTIME_BINDING_MISSING" })
        ])
      })
    );
  });
});
