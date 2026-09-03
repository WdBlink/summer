import { describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  ComponentDescriptorV1,
  ExactComponentRef,
  ExactSchemaRef,
  SchemaDescriptorV1
} from "@summer/protocol";
import {
  ComponentRegistry,
  DuplicateComponentError,
  DuplicateExecutorBindingError,
  DuplicateSchemaError,
  UnresolvedComponentError,
  UnresolvedSchemaError
} from "./index.js";

const inputRef = {
  namespace: "summer.test",
  name: "input",
  version: "1.0.0"
} as const;
const outputRef = {
  namespace: "summer.test",
  name: "output",
  version: "1.0.0"
} as const;
const componentRef = {
  namespace: "summer.test",
  name: "echo",
  version: "1.0.0"
} as const;

const schemaDescriptor = (
  ref: ExactSchemaRef
): SchemaDescriptorV1 => ({
  schemaVersion: "summer.schema-descriptor/v1",
  ref,
  jsonSchema: { type: "object", additionalProperties: false }
});

const componentDescriptor: ComponentDescriptorV1 = {
  schemaVersion: "summer.component-descriptor/v1",
  ref: componentRef,
  kind: "tool",
  inputSchema: inputRef,
  outputSchema: outputRef,
  capabilities: ["test/echo"],
  permissions: [],
  effect: "none",
  supportsFanout: false
};

function populatedRegistry(): ComponentRegistry {
  return new ComponentRegistry()
    .registerSchema(
      schemaDescriptor(inputRef),
      z.object({ message: z.string() }).strict()
    )
    .registerSchema(
      schemaDescriptor(outputRef),
      z.object({ echoed: z.string() }).strict()
    )
    .registerDescriptor(componentDescriptor);
}

describe("ComponentRegistry", () => {
  it("resolves exact versions without compatible/latest fallback", () => {
    const registry = populatedRegistry();

    expect(registry.resolveDescriptor(componentRef)).toEqual(componentDescriptor);
    expect(() =>
      registry.resolveDescriptor({ ...componentRef, version: "1.0.1" })
    ).toThrow(UnresolvedComponentError);
  });

  it("rejects duplicate descriptors and unresolved schema dependencies", () => {
    const registry = populatedRegistry();
    expect(() => registry.registerDescriptor(componentDescriptor)).toThrow(
      DuplicateComponentError
    );
    expect(() => registry.registerSchema(schemaDescriptor(inputRef))).toThrow(
      DuplicateSchemaError
    );

    const missing: ExactComponentRef = {
      namespace: "summer.test",
      name: "missing-schema-tool",
      version: "1.0.0"
    };
    expect(() =>
      new ComponentRegistry().registerDescriptor({
        ...componentDescriptor,
        ref: missing
      })
    ).toThrow(UnresolvedSchemaError);
  });

  it("keeps executor bindings out of serializable snapshots and digests", () => {
    const registry = populatedRegistry();
    const digestBeforeBinding = registry.digest();
    const executor = (input: Parameters<ReturnType<typeof registry.resolveExecutor>>[0]) => {
      const message =
        typeof input === "object" && input !== null && !Array.isArray(input)
          ? input["message"]
          : undefined;
      return { echoed: String(message) };
    };

    registry.bindExecutor(componentRef, executor);

    expect(registry.resolveExecutor(componentRef)).toBe(executor);
    expect(registry.digest()).toBe(digestBeforeBinding);
    expect(JSON.stringify(registry.snapshot())).not.toContain("executor");
    expect(JSON.stringify(registry.snapshot())).not.toContain("function");
    expect(() => registry.bindExecutor(componentRef, executor)).toThrow(
      DuplicateExecutorBindingError
    );
  });

  it("returns defensive descriptor copies", () => {
    const registry = populatedRegistry();
    const resolved = registry.resolveDescriptor(componentRef);
    resolved.capabilities.push("mutated/outside-registry");

    expect(registry.resolveDescriptor(componentRef).capabilities).toEqual([
      "test/echo"
    ]);
  });

  it("orders registry snapshots deterministically", () => {
    const secondInput = {
      namespace: "summer.test",
      name: "aaa",
      version: "1.0.0"
    } as const;
    const registry = populatedRegistry().registerSchema(
      schemaDescriptor(secondInput),
      z.unknown()
    );

    expect(registry.snapshot().schemas.map(({ ref }) => ref.name)).toEqual([
      "aaa",
      "input",
      "output"
    ]);
  });
});
