import {
  MatchRequestV1Schema,
  type ComponentKind,
  type ExactComponentRef,
  type MatchRequestV1
} from "@summer/protocol";

import {
  componentRefKey,
  type CompiledComponentCatalogEntryV1,
  type CompiledSummerCatalogV1,
  type CompiledWorkflowCatalogEntryV1
} from "./catalog.js";

export type MatchResolutionStatus =
  | "matched"
  | "ambiguous"
  | "no-match"
  | "not-requested";

const MIN_SELECTION_MARGIN = 4;

export interface WorkflowMatchCandidate {
  readonly workflowId: string;
  readonly revision: number;
  readonly profile: string;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly runtimeIds: readonly string[];
  readonly capabilities: readonly string[];
  readonly components: readonly string[];
  readonly dispatchable: boolean;
  readonly dispatchBlockers: readonly string[];
}

export interface ComponentMatchCandidate {
  readonly component: ExactComponentRef;
  readonly kind: ComponentKind;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly runtimeIds: readonly string[];
  readonly capabilities: readonly string[];
  readonly permissions: readonly string[];
  readonly dispatchable: boolean;
  readonly dispatchBlockers: readonly string[];
}

export interface MatchResolution<T> {
  readonly status: MatchResolutionStatus;
  readonly selected?: T;
  readonly candidates: readonly T[];
}

export interface SummerMatchResultV1 {
  readonly schemaVersion: "summer.match-result/v1";
  readonly catalogId: string;
  readonly catalogDigest: string;
  readonly request: MatchRequestV1;
  readonly workflows: MatchResolution<WorkflowMatchCandidate>;
  readonly components: MatchResolution<ComponentMatchCandidate>;
  readonly capabilityGaps: readonly string[];
}

export function matchCatalog(
  input: unknown,
  catalog: CompiledSummerCatalogV1
): SummerMatchResultV1 {
  const request = MatchRequestV1Schema.parse(input);
  const includeWorkflows = request.target === "workflow" || request.target === "all";
  const includeComponents =
    request.target === "component" || request.target === "all";

  const workflowCandidates = includeWorkflows
    ? catalog.workflows
        .filter((entry) => workflowEligible(entry, request))
        .map((entry) => scoreWorkflow(entry, request, catalog))
        .filter((candidate) => candidate.score > 0)
        .sort(compareCandidates)
        .slice(0, request.maxCandidates)
    : [];
  const componentCandidates = includeComponents
    ? catalog.components
        .filter((entry) => componentEligible(entry, request))
        .map((entry) => scoreComponent(entry, request, catalog))
        .filter((candidate) => candidate.score > 0)
        .sort(compareCandidates)
        .slice(0, request.maxCandidates)
    : [];

  const availableCapabilities = new Set<string>();
  for (const workflow of catalog.workflows) {
    for (const capability of workflow.capabilities) availableCapabilities.add(capability);
    for (const capability of workflow.componentCapabilities) {
      availableCapabilities.add(capability);
    }
  }
  for (const component of catalog.components) {
    for (const capability of component.descriptor.capabilities) {
      availableCapabilities.add(capability);
    }
  }

  return {
    schemaVersion: "summer.match-result/v1",
    catalogId: catalog.catalogId,
    catalogDigest: catalog.catalogDigest,
    request,
    workflows: resolveCandidates(workflowCandidates, includeWorkflows),
    components: resolveCandidates(componentCandidates, includeComponents),
    capabilityGaps: request.requiredCapabilities.filter(
      (capability) => !availableCapabilities.has(capability)
    )
  };
}

function workflowEligible(
  entry: CompiledWorkflowCatalogEntryV1,
  request: MatchRequestV1
): boolean {
  if (entry.status === "deprecated") return false;
  if (request.profile !== undefined && entry.profile !== request.profile) return false;
  if (!intersectsConstraint(entry.runtimeIds, request.runtimeIds)) return false;
  const capabilities = new Set([
    ...entry.capabilities,
    ...entry.componentCapabilities
  ]);
  return request.requiredCapabilities.every((capability) =>
    capabilities.has(capability)
  );
}

