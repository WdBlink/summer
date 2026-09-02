import { describe, expect, it } from "vitest";

import type { ComponentRegistry } from "@summer/components";
import type {
  ComponentDescriptorV1,
  ExactComponentRef,
  ExactSchemaRef,
  PolicyKind,
  SchemaDescriptorV1,
  WorkflowSourceV1
} from "@summer/protocol";

import { WorkflowCompileError, compileWorkflow } from "./compiler.js";

const DIGEST_A = "a".repeat(64);
const INPUT_SCHEMA = { namespace: "summer", name: "input", version: "1.0.0" } as const;
const OUTPUT_SCHEMA = { namespace: "summer", name: "output", version: "1.0.0" } as const;
type TestSchemaBinding = ReturnType<ComponentRegistry["resolveSchemaBinding"]>;

const ACCEPT_ANY_BINDING = {
  safeParse: (input: unknown) => ({ success: true as const, data: input })
} as unknown as TestSchemaBinding;

const PROMPT_STRING_BINDING = {
  safeParse: (input: unknown) => {
    const valid =
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Object.keys(input).length === 1 &&
      typeof (input as { readonly prompt?: unknown }).prompt === "string" &&
      ((input as { readonly prompt: string }).prompt.length > 0);
    return valid
      ? { success: true as const, data: input }
      : { success: false as const, error: new Error("prompt must be a string") };
  }
} as unknown as TestSchemaBinding;

function ref(name: string): ExactComponentRef {
  return { namespace: "test", name, version: "1.0.0" };
}

function descriptor(
  name: string,
  options: {
    readonly policyKind?: PolicyKind;
    readonly kind?: ComponentDescriptorV1["kind"];
    readonly effect?: ComponentDescriptorV1["effect"];
    readonly supportsFanout?: boolean;
  } = {}
): ComponentDescriptorV1 {
  return {
    schemaVersion: "summer.component-descriptor/v1",
    ref: ref(name),
    kind: options.kind ?? (options.policyKind === undefined ? "tool" : "policy"),
    ...(options.policyKind === undefined ? {} : { policyKind: options.policyKind }),
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    capabilities: [],
    effect: options.effect ?? "none",
    supportsFanout: options.supportsFanout ?? false
  };
}

function registryWith(...descriptors: readonly ComponentDescriptorV1[]): ComponentRegistry {
  return registryWithInputBinding(ACCEPT_ANY_BINDING, descriptors);
}

function registryWithInputBinding(
  inputBinding: TestSchemaBinding | "missing" | "throws",
  descriptors: readonly ComponentDescriptorV1[]
): ComponentRegistry {
  const byRef = new Map(
    descriptors.map((item) => [
      `${item.ref.namespace}/${item.ref.name}@${item.ref.version}`,
      item
    ])
  );
  return {
    resolveDescriptor(componentRef: ExactComponentRef): ComponentDescriptorV1 {
      const key = `${componentRef.namespace}/${componentRef.name}@${componentRef.version}`;
      const found = byRef.get(key);
      if (found === undefined) {
        throw Object.assign(new Error(`Unresolved component: ${key}`), {
          code: "UNRESOLVED_COMPONENT" as const,
          ref: componentRef
        });
      }
      return found;
    },
    resolveSchema(schemaRef: ExactSchemaRef): SchemaDescriptorV1 {
      return {
        schemaVersion: "summer.schema-descriptor/v1",
        ref: schemaRef,
        jsonSchema: {}
      };
    },
    resolveSchemaBinding(schemaRef: ExactSchemaRef): TestSchemaBinding {
      if (schemaRef.name !== INPUT_SCHEMA.name) return ACCEPT_ANY_BINDING;
      if (inputBinding === "missing") {
        throw Object.assign(new Error("Missing exact input schema binding"), {
          code: "UNRESOLVED_SCHEMA_BINDING" as const,
          ref: schemaRef
        });
      }
      if (inputBinding === "throws") {
        throw new Error("schema registry unavailable");
      }
      return inputBinding;
    }
  } as unknown as ComponentRegistry;
}

function boundedSource(): WorkflowSourceV1 {
  return {
    schemaVersion: "summer.workflow/v1",
    workflowId: "test-flow",
    revision: 1,
    profile: { kind: "bounded-flow", terminalNodeIds: ["done"] },
    entryNodeId: "start",
    nodes: [
      { id: "start", component: ref("start"), dispatch: "route", maxAttempts: 1 },
      { id: "done", component: ref("done"), dispatch: "route", maxAttempts: 1 }
    ],
    edges: [
      { id: "start-done", from: "start", to: "done", condition: { kind: "always" } }
    ]
  };
}

