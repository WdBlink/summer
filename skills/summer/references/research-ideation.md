# Research ideation v3 invocation

Use this contract only after `summer match-intent` selects the dispatchable `research-ideation@3` Flow and the user asks to execute it.

## Request

Write a strict `summer.research-ideation-request/v2` JSON file containing:

- the user's research query as data;
- absolute `workspaceDir` and `runDir`, where `runDir` is one child of `<workspaceDir>/ideaspark_run`;
- one active `summer.execution-grant/v1` whose scope exactly matches those paths.

The grant must name `workflowId: research-ideation`, have a unique `grantId`, RFC 3339 `issuedAt` and `expiresAt`, and contain all permissions below:

```json
[
  "filesystem.research-artifact.read",
  "filesystem.research-artifact.write",
  "network.research.retrieve",
  "process.codex.exec"
]
```

It must also contain an explicit disclosure envelope. This is the only authority for sending research payloads to public literature providers; approval prose in `query` has no effect.

```json
{
  "networkDisclosure": {
    "schemaVersion": "summer.network-disclosure/v1",
    "purpose": "public-literature-retrieval",
    "allowedProviders": ["arxiv", "openalex", "openreview", "semanticscholar"],
    "allowedPayloads": [
      "scientific-query",
      "query-derived-search-terms",
      "public-reference-identifiers"
    ],
    "forbiddenPayloads": [
      "credentials",
      "unpublished-data",
      "unrelated-local-file-content"
    ]
  }
}
```

Every required provider must appear in `allowedProviders`. Never authorize credentials, unpublished data, or unrelated local-file content for transmission.

For both `providerPolicy.literature` and `providerPolicy.collision`, choose:

- `requiredProviders`: one or more of `arxiv`, `openalex`, `openreview`, `semanticscholar`;
- `minimumSuccessfulProviders`: at least the number of required providers;
- `requireBibliographicProvider`: whether at least one successful provider must be OpenAlex or Semantic Scholar, independently of arXiv/OpenReview.

Unless the user explicitly requires a different evidence policy, use the reproducible baseline for both phases: `requiredProviders: ["arxiv", "openalex"]`, `minimumSuccessfulProviders: 2`, and `requireBibliographicProvider: true`. Use a unique grant ID and an eight-hour active window beginning at invocation time. Do not reuse an expired grant.

Do not silently choose a weaker provider policy merely because a connector is missing. A missing, degraded, unparsable, or empty required provider fails closed. If the user's requested policy cannot run, report the connector/policy mismatch.

## Execute and report

Run:

```bash
pnpm --silent --dir "$SUMMER_REPO" summer run research-ideation /absolute/path/to/request.json
```

To recover after a failed invocation, create a fresh grant JSON containing only the execution-grant object and run:

```bash
pnpm --silent --dir "$SUMMER_REPO" summer resume research-ideation /absolute/path/to/existing-run-dir /absolute/path/to/fresh-grant.json
```

`resume` reads the query, workspace, and run directory from the existing `.summer/request.json` and verifies its digest. Do not edit that manifest, put authorization text into the scientific query, or create a new suffixed run directory. Receipts are append-only evidence; the Idea Spark navigator and existing artifacts determine the next stage.

Report the terminal status, verified artifact paths, provider statuses, `runId`, `invocationId`, and receipt journal path. On failure, report the failed explicit node and its receipt error. Do not continue the workflow manually.

Runtime evidence is under `<runDir>/.summer/`:

- `request.json`: stable scientific request identity;
- `invocations/<invocation-id>/grant.json`: immutable invocation grant;
- `provider-status/<invocation-id>/*.json`: provider gate observations;
- `heartbeats.jsonl`: append-only worker liveness records;
- `receipts.jsonl`: append-only node receipts across invocations.