function componentEligible(
  entry: CompiledComponentCatalogEntryV1,
  request: MatchRequestV1
): boolean {
  if (entry.status === "deprecated") return false;
  if (
    request.componentKinds.length > 0 &&
    !request.componentKinds.includes(entry.descriptor.kind)
  ) {
    return false;
  }
  if (!intersectsConstraint(entry.runtimeIds, request.runtimeIds)) return false;
  const capabilities = new Set(entry.descriptor.capabilities);
  return request.requiredCapabilities.every((capability) =>
    capabilities.has(capability)
  );
}

function scoreWorkflow(
  entry: CompiledWorkflowCatalogEntryV1,
  request: MatchRequestV1,
  catalog?: CompiledSummerCatalogV1
): WorkflowMatchCandidate {
  const reasons: string[] = [];
  let score = 0;
  if (request.preferredWorkflowIds.includes(entry.workflowId)) {
    score += 100;
    reasons.push("preferred-workflow-id");
  }
  score += request.requiredCapabilities.length * 25;
  if (request.requiredCapabilities.length > 0) reasons.push("required-capabilities");
  const selectorScore = scoreSelectors(request.intent, {
    phrases: entry.selectors.phrases,
    keywords: entry.selectors.keywords,
    domains: entry.selectors.domains,
    searchable: [entry.title, entry.summary, entry.workflowId, ...entry.capabilities]
  });
  score += selectorScore.score;
  reasons.push(...selectorScore.reasons);
  const dispatch = workflowDispatchability(entry, catalog);
  return {
    workflowId: entry.workflowId,
    revision: entry.revision,
    profile: entry.profile,
    title: entry.title,
    summary: entry.summary,
    status: entry.status,
    score,
    reasons,
    runtimeIds: entry.runtimeIds,
    capabilities: [...entry.capabilities, ...entry.componentCapabilities].sort(),
    components: entry.components,
    dispatchable: dispatch.dispatchable,
    dispatchBlockers: dispatch.blockers
  };
}

function scoreComponent(
  entry: CompiledComponentCatalogEntryV1,
  request: MatchRequestV1,
  catalog?: CompiledSummerCatalogV1
): ComponentMatchCandidate {
  const reasons: string[] = [];
  let score = 0;
  const key = componentRefKey(entry.component);
  if (request.preferredComponents.some((ref) => componentRefKey(ref) === key)) {
    score += 100;
    reasons.push("preferred-component-ref");
  }
  score += request.requiredCapabilities.length * 25;
  if (request.requiredCapabilities.length > 0) reasons.push("required-capabilities");
  const selectorScore = scoreSelectors(request.intent, {
    phrases: [],
    keywords: entry.keywords,
    domains: entry.domains,
    searchable: [
      entry.title,
      entry.summary,
      entry.component.namespace,
      entry.component.name,
      ...entry.descriptor.capabilities
    ]
  });
  score += selectorScore.score;
  reasons.push(...selectorScore.reasons);
  const dispatch = entryDispatchability(entry.status, entry.runtimeIds, catalog);
  return {
    component: entry.component,
    kind: entry.descriptor.kind,
    title: entry.title,
    summary: entry.summary,
    status: entry.status,
    score,
    reasons,
    runtimeIds: entry.runtimeIds,
    capabilities: entry.descriptor.capabilities,
    permissions: entry.descriptor.permissions,
    dispatchable: dispatch.dispatchable,
    dispatchBlockers: dispatch.blockers
  };
}

