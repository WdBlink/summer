# Research ideation bounded Flow

[Documentation](../README.md) · [Repository README](../../README.md)

`research-ideation@3` is Summer's first executable `bounded-flow`. It exposes ResearchStudio Idea Spark's phases and bounded retry policy as explicit Mastra nodes while keeping `scripts/run.py next` authoritative for domain state.

## Request and execution grant

The CLI accepts a strict v2 request. The grant is a typed local capability envelope, not a remote identity credential: it narrows what an explicitly requested local invocation may do and prevents the research query from granting itself new authority.

Replace the example paths, grant ID, active timestamps, and provider policy before running it.

```json
{
  "schemaVersion": "summer.research-ideation-request/v2",
  "query": "the research problem and frozen evidence",
  "workspaceDir": "/absolute/path/to/research-workspace",
  "runDir": "/absolute/path/to/research-workspace/ideaspark_run/topic-slug",
  "executionGrant": {
    "schemaVersion": "summer.execution-grant/v1",
    "grantId": "idea-topic-20260904",
    "workflowId": "research-ideation",
    "issuedAt": "2026-09-04T03:00:00.000Z",
    "expiresAt": "2026-09-04T11:00:00.000Z",
    "scope": {
      "workspaceDir": "/absolute/path/to/research-workspace",
      "runDir": "/absolute/path/to/research-workspace/ideaspark_run/topic-slug"
    },
    "permissions": [
      "filesystem.research-artifact.read",
      "filesystem.research-artifact.write",
      "network.research.retrieve",
      "process.codex.exec"
    ],
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
    },
    "providerPolicy": {
      "literature": {
        "requiredProviders": ["arxiv", "openalex"],
        "minimumSuccessfulProviders": 2,
        "requireBibliographicProvider": true
      },
      "collision": {
        "requiredProviders": ["arxiv", "openalex"],
        "minimumSuccessfulProviders": 2,
        "requireBibliographicProvider": true
      }
    }
  }
}
```

`runDir` must be a descendant under `<workspaceDir>/ideaspark_run`; the current validator also permits deeper nesting. Grant scope must exactly equal both request paths and all four declared permissions are required. Summer rechecks the grant before privileged stages, and a stage process is aborted if its grant expires while running.

Research Codex processes start in `runDir` and use `--approve-for-me`; navigator probes start in `workspaceDir`. These working directories and the typed grant are application conventions, not an OS sandbox or guaranteed filesystem boundary. Host process permissions remain authoritative.

`networkDisclosure` explicitly authorizes only the listed payload classes to the listed public providers. Every provider required by either provider policy must be allowed. Authorization prose inside the scientific query is inert, and credentials, unpublished data, and unrelated local-file content remain forbidden.

The stable `.summer/request.json` binds query and paths to the scientific run. A fresh invocation may use a new active grant without changing that scientific identity. Each invocation freezes its exact grant under `.summer/invocations/<invocation-id>/grant.json`. A directory with conflicting input, or an existing Idea Spark run without a Summer manifest, fails closed.

```bash
pnpm --silent summer run research-ideation /absolute/path/to/request.json
```

On success, the CLI's `summer.mastra-envelope/v1` result contains a `summer.research-ideation-result/v2` value in `result.current`.

After a failed invocation, resume the same scientific run with a fresh grant object:

```bash
pnpm --silent summer resume research-ideation /absolute/path/to/existing-run-dir /absolute/path/to/fresh-grant.json
```

The resume command reconstructs input only from the immutable `.summer/request.json`, verifies its request digest and exact run directory, and then creates a fresh invocation. It rejects query/path mutation instead of accepting an “authorized” copy as a new scientific request.

## Explicit Mastra graph

The 31-node v3 graph is a finite linear expansion of conditional domain paths:

```text
freeze request
  -> literature grounding -> Phase 0 provider gate
  -> bottleneck diagnosis
  -> candidate 1: generate -> coherence/collision -> provider gate -> gauntlet -> retry decision
  -> candidate 2 transition and cycle
  -> candidate 3 transition and cycle
  -> bottleneck retry transition -> re-diagnosis -> one final candidate cycle
  -> finalize failure -> package -> verify terminal
```

Only the node selected by typed state performs domain work; non-selected nodes produce explicit skipped node-run records and pass state forward. This makes stages, gates, and retry limits visible to Mastra without creating a second domain cursor.

The retry budget mirrors Idea Spark:

- at most three candidate cycles under one bottleneck framing;
- at most one bottleneck re-diagnosis;
- at most one candidate after re-diagnosis;
- then package a passing candidate or materialize `phase_3_failed.md`.

Each quality-gauntlet worker stops before executing the proposed retry. A separate retry-decision node parses the canonical navigator action, validates that the route is legal at that retry depth, and only then allows the corresponding transition node to archive/regenerate or re-diagnose.

## Provider fail-closed gates

Provider gates inspect the per-provider JSON artifacts generated by Idea Spark for literature grounding and collision retrieval. `succeeded` requires a present, parseable artifact with at least one record. A present empty result is `empty`; malformed JSON is `invalid`; a connector listed by `.connectors_degraded` is `unavailable`; absent evidence is `unknown`. Each status includes per-path observations and an explicit diagnostic code/message. When upstream Idea Spark did not persist a transport-level cause, Summer says so instead of guessing one. Each accepted evidence file is content-digested into the immutable provider-status set.

Required providers, the minimum number of successful providers, and the independent bibliographic-provider requirement come from the frozen execution grant. `empty`, `invalid`, `unavailable`, and `unknown` never count as success. Violating the policy stops the Flow at the gate. Immutable status sets are written under `.summer/provider-status/<invocation-id>/` and are included in terminal output.

## Heartbeats, timeouts, and receipts

Every workflow node has an explicit timeout appropriate to its role. The adapter aborts the component signal on timeout; Idea Spark subprocesses propagate that abort with `SIGTERM` and a bounded `SIGKILL` fallback. Navigator probes also have a 60-second ceiling.

Long-running workers append `started`, periodic `running`, and terminal heartbeat records to `.summer/heartbeats.jsonl`. The interval defaults to 30 seconds and may be set with `SUMMER_HEARTBEAT_INTERVAL_MS`; `SUMMER_TERMINATION_GRACE_MS` controls abort grace.

Every node attempt emits `summer.node-receipt/v1`. The CLI synchronously appends receipts to `.summer/receipts.jsonl` before returning success or failure. `summer resume` loads the complete journal, appends receipts for the new invocation, treats an exact repeated receipt as idempotent, and rejects a conflicting duplicate `receiptId`. The journal is durable execution evidence, not a Mastra checkpoint or campaign ledger.

## Terminal contract and dependencies

The Flow succeeds only after one terminal contract is verified:

- `done`: all three `phase4` idea cards exist and are non-empty;
- `do-not-generate`: `do_not_generate.md` exists and is non-empty;
- `phase-3-failed`: `phase_3_failed.md` exists and is non-empty.

Idea Spark must be installed under ResearchStudio or supplied through `SUMMER_IDEA_SPARK_SKILL_DIR`. `codex` and `python3` must be on `PATH`, or supplied through `SUMMER_CODEX_BIN` and `SUMMER_PYTHON_BIN`. Resume is artifact-driven through the immutable request/invocation manifests and Idea Spark navigator; v3 still has no durable Mastra checkpoint store.