function campaignSource(): WorkflowSourceV1 {
  return {
    schemaVersion: "summer.workflow/v1",
    workflowId: "test-campaign",
    revision: 1,
    profile: {
      kind: "iterative-campaign",
      terminalNodeIds: ["done"],
      activationNodeId: "activate",
      iterationNodeId: "iterate",
      experimentNodeId: "experiment",
      budgetNodeId: "budget",
      frameCheckNodeId: "frame",
      decisionNodeId: "decide",
      budgets: { maxExperiments: 3, maxAttemptsPerExperiment: 2 }
    },
    entryNodeId: "activate",
    nodes: [
      { id: "activate", component: ref("activate"), dispatch: "route", maxAttempts: 1 },
      {
        id: "iterate",
        component: ref("iterate"),
        join: "any",
        dispatch: "route",
        maxAttempts: 1
      },
      { id: "budget", component: ref("budget"), dispatch: "route", maxAttempts: 1 },
      {
        id: "frame",
        component: ref("frame"),
        join: "any",
        dispatch: "route",
        maxAttempts: 1
      },
      { id: "decide", component: ref("decide"), dispatch: "route", maxAttempts: 1 },
      {
        id: "experiment",
        component: ref("experiment"),
        join: "any",
        dispatch: "route",
        maxAttempts: 1
      },
      { id: "wait", component: ref("wait"), dispatch: "route", maxAttempts: 1 },
      { id: "done", component: ref("done"), dispatch: "route", maxAttempts: 1 }
    ],
    edges: [
      { id: "01", from: "activate", to: "iterate", condition: { kind: "always" } },
      { id: "02", from: "iterate", to: "experiment", condition: { kind: "always" } },
      {
        id: "02-experiment",
        from: "experiment",
        to: "frame",
        condition: { kind: "always" }
      },
      { id: "02-wait", from: "wait", to: "frame", condition: { kind: "always" } },
      { id: "03", from: "frame", to: "budget", condition: { kind: "always" } },
      { id: "04", from: "budget", to: "decide", condition: { kind: "always" } },
      ...([
        "replicate",
        "repair-runtime",
        "run-next-experiment",
        "recompile-hypothesis",
        "wait"
      ] as const).map((decision, index) => ({
        id: `decision-${index + 1}`,
        from: "decide",
        to:
          decision === "replicate" ||
          decision === "repair-runtime" ||
          decision === "run-next-experiment" ||
          decision === "recompile-hypothesis"
            ? "experiment"
            : decision === "wait"
              ? "wait"
              : "iterate",
        condition: { kind: "decision-is" as const, decision }
      })),
      {
        id: "decision-stop",
        from: "decide",
        to: "done",
        condition: { kind: "decision-is", decision: "stop" }
      }
    ]
  };
}

function campaignRegistry(extra: readonly ComponentDescriptorV1[] = []): ComponentRegistry {
  return registryWith(
    descriptor("activate", { policyKind: "activation" }),
    descriptor("iterate", { policyKind: "iteration" }),
    descriptor("experiment", { kind: "nested-workflow" }),
    descriptor("budget", { policyKind: "budget" }),
    descriptor("frame", { policyKind: "frame-check" }),
    descriptor("decide", { policyKind: "decision" }),
    descriptor("wait"),
    descriptor("done"),
    ...extra
  );
}

function compileIssueCodes(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowCompileError);
    return (error as WorkflowCompileError).issues.map((issue) => issue.code);
  }
  throw new Error("Expected workflow compilation to fail");
}

