import {
  ComponentDescriptorV1Schema,
  ExactComponentRefSchema,
  ExactSchemaRefSchema,
  SchemaDescriptorV1Schema,
  canonicalJson,
  sha256Canonical,
  type ComponentDescriptorV1,
  type ExactComponentRef,
  type ExactSchemaRef,
  type JsonValue,
  type SchemaDescriptorV1
} from "@summer/protocol";
import { z, type ZodType } from "zod";

import {
  DuplicateComponentError,
  DuplicateExecutorBindingError,
  DuplicateSchemaBindingError,
  DuplicateSchemaError,
  UnresolvedComponentError,
  UnresolvedExecutorError,
  UnresolvedSchemaBindingError,
  UnresolvedSchemaError,
  formatRegistryReference
} from "./errors.js";

export interface ComponentExecutionContext {
  readonly workflowId: string;
  readonly workflowRevision: number;
  readonly runId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly campaignId?: string;
  readonly experimentId?: string;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export type ComponentExecutor = (
  input: JsonValue,
  context: ComponentExecutionContext
) => JsonValue | Promise<JsonValue>;

export type SchemaBinding = ZodType<unknown>;

export const ComponentRegistrySnapshotV1Schema = z
  .object({
    schemaVersion: z.literal("summer.component-registry/v1"),
    schemas: z.array(SchemaDescriptorV1Schema),
    components: z.array(ComponentDescriptorV1Schema)
  })
  .strict();

export type ComponentRegistrySnapshotV1 = z.infer<
  typeof ComponentRegistrySnapshotV1Schema
>;

function registryKey(reference: ExactComponentRef | ExactSchemaRef): string {
  return formatRegistryReference(reference);
}

function cloneSchemaDescriptor(descriptor: SchemaDescriptorV1): SchemaDescriptorV1 {
  return SchemaDescriptorV1Schema.parse(JSON.parse(canonicalJson(descriptor)));
}

function cloneComponentDescriptor(
  descriptor: ComponentDescriptorV1
): ComponentDescriptorV1 {
  return ComponentDescriptorV1Schema.parse(JSON.parse(canonicalJson(descriptor)));
}

/**
 * Exact-version registry for serializable descriptors and non-serializable runtime
 * bindings. Snapshots deliberately exclude validators and executors.
 */
export class ComponentRegistry {
  readonly #schemas = new Map<string, SchemaDescriptorV1>();
  readonly #schemaBindings = new Map<string, SchemaBinding>();
  readonly #components = new Map<string, ComponentDescriptorV1>();
  readonly #executors = new Map<string, ComponentExecutor>();

  public registerSchema(
    input: SchemaDescriptorV1,
    binding?: SchemaBinding
  ): this {
    const descriptor = SchemaDescriptorV1Schema.parse(input);
    const key = registryKey(descriptor.ref);
    if (this.#schemas.has(key)) {
      throw new DuplicateSchemaError(descriptor.ref);
    }
    this.#schemas.set(key, cloneSchemaDescriptor(descriptor));
    if (binding !== undefined) {
      this.#schemaBindings.set(key, binding);
    }
    return this;
  }

  public bindSchema(refInput: ExactSchemaRef, binding: SchemaBinding): this {
    const ref = ExactSchemaRefSchema.parse(refInput);
    const key = registryKey(ref);
    if (!this.#schemas.has(key)) {
      throw new UnresolvedSchemaError(ref);
    }
    if (this.#schemaBindings.has(key)) {
      throw new DuplicateSchemaBindingError(ref);
    }
    this.#schemaBindings.set(key, binding);
    return this;
  }

  public registerDescriptor(input: ComponentDescriptorV1): this {
    const descriptor = ComponentDescriptorV1Schema.parse(input);
    const key = registryKey(descriptor.ref);
    if (this.#components.has(key)) {
      throw new DuplicateComponentError(descriptor.ref);
    }

    this.resolveSchema(descriptor.inputSchema);
    this.resolveSchema(descriptor.outputSchema);
    this.#components.set(key, cloneComponentDescriptor(descriptor));
    return this;
  }

  public bindExecutor(
    refInput: ExactComponentRef,
    executor: ComponentExecutor
  ): this {
    const ref = ExactComponentRefSchema.parse(refInput);
    const key = registryKey(ref);
    if (!this.#components.has(key)) {
      throw new UnresolvedComponentError(ref);
    }
    if (this.#executors.has(key)) {
      throw new DuplicateExecutorBindingError(ref);
    }
    this.#executors.set(key, executor);
    return this;
  }

  public resolveSchema(refInput: ExactSchemaRef): SchemaDescriptorV1 {
    const ref = ExactSchemaRefSchema.parse(refInput);
    const descriptor = this.#schemas.get(registryKey(ref));
    if (descriptor === undefined) {
      throw new UnresolvedSchemaError(ref);
    }
    return cloneSchemaDescriptor(descriptor);
  }

  public resolveSchemaBinding(refInput: ExactSchemaRef): SchemaBinding {
    const ref = ExactSchemaRefSchema.parse(refInput);
    const binding = this.#schemaBindings.get(registryKey(ref));
    if (binding === undefined) {
      throw new UnresolvedSchemaBindingError(ref);
    }
    return binding;
  }

  public resolveDescriptor(
    refInput: ExactComponentRef
  ): ComponentDescriptorV1 {
    const ref = ExactComponentRefSchema.parse(refInput);
    const descriptor = this.#components.get(registryKey(ref));
    if (descriptor === undefined) {
      throw new UnresolvedComponentError(ref);
    }
    return cloneComponentDescriptor(descriptor);
  }

  public resolveExecutor(refInput: ExactComponentRef): ComponentExecutor {
    const ref = ExactComponentRefSchema.parse(refInput);
    const executor = this.#executors.get(registryKey(ref));
    if (executor === undefined) {
      throw new UnresolvedExecutorError(ref);
    }
    return executor;
  }

  public snapshot(): ComponentRegistrySnapshotV1 {
    const byReference = <T extends { ref: ExactComponentRef | ExactSchemaRef }>(
      left: T,
      right: T
    ): number => {
      const leftKey = registryKey(left.ref);
      const rightKey = registryKey(right.ref);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    };

    return ComponentRegistrySnapshotV1Schema.parse({
      schemaVersion: "summer.component-registry/v1",
      schemas: [...this.#schemas.values()]
        .map(cloneSchemaDescriptor)
        .sort(byReference),
      components: [...this.#components.values()]
        .map(cloneComponentDescriptor)
        .sort(byReference)
    });
  }

  public digest(): string {
    return sha256Canonical(this.snapshot());
  }
}
