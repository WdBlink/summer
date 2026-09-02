import { z } from "zod";

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "must start with an alphanumeric character and contain only alphanumerics, ., _, :, or -"
  );

export const ExactVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "must be one exact semantic version, not a range"
  );

export const Sha256DigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 hex digest");

export const TimestampSchema = z.iso.datetime({ offset: true });

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const NonEmptyStringSchema = z.string().trim().min(1);

export const EvidenceReferenceSchema = z
  .object({
    ref: NonEmptyStringSchema,
    digest: Sha256DigestSchema.optional()
  })
  .strict();

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