function scoreSelectors(
  intent: string,
  selectors: {
    readonly phrases: readonly string[];
    readonly keywords: readonly string[];
    readonly domains: readonly string[];
    readonly searchable: readonly string[];
  }
): { readonly score: number; readonly reasons: readonly string[] } {
  const normalizedIntent = normalize(intent);
  const reasons: string[] = [];
  let score = 0;
  const phraseMatches = selectors.phrases.filter((phrase) =>
    normalizedIntent.includes(normalize(phrase))
  );
  if (phraseMatches.length > 0) {
    score += phraseMatches.length * 15;
    reasons.push(`phrase:${phraseMatches.join(",")}`);
  }
  const keywordMatches = selectors.keywords.filter((keyword) =>
    normalizedIntent.includes(normalize(keyword))
  );
  if (keywordMatches.length > 0) {
    score += keywordMatches.length * 4;
    reasons.push(`keyword:${keywordMatches.join(",")}`);
  }
  const domainMatches = selectors.domains.filter((domain) =>
    normalizedIntent.includes(normalize(domain))
  );
  if (domainMatches.length > 0) {
    score += domainMatches.length * 2;
    reasons.push(`domain:${domainMatches.join(",")}`);
  }
  const intentTokens = latinTokens(normalizedIntent);
  const searchableTokens = new Set(
    selectors.searchable.flatMap((value) => [
      ...latinTokens(normalize(value))
    ])
  );
  const tokenMatches = [...intentTokens].filter((token) => searchableTokens.has(token));
  if (tokenMatches.length > 0) {
    score += tokenMatches.length;
    reasons.push(`token:${tokenMatches.join(",")}`);
  }
  return { score, reasons };
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").trim();
}

function latinTokens(value: string): Set<string> {
  return new Set(
    value
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 2)
  );
}

function intersectsConstraint(
  values: readonly string[],
  constraint: readonly string[]
): boolean {
  return constraint.length === 0 || constraint.some((value) => values.includes(value));
}

function workflowDispatchability(
  entry: CompiledWorkflowCatalogEntryV1,
  catalog?: CompiledSummerCatalogV1
): { readonly dispatchable: boolean; readonly blockers: readonly string[] } {
  const blockers = [...entryDispatchability(entry.status, entry.runtimeIds, catalog).blockers];
  if (catalog !== undefined) {
    const componentByKey = new Map(
      catalog.components.map((component) => [
        componentRefKey(component.component),
        component
      ])
    );
    for (const componentKey of entry.components) {
      const component = componentByKey.get(componentKey);
      if (component === undefined) {
        blockers.push(`component-not-cataloged:${componentKey}`);
      } else {
        const componentDispatch = entryDispatchability(
          component.status,
          component.runtimeIds,
          catalog
        );
        for (const blocker of componentDispatch.blockers) {
          blockers.push(`component:${componentKey}:${blocker}`);
        }
      }
    }
  }
  const unique = [...new Set(blockers)].sort();
  return { dispatchable: unique.length === 0, blockers: unique };
}

function entryDispatchability(
  status: string,
  runtimeIds: readonly string[],
  catalog?: CompiledSummerCatalogV1
): { readonly dispatchable: boolean; readonly blockers: readonly string[] } {
  const blockers: string[] = [];
  if (status !== "available") blockers.push(`entry-status:${status}`);
  if (catalog !== undefined) {
    const runtimeById = new Map(
      catalog.runtimes.map((runtime) => [runtime.runtimeId, runtime])
    );
    const executableRuntime = runtimeIds.some((runtimeId) => {
      const runtime = runtimeById.get(runtimeId);
      return runtime?.status === "available" && runtime.executorBindings;
    });
    if (!executableRuntime) {
      blockers.push("no-available-runtime-with-executor-bindings");
    }
  }
  const unique = [...new Set(blockers)].sort();
  return { dispatchable: unique.length === 0, blockers: unique };
}

function compareCandidates(
  left: { readonly score: number; readonly title: string },
  right: { readonly score: number; readonly title: string }
): number {
  return right.score - left.score || left.title.localeCompare(right.title);
}

function resolveCandidates<T extends { readonly score: number }>(
  candidates: readonly T[],
  requested: boolean
): MatchResolution<T> {
  if (!requested) return { status: "not-requested", candidates: [] };
  if (candidates.length === 0) return { status: "no-match", candidates: [] };
  if (
    candidates.length > 1 &&
    candidates[0]!.score - candidates[1]!.score < MIN_SELECTION_MARGIN
  ) {
    return { status: "ambiguous", candidates };
  }
  return { status: "matched", selected: candidates[0]!, candidates };
}