describe("compileWorkflow", () => {
  it("resolves exact descriptors and emits stable normalized digests", () => {
    const source = boundedSource();
    const registry = registryWith(descriptor("start"), descriptor("done"));

    const first = compileWorkflow(source, registry);
    const reordered = compileWorkflow(
      {
        ...source,
        profile: { ...source.profile, terminalNodeIds: [...source.profile.terminalNodeIds].reverse() },
        nodes: [...source.nodes].reverse(),
        edges: [...source.edges].reverse()
      },
      registry
    );
    const withUnusedRegistration = compileWorkflow(
      source,
      registryWith(descriptor("start"), descriptor("done"), descriptor("unused"))
    );

    expect(first.schemaVersion).toBe("summer.compiled-workflow/v1");
    expect(first.nodes.map((node) => node.id)).toEqual(["done", "start"]);
    expect(first.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.registryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.compiledDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered.sourceDigest).toBe(first.sourceDigest);
    expect(reordered.registryDigest).toBe(first.registryDigest);
    expect(reordered.compiledDigest).toBe(first.compiledDigest);
    expect(withUnusedRegistration.registryDigest).toBe(first.registryDigest);
    expect(withUnusedRegistration.compiledDigest).toBe(first.compiledDigest);
  });

  it("rejects an edge with an unknown endpoint", () => {
    const source = boundedSource();
    source.edges[0] = { ...source.edges[0]!, to: "missing" };

    expect(
      compileIssueCodes(() =>
        compileWorkflow(source, registryWith(descriptor("start"), descriptor("done")))
      )
    ).toContain("INVALID_EDGE_ENDPOINT");
  });

  it("rejects an unresolved exact component reference", () => {
    expect(
      compileIssueCodes(() => compileWorkflow(boundedSource(), registryWith(descriptor("done"))))
    ).toContain("UNRESOLVED_COMPONENT");
  });

  it("strictly rejects unknown source fields", () => {
    const source = { ...boundedSource(), javascript: "while (true) {}" };

    expect(
      compileIssueCodes(() =>
        compileWorkflow(source, registryWith(descriptor("start"), descriptor("done")))
      )
    ).toContain("INVALID_SOURCE");
  });

  it("rejects executable or accessor values without invoking them", () => {
    let getterCalls = 0;
    const sourceWithFunction = boundedSource() as unknown as Record<string, unknown>;
    sourceWithFunction["run"] = () => "not allowed";
    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          sourceWithFunction,
          registryWith(descriptor("start"), descriptor("done"))
        )
      )
    ).toContain("NON_DATA_SOURCE");

    const sourceWithGetter = boundedSource() as unknown as Record<string, unknown>;
    Object.defineProperty(sourceWithGetter, "script", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "not allowed";
      }
    });
    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          sourceWithGetter,
          registryWith(descriptor("start"), descriptor("done"))
        )
      )
    ).toContain("NON_DATA_SOURCE");
    expect(getterCalls).toBe(0);
  });

  it("rejects a cycle in bounded-flow", () => {
    const source = boundedSource();
    source.nodes.splice(1, 0, {
      id: "middle",
      component: ref("middle"),
      dispatch: "route",
      maxAttempts: 1
    });
    source.edges = [
      { id: "01", from: "start", to: "middle", condition: { kind: "always" } },
      {
        id: "02",
        from: "middle",
        to: "start",
        condition: { kind: "node-failed" }
      },
      {
        id: "03",
        from: "middle",
        to: "done",
        condition: { kind: "node-succeeded" }
      }
    ];

    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          source,
          registryWith(descriptor("start"), descriptor("middle"), descriptor("done"))
        )
      )
    ).toContain("BOUNDED_FLOW_CYCLE");
  });

  it("requires every iterative-campaign policy binding to name a real policy node", () => {
    const source = campaignSource();
    if (source.profile.kind !== "iterative-campaign") throw new Error("invalid fixture");
    source.profile.decisionNodeId = "missing-decision";

    expect(
      compileIssueCodes(() => compileWorkflow(source, campaignRegistry()))
    ).toContain("POLICY_NODE_NOT_FOUND");
  });

  it("requires the campaign entry to be its activation policy node", () => {
    const source = campaignSource();
    source.entryNodeId = "iterate";

    expect(
      compileIssueCodes(() => compileWorkflow(source, campaignRegistry()))
    ).toContain("CAMPAIGN_ENTRY_NOT_ACTIVATION");
  });

  it("requires a distinct nested-workflow node for each campaign experiment", () => {
    const missing = campaignSource();
    if (missing.profile.kind !== "iterative-campaign") throw new Error("invalid fixture");
    missing.profile.experimentNodeId = "missing-experiment";
    expect(compileIssueCodes(() => compileWorkflow(missing, campaignRegistry()))).toContain(
      "EXPERIMENT_NODE_NOT_FOUND"
    );

    const wrongKind = campaignSource();
    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          wrongKind,
          campaignRegistry([descriptor("experiment", { kind: "tool" })])
        )
      )
    ).toContain("EXPERIMENT_COMPONENT_MISMATCH");

    const overlapping = campaignSource();
    if (overlapping.profile.kind !== "iterative-campaign") {
      throw new Error("invalid fixture");
    }
    overlapping.profile.experimentNodeId = overlapping.profile.budgetNodeId;
    expect(
      compileIssueCodes(() => compileWorkflow(overlapping, campaignRegistry()))
    ).toContain("DUPLICATE_POLICY_NODE");
  });

  it("accepts one campaign graph whose cycle crosses budget and decision policies", () => {
    const compiled = compileWorkflow(campaignSource(), campaignRegistry());

    expect(compiled.profile.kind).toBe("iterative-campaign");
    expect(compiled.edges).toHaveLength(12);
  });

  it("requires every node to retain a path to a declared terminal", () => {
    const source = campaignSource();
    source.edges = source.edges.filter((edge) => edge.id !== "decision-stop");

    expect(
      compileIssueCodes(() => compileWorkflow(source, campaignRegistry()))
    ).toContain("NODE_CANNOT_REACH_TERMINAL");
  });

  it("requires frame-check to dominate budget on paths from campaign entry", () => {
    const source = campaignSource();
    const budgetIndex = source.nodes.findIndex((node) => node.id === "budget");
    source.nodes[budgetIndex] = { ...source.nodes[budgetIndex]!, join: "any" };
    source.edges = source.edges.map((edge) =>
      edge.id === "01"
        ? { ...edge, condition: { kind: "node-succeeded" as const } }
        : edge
    );
    source.edges.push({
      id: "entry-bypasses-frame",
      from: "activate",
      to: "budget",
      condition: { kind: "node-failed" }
    });

    const codes = compileIssueCodes(() => compileWorkflow(source, campaignRegistry()));
    expect(codes).toContain("CAMPAIGN_FRAME_CHECK_DOES_NOT_DOMINATE_BUDGET");
    expect(codes).not.toContain("CAMPAIGN_BUDGET_DOES_NOT_DOMINATE_DECISION");
  });

  it("requires budget to dominate decision on paths from campaign entry", () => {
    const source = campaignSource();
    const decisionIndex = source.nodes.findIndex((node) => node.id === "decide");
    source.nodes[decisionIndex] = { ...source.nodes[decisionIndex]!, join: "any" };
    source.edges = source.edges.map((edge) =>
      edge.id === "01"
        ? { ...edge, condition: { kind: "node-succeeded" as const } }
        : edge
    );
    source.edges.push({
      id: "entry-bypasses-budget",
      from: "activate",
      to: "decide",
      condition: { kind: "node-failed" }
    });

    const codes = compileIssueCodes(() => compileWorkflow(source, campaignRegistry()));
    expect(codes).toContain("CAMPAIGN_BUDGET_DOES_NOT_DOMINATE_DECISION");
  });

  it("rejects a campaign cycle that bypasses budget, frame-check, and decision", () => {
    const source = campaignSource();
    source.nodes.splice(5, 0, {
      id: "rogue",
      component: ref("rogue"),
      dispatch: "route",
      maxAttempts: 1
    });
    source.edges = source.edges.map((edge) =>
      edge.id === "02"
        ? { ...edge, condition: { kind: "node-succeeded" as const } }
        : edge
    );
    source.edges.push(
      {
        id: "rogue-in",
        from: "iterate",
        to: "rogue",
        condition: { kind: "node-failed" }
      },
      { id: "rogue-back", from: "rogue", to: "iterate", condition: { kind: "always" } }
    );

    const codes = compileIssueCodes(() =>
      compileWorkflow(source, campaignRegistry([descriptor("rogue")]))
    );
    expect(codes).toContain("CAMPAIGN_CYCLE_BYPASSES_BUDGET");
    expect(codes).toContain("CAMPAIGN_CYCLE_BYPASSES_FRAME_CHECK");
    expect(codes).toContain("CAMPAIGN_CYCLE_BYPASSES_DECISION");
  });

  it("rejects a cycle that crosses budget and decision but bypasses frame-check", () => {
    const source = campaignSource();
    const budgetIndex = source.nodes.findIndex((node) => node.id === "budget");
    source.nodes[budgetIndex] = { ...source.nodes[budgetIndex]!, join: "any" };
    source.edges = source.edges.map((edge) =>
      edge.id === "02-experiment"
        ? { ...edge, condition: { kind: "node-succeeded" as const } }
        : edge
    );
    source.edges.push({
      id: "experiment-bypasses-frame",
      from: "experiment",
      to: "budget",
      condition: { kind: "node-failed" }
    });

    const codes = compileIssueCodes(() =>
      compileWorkflow(source, campaignRegistry())
    );
    expect(codes).toContain("CAMPAIGN_CYCLE_BYPASSES_FRAME_CHECK");
    expect(codes).not.toContain("CAMPAIGN_CYCLE_BYPASSES_BUDGET");
    expect(codes).not.toContain("CAMPAIGN_CYCLE_BYPASSES_DECISION");
  });

  it("requires closed decision conditions on decision-node edges", () => {
    const source = campaignSource();
    source.edges = source.edges.map((edge) =>
      edge.id === "decision-3"
        ? { ...edge, condition: { kind: "always" as const } }
        : edge
    );

    expect(
      compileIssueCodes(() => compileWorkflow(source, campaignRegistry()))
    ).toContain("INVALID_DECISION_ROUTE");
  });

  it("requires exactly one outgoing route for every closed decision kind", () => {
    const missing = campaignSource();
    missing.edges = missing.edges.filter((edge) => edge.id !== "decision-1");
    expect(
      compileIssueCodes(() => compileWorkflow(missing, campaignRegistry()))
    ).toContain("DECISION_ROUTE_MISSING");

    const duplicate = campaignSource();
    duplicate.edges.push({
      id: "duplicate-replicate",
      from: "decide",
      to: "iterate",
      condition: { kind: "decision-is", decision: "replicate" }
    });
    expect(
      compileIssueCodes(() => compileWorkflow(duplicate, campaignRegistry()))
    ).toContain("DECISION_ROUTE_DUPLICATE");
  });

  it("rejects fixed decision kinds routed to the wrong semantic target", () => {
    const mismatches = [
      ["decision-1", "iterate"],
      ["decision-2", "iterate"],
      ["decision-3", "iterate"],
      ["decision-4", "iterate"]
    ] as const;

    for (const [edgeId, wrongTarget] of mismatches) {
      const source = campaignSource();
      source.edges = source.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, to: wrongTarget } : edge
      );
      expect(
        compileIssueCodes(() => compileWorkflow(source, campaignRegistry()))
      ).toContain("DECISION_ROUTE_TARGET_MISMATCH");
    }

    const swapped = campaignSource();
    swapped.edges = swapped.edges.map((edge) =>
      edge.id === "decision-3"
        ? { ...edge, to: "done" }
        : edge.id === "decision-stop"
          ? { ...edge, to: "experiment" }
          : edge
    );
    expect(
      compileIssueCodes(() => compileWorkflow(swapped, campaignRegistry()))
    ).toContain("DECISION_ROUTE_TARGET_MISMATCH");
  });

  it("rejects wait routes that terminate directly or cannot reach frame-check first", () => {
    const directTerminal = campaignSource();
    const terminalIndex = directTerminal.nodes.findIndex((node) => node.id === "done");
    directTerminal.nodes[terminalIndex] = {
      ...directTerminal.nodes[terminalIndex]!,
      join: "any"
    };
    directTerminal.nodes = directTerminal.nodes.filter((node) => node.id !== "wait");
    directTerminal.edges = directTerminal.edges
      .filter((edge) => edge.id !== "02-wait")
      .map((edge) => (edge.id === "decision-5" ? { ...edge, to: "done" } : edge));
    expect(
      compileIssueCodes(() => compileWorkflow(directTerminal, campaignRegistry()))
    ).toContain("DECISION_ROUTE_TARGET_MISMATCH");

    const missesFrame = campaignSource();
    const missesFrameTerminalIndex = missesFrame.nodes.findIndex(
      (node) => node.id === "done"
    );
    missesFrame.nodes[missesFrameTerminalIndex] = {
      ...missesFrame.nodes[missesFrameTerminalIndex]!,
      join: "any"
    };
    missesFrame.edges = missesFrame.edges.map((edge) =>
      edge.id === "02-wait" ? { ...edge, to: "done" } : edge
    );
    expect(
      compileIssueCodes(() => compileWorkflow(missesFrame, campaignRegistry()))
    ).toContain("DECISION_ROUTE_TARGET_MISMATCH");
  });

  it("validates static node input with the exact registered schema binding", () => {
    const valid = boundedSource();
    valid.nodes[0] = { ...valid.nodes[0]!, input: { prompt: "summer" } };
    const descriptors = [descriptor("start"), descriptor("done")];
    expect(() =>
      compileWorkflow(
        valid,
        registryWithInputBinding(
          PROMPT_STRING_BINDING,
          descriptors
        )
      )
    ).not.toThrow();

    const invalid = boundedSource();
    invalid.nodes[0] = { ...invalid.nodes[0]!, input: { prompt: 42 } };
    const codes = compileIssueCodes(() =>
      compileWorkflow(
        invalid,
        registryWithInputBinding(
          PROMPT_STRING_BINDING,
          descriptors
        )
      )
    );
    expect(codes).toContain("INVALID_STATIC_NODE_INPUT");
  });

  it("fails closed with a stable issue when static input has no schema binding", () => {
    const source = boundedSource();
    source.nodes[0] = { ...source.nodes[0]!, input: { prompt: "summer" } };
    const error = (() => {
      try {
        compileWorkflow(
          source,
          registryWithInputBinding("missing", [descriptor("start"), descriptor("done")])
        );
      } catch (caught) {
        return caught as WorkflowCompileError;
      }
      throw new Error("Expected compilation to fail");
    })();

    expect(error).toBeInstanceOf(WorkflowCompileError);
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        code: "UNRESOLVED_INPUT_SCHEMA_BINDING",
        path: "nodes.start.input"
      })
    );
  });

  it("converts schema binding exceptions into a stable compiler issue", () => {
    const source = boundedSource();
    source.nodes[0] = { ...source.nodes[0]!, input: "summer" };
    const error = (() => {
      try {
        compileWorkflow(
          source,
          registryWithInputBinding("throws", [descriptor("start"), descriptor("done")])
        );
      } catch (caught) {
        return caught as WorkflowCompileError;
      }
      throw new Error("Expected compilation to fail");
    })();

    expect(error.issues).toContainEqual(
      expect.objectContaining({
        code: "INPUT_SCHEMA_BINDING_ERROR",
        path: "nodes.start.input"
      })
    );
  });

  it("requires an idempotency key before retrying an effectful node", () => {
    const source = boundedSource();
    source.nodes[1] = { ...source.nodes[1]!, maxAttempts: 2 };

    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          source,
          registryWith(descriptor("start"), descriptor("done", { effect: "write-idempotent" }))
        )
      )
    ).toContain("RETRY_REQUIRES_IDEMPOTENCY_KEY");
  });

  it("rejects retry even with a key when the component declares non-idempotent writes", () => {
    const source = boundedSource();
    source.nodes[1] = {
      ...source.nodes[1]!,
      maxAttempts: 2,
      idempotencyKey: "run/node/attempt"
    };

    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          source,
          registryWith(
            descriptor("start"),
            descriptor("done", { effect: "write-non-idempotent" })
          )
        )
      )
    ).toContain("NON_IDEMPOTENT_COMPONENT_RETRY");
  });

  it("rejects unsupported or malformed fanout", () => {
    const source = boundedSource();
    source.nodes = [
      { ...source.nodes[0]!, dispatch: "fanout" },
      { id: "left", component: ref("left"), dispatch: "route", maxAttempts: 1 },
      { id: "right", component: ref("right"), dispatch: "route", maxAttempts: 1 },
      source.nodes[1]!
    ];
    source.edges = [
      { id: "01", from: "start", to: "left", condition: { kind: "always" } },
      { id: "02", from: "start", to: "right", condition: { kind: "always" } },
      { id: "03", from: "left", to: "done", condition: { kind: "always" } },
      { id: "04", from: "right", to: "done", condition: { kind: "always" } }
    ];

    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          source,
          registryWith(
            descriptor("start", { supportsFanout: false }),
            descriptor("left"),
            descriptor("right"),
            descriptor("done")
          )
        )
      )
    ).toContain("FANOUT_NOT_SUPPORTED");

    source.edges[1] = { ...source.edges[1]!, condition: { kind: "node-succeeded" } };
    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          source,
          registryWith(
            descriptor("start", { supportsFanout: true }),
            descriptor("left"),
            descriptor("right"),
            descriptor("done")
          )
        )
      )
    ).toContain("INVALID_FANOUT");
  });

  it("requires an explicit join policy for nodes with multiple incoming edges", () => {
    const source = boundedSource();
    source.nodes = [
      { ...source.nodes[0]!, dispatch: "fanout" },
      { id: "left", component: ref("left"), dispatch: "route", maxAttempts: 1 },
      { id: "right", component: ref("right"), dispatch: "route", maxAttempts: 1 },
      source.nodes[1]!
    ];
    source.edges = [
      { id: "01", from: "start", to: "left", condition: { kind: "always" } },
      { id: "02", from: "start", to: "right", condition: { kind: "always" } },
      { id: "03", from: "left", to: "done", condition: { kind: "node-succeeded" } },
      { id: "04", from: "right", to: "done", condition: { kind: "node-succeeded" } }
    ];
    const registry = registryWith(
      descriptor("start", { supportsFanout: true }),
      descriptor("left"),
      descriptor("right"),
      descriptor("done")
    );

    expect(compileIssueCodes(() => compileWorkflow(source, registry))).toContain(
      "AMBIGUOUS_JOIN"
    );

    source.nodes[3] = { ...source.nodes[3]!, join: "all" };
    expect(compileWorkflow(source, registry).nodes.find(({ id }) => id === "done")?.join).toBe(
      "all"
    );
  });

  it("rejects join-all fed by mutually exclusive outcomes of one predecessor", () => {
    const source = boundedSource();
    source.nodes[1] = { ...source.nodes[1]!, join: "all" };
    source.edges = [
      {
        id: "success",
        from: "start",
        to: "done",
        condition: { kind: "node-succeeded" }
      },
      {
        id: "failure",
        from: "start",
        to: "done",
        condition: { kind: "node-failed" }
      }
    ];

    const error = (() => {
      try {
        compileWorkflow(source, registryWith(descriptor("start"), descriptor("done")));
      } catch (caught) {
        return caught as WorkflowCompileError;
      }
      throw new Error("Expected compilation to fail");
    })();
    expect(error.issues).toContainEqual(
      expect.objectContaining({
        code: "UNSATISFIABLE_JOIN",
        path: "nodes.done.join"
      })
    );
  });

  it("rejects join-all fed through different predecessors on mutually exclusive routes", () => {
    const source = boundedSource();
    source.nodes = [
      source.nodes[0]!,
      { id: "success-work", component: ref("success-work"), dispatch: "route", maxAttempts: 1 },
      { id: "failure-work", component: ref("failure-work"), dispatch: "route", maxAttempts: 1 },
      { ...source.nodes[1]!, join: "all" }
    ];
    source.edges = [
      {
        id: "success-route",
        from: "start",
        to: "success-work",
        condition: { kind: "node-succeeded" }
      },
      {
        id: "failure-route",
        from: "start",
        to: "failure-work",
        condition: { kind: "node-failed" }
      },
      {
        id: "success-done",
        from: "success-work",
        to: "done",
        condition: { kind: "always" }
      },
      {
        id: "failure-done",
        from: "failure-work",
        to: "done",
        condition: { kind: "always" }
      }
    ];

    const error = (() => {
      try {
        compileWorkflow(
          source,
          registryWith(
            descriptor("start"),
            descriptor("success-work"),
            descriptor("failure-work"),
            descriptor("done")
          )
        );
      } catch (caught) {
        return caught as WorkflowCompileError;
      }
      throw new Error("Expected compilation to fail");
    })();

    expect(error.issues).toContainEqual(
      expect.objectContaining({
        code: "UNSATISFIABLE_JOIN",
        path: "nodes.done.join",
        message: expect.stringContaining("upstream route 'start'")
      })
    );
  });

  it("rejects an ambiguous route containing always plus another condition", () => {
    const source = boundedSource();
    source.nodes.splice(1, 0, {
      id: "alternate",
      component: ref("alternate"),
      dispatch: "route",
      maxAttempts: 1
    });
    source.edges = [
      { id: "01", from: "start", to: "alternate", condition: { kind: "always" } },
      { id: "02", from: "start", to: "done", condition: { kind: "node-succeeded" } },
      { id: "03", from: "alternate", to: "done", condition: { kind: "always" } }
    ];

    expect(
      compileIssueCodes(() =>
        compileWorkflow(
          source,
          registryWith(descriptor("start"), descriptor("alternate"), descriptor("done"))
        )
      )
    ).toContain("AMBIGUOUS_ROUTE");
  });
});
