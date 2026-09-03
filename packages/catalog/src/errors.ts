export interface CatalogIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export class CatalogCompileError extends Error {
  readonly code = "CATALOG_COMPILE_FAILED" as const;
  readonly issues: readonly CatalogIssue[];

  constructor(issues: readonly CatalogIssue[]) {
    super(
      `Catalog compilation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}`
    );
    this.name = "CatalogCompileError";
    this.issues = Object.freeze([...issues]);
  }
}
