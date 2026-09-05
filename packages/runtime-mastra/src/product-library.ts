import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { executeProduct, validateProduct, digest, readJson, saveJson, productStatus, checkInput, ProductRequestSchema, type Product, type ProductRunner } from "./products.js";

const identity = (reference: string) => {
  const match = /^([a-z][a-z0-9-]{0,79})(?:@([1-9][0-9]*))?$/.exec(reference);
  if (!match) throw new Error("INVALID_PRODUCT_REFERENCE");
  return { id: match[1]!, version: match[2] ? Number(match[2]) : undefined };
};
const publishedDir = (root: string) => resolve(root, "products", "published");

export function listProducts(root: string) {
  const directory = publishedDir(root);
  if (!existsSync(directory)) return [];
  const defaults = existsSync(resolve(directory, "defaults.json")) ? readJson(resolve(directory, "defaults.json")) as Record<string, number> : {};
  return readdirSync(directory).filter((file) => /^[a-z][a-z0-9-]*@[1-9][0-9]*\.json$/.test(file)).map((file) => {
    const release = readJson(resolve(directory, file)) as { product: Product; digest: string; verification: unknown };
    const product = validateProduct(release.product);
    if (release.digest !== digest(product)) throw new Error(`PUBLISHED_DEFINITION_TAMPERED: ${file}`);
    return { product, reference: `${product.id}@${product.version}`, digest: release.digest, default: defaults[product.id] === product.version };
  });
}
export function loadProduct(root: string, reference: string) {
  const ref = identity(reference);
  const entry = listProducts(root).find(({ product, default: selected }) => product.id === ref.id && (ref.version ? product.version === ref.version : selected));
  if (!entry) throw new Error(`PRODUCT_NOT_PUBLISHED: ${reference}`);
  return entry.product;
}
export function matchProducts(root: string, intent: string) {
  const normalized = intent.toLowerCase();
  const candidates = listProducts(root).filter((entry) => entry.default).map((entry) => ({
    ...entry, reasons: entry.product.keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()))
  })).filter((entry) => entry.reasons.length > 0).sort((a, b) => b.reasons.length - a.reasons.length);
  return { status: candidates.length === 0 ? "no-match" : candidates.length > 1 ? "ambiguous" : "matched", candidates };
}

/** Promotion creates only a draft; the caller supplies reviewed parameterization.
 * No grants, raw receipts, or source input values are copied to the library. */
