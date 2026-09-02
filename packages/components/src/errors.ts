import type { ExactComponentRef, ExactSchemaRef } from "@summer/protocol";

export type RegistryReference = ExactComponentRef | ExactSchemaRef;

export function formatRegistryReference(reference: RegistryReference): string {
  return `${reference.namespace}/${reference.name}@${reference.version}`;
}

abstract class RegistryError extends Error {
  public abstract readonly code: string;
  public readonly ref: RegistryReference;

  protected constructor(message: string, ref: RegistryReference) {
    super(message);
    this.ref = Object.freeze({ ...ref });
  }
}

export class DuplicateSchemaError extends RegistryError {
  public readonly code = "DUPLICATE_SCHEMA" as const;

  public constructor(ref: ExactSchemaRef) {
    super(`Schema ${formatRegistryReference(ref)} is already registered`, ref);
    this.name = "DuplicateSchemaError";
  }
}

export class DuplicateSchemaBindingError extends RegistryError {
  public readonly code = "DUPLICATE_SCHEMA_BINDING" as const;

  public constructor(ref: ExactSchemaRef) {
    super(
      `Schema binding ${formatRegistryReference(ref)} is already registered`,
      ref
    );
    this.name = "DuplicateSchemaBindingError";
  }
}

export class DuplicateComponentError extends RegistryError {
  public readonly code = "DUPLICATE_COMPONENT" as const;

  public constructor(ref: ExactComponentRef) {
    super(`Component ${formatRegistryReference(ref)} is already registered`, ref);
    this.name = "DuplicateComponentError";
  }
}

export class DuplicateExecutorBindingError extends RegistryError {
  public readonly code = "DUPLICATE_EXECUTOR_BINDING" as const;

  public constructor(ref: ExactComponentRef) {
    super(
      `Executor binding ${formatRegistryReference(ref)} is already registered`,
      ref
    );
    this.name = "DuplicateExecutorBindingError";
  }
}

export class UnresolvedSchemaError extends RegistryError {
  public readonly code = "UNRESOLVED_SCHEMA" as const;

  public constructor(ref: ExactSchemaRef) {
    super(`Schema ${formatRegistryReference(ref)} is not registered`, ref);
    this.name = "UnresolvedSchemaError";
  }
}

export class UnresolvedSchemaBindingError extends RegistryError {
  public readonly code = "UNRESOLVED_SCHEMA_BINDING" as const;

  public constructor(ref: ExactSchemaRef) {
    super(`Schema binding ${formatRegistryReference(ref)} is not registered`, ref);
    this.name = "UnresolvedSchemaBindingError";
  }
}

export class UnresolvedComponentError extends RegistryError {
  public readonly code = "UNRESOLVED_COMPONENT" as const;

  public constructor(ref: ExactComponentRef) {
    super(`Component ${formatRegistryReference(ref)} is not registered`, ref);
    this.name = "UnresolvedComponentError";
  }
}

export class UnresolvedExecutorError extends RegistryError {
  public readonly code = "UNRESOLVED_EXECUTOR" as const;

  public constructor(ref: ExactComponentRef) {
    super(`Executor ${formatRegistryReference(ref)} is not bound`, ref);
    this.name = "UnresolvedExecutorError";
  }
}
