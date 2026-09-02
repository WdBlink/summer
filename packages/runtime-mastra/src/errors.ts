export type MastraAdapterIssueCode =
  | "INVALID_COMPILED_WORKFLOW"
  | "UNSUPPORTED_PROFILE"
  | "UNSUPPORTED_EDGE_CONDITION"
  | "UNSUPPORTED_JOIN_SEMANTICS"
  | "UNSUPPORTED_GRAPH_SHAPE"
  | "UNSUPPORTED_MULTIPLE_FANOUTS"
  | "UNSUPPORTED_COMPONENT_KIND"
  | "UNSUPPORTED_COMPONENT_EFFECT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "RUNTIME_BINDING_MISSING";

export interface MastraAdapterIssue {
  readonly code: MastraAdapterIssueCode;
  readonly message: string;
  readonly path?: string;
}

export class MastraAdapterError extends Error {
  public readonly code = "MASTRA_ADAPTER_REJECTED" as const;
  public readonly issues: readonly MastraAdapterIssue[];

  public constructor(issues: readonly MastraAdapterIssue[]) {
    super(
      `Mastra adapter rejected the compiled workflow with ${issues.length} issue${
        issues.length === 1 ? "" : "s"
      }: ${issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`
    );
    this.name = "MastraAdapterError";
    this.issues = Object.freeze([...issues]);
  }
}

export class MastraComponentTimeoutError extends Error {
  public readonly code = "MASTRA_COMPONENT_TIMEOUT" as const;
  public readonly nodeId: string;
  public readonly timeoutMs: number;

  public constructor(nodeId: string, timeoutMs: number) {
    super(`Summer node '${nodeId}' exceeded its ${timeoutMs}ms execution timeout`);
    this.name = "MastraComponentTimeoutError";
    this.nodeId = nodeId;
    this.timeoutMs = timeoutMs;
  }
}