export function promoteProduct(root: string, runDir: string, candidateValue: unknown) {
  const source = productStatus(runDir);
  const result = source.result as { status?: string; definitionDigest?: string; inputDigest?: string } | null;
  const sourceIdentity = source.manifest.identity as { product: Product; input: Record<string, string>; workspaceDir: string; runDir: string };
  if (result?.status !== "accepted" || result.definitionDigest !== digest(sourceIdentity.product) || result.inputDigest !== digest(sourceIdentity.input)) throw new Error("PROMOTION_REQUIRES_ACCEPTED_RUN");
  const candidate = validateProduct({ ...validateProduct(candidateValue), sourceRun: source.manifest.digest });
  const serialized = JSON.stringify(candidate);
  if ([sourceIdentity.workspaceDir, sourceIdentity.runDir].some((path) => serialized.includes(path))) throw new Error("PROMOTION_PRIVATE_PATH");
  const path = resolve(root, "products", "drafts", `${candidate.id}@${candidate.version}.json`);
  mkdirSync(resolve(root, "products", "drafts"), { recursive: true });
  writeFileSync(path, JSON.stringify(candidate, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  // A digest-only provenance sidecar keeps source task content out of the product.
  saveJson(`${path}.source.json`, { sourceInputDigest: result.inputDigest, sourceDefinitionDigest: result.definitionDigest });
  return { status: "draft", path, digest: digest(candidate) };
}

const SuiteSchema = z.object({ cases: z.array(z.object({
  kind: z.enum(["normal", "invalid-input", "failure"]),
  request: z.unknown(), expectedError: z.string().min(1).optional()
}).strict()).min(3) }).strict();
export async function verifyProduct(path: string, suiteValue: unknown, options: { runner?: ProductRunner } = {}) {
  const product = validateProduct(readJson(path));
  const suite = SuiteSchema.parse(suiteValue);
  for (const kind of ["normal", "invalid-input", "failure"]) if (!suite.cases.some((item) => item.kind === kind)) throw new Error(`VERIFICATION_CASE_MISSING: ${kind}`);
  const source = existsSync(`${path}.source.json`) ? readJson(`${path}.source.json`) as { sourceInputDigest: string } : undefined;
  const cases = [];
  for (const item of suite.cases) {
    if (item.kind === "invalid-input") {
      let rejected = false;
      try { checkInput(product, ProductRequestSchema.parse(item.request).input); } catch { rejected = true; }
      if (!rejected) throw new Error("INVALID_CASE_ACCEPTED");
      cases.push({ kind: item.kind, passed: true });
      continue;
    }
    const request = ProductRequestSchema.parse(item.request);
    if (item.kind === "normal" && source?.sourceInputDigest === digest(request.input)) throw new Error("VERIFICATION_REQUIRES_DIFFERENT_INPUT");
    if (item.kind === "failure" && (!item.expectedError || !/^(ARTIFACT_|EXECUTION_|WRITE_DENIED|MODEL_DENIED|CALL_BUDGET_)/.test(item.expectedError))) throw new Error("FAILURE_CASE_REQUIRES_EXPECTED_RUNTIME_ERROR");
    let result: unknown;
    try { result = await executeProduct(product, request, options); }
    catch (error) {
      if (item.kind !== "failure" || !(error instanceof Error) || !error.message.startsWith(item.expectedError!)) throw error;
      cases.push({ kind: item.kind, passed: true, error: error.message, runDir: request.grant.runDir });
      continue;
    }
    if (item.kind === "failure") throw new Error("FAILURE_CASE_DID_NOT_FAIL");
    if ((result as { status: string }).status !== "accepted") throw new Error("NORMAL_CASE_NOT_ACCEPTED");
    cases.push({ kind: item.kind, passed: true, result });
  }
  const report = { schemaVersion: "summer.verification/v2", definitionDigest: digest(product), cases, verifiedAt: new Date().toISOString() };
  saveJson(`${path}.verification.json`, report);
  return report;
}

export function publishProduct(root: string, path: string) {
  const product = validateProduct(readJson(path));
  const report = readJson(`${path}.verification.json`) as { definitionDigest: string; cases: { kind: string; passed: boolean }[] };
  if (report.definitionDigest !== digest(product)) throw new Error("VERIFICATION_STALE");
  if (!["normal", "invalid-input", "failure"].every((kind) => report.cases.some((item) => item.kind === kind && item.passed))) throw new Error("VERIFICATION_INCOMPLETE");
  const directory = publishedDir(root);
  mkdirSync(directory, { recursive: true });
  const pathOut = resolve(directory, `${product.id}@${product.version}.json`);
  const publicVerification = { reportDigest: digest(report), cases: report.cases.map(({ kind, passed }) => ({ kind, passed })) };
  writeFileSync(pathOut, JSON.stringify({ product, digest: digest(product), verification: publicVerification }, null, 2) + "\n", { flag: "wx" });
  selectProduct(root, `${product.id}@${product.version}`);
  return { status: "published", reference: `${product.id}@${product.version}`, path: pathOut };
}
export function selectProduct(root: string, reference: string) {
  const ref = identity(reference);
  if (!ref.version) throw new Error("EXACT_VERSION_REQUIRED");
  loadProduct(root, reference);
  const path = resolve(publishedDir(root), "defaults.json");
  const defaults = existsSync(path) ? readJson(path) as Record<string, number> : {};
  saveJson(path, { ...defaults, [ref.id]: ref.version });
  return { selected: reference };
}
