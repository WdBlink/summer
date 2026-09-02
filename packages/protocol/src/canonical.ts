import { createHash } from "node:crypto";

import type { JsonValue } from "./primitives.js";

export class NonCanonicalValueError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "NonCanonicalValueError";
  }
}

function encodeCanonical(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new NonCanonicalValueError(`${path} contains a non-finite number`);
      }
      return JSON.stringify(value);
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      throw new NonCanonicalValueError(
        `${path} contains non-JSON value of type ${typeof value}`
      );
    case "object": {
      if (seen.has(value)) {
        throw new NonCanonicalValueError(`${path} contains a circular reference`);
      }
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value
            .map((entry, index) => encodeCanonical(entry, `${path}[${index}]`, seen))
            .join(",")}]`;
        }

        const prototype = Object.getPrototypeOf(value) as object | null;
        if (prototype !== Object.prototype && prototype !== null) {
          throw new NonCanonicalValueError(`${path} must be a plain JSON object`);
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
          throw new NonCanonicalValueError(`${path} contains symbol keys`);
        }

        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `{${keys
          .map((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(record, key);
            if (
              descriptor === undefined ||
              descriptor.get !== undefined ||
              descriptor.set !== undefined
            ) {
              throw new NonCanonicalValueError(`${path}.${key} must be a data property`);
            }
            return `${JSON.stringify(key)}:${encodeCanonical(
              record[key],
              `${path}.${key}`,
              seen
            )}`;
          })
          .join(",")}}`;
      } finally {
        seen.delete(value);
      }
    }
  }

  throw new NonCanonicalValueError(`${path} contains an unsupported value`);
}

/** Returns a stable JSON representation with recursively sorted object keys. */
export function canonicalJson(value: JsonValue | unknown): string {
  return encodeCanonical(value, "$", new Set<object>());
}

/** Returns the lowercase SHA-256 hex digest of {@link canonicalJson}. */
export function sha256Canonical(value: JsonValue | unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
