# Dynamic agent workflow

[Documentation](../README.md) · [Repository README](../../README.md)

`dynamic-agent-workflow@1` is a general bounded Flow. On every invocation it
reads the current host's Codex model catalog, selects the highest-priority
visible model according to that catalog and its maximum supported reasoning effort, and asks that model to build
a fresh Mastra Dynamic Workflow. Summer validates the graph, registers it with
`Mastra.addDynamicWorkflow()`, then runs its Codex and MiniMax workers.

## Request

Replace the example paths, grant ID, active timestamps, providers, model allowlist, and worker budget before running it.

```json
{
  "schemaVersion": "summer.dynamic-task-request/v1",
  "task": "Inspect this repository and implement the requested change with tests.",
  "workspaceDir": "/absolute/path/to/workspace",
  "runDir": "/absolute/path/to/workspace/.summer-runs/task-001",
  "executionGrant": {
    "schemaVersion": "summer.dynamic-task-execution-grant/v1",
    "grantId": "task-001-grant",
    "workflowId": "dynamic-agent-workflow",
    "issuedAt": "2026-09-04T00:00:00.000Z",
    "expiresAt": "2026-09-04T02:00:00.000Z",
    "scope": {
      "workspaceDir": "/absolute/path/to/workspace",
      "runDir": "/absolute/path/to/workspace/.summer-runs/task-001"
    },
    "permissions": [
      "filesystem.workspace.read",
      "filesystem.workspace.write",
      "network.model.inference",
      "process.codex.exec",
      "process.minimax.exec"
    ],
    "workerPolicy": {
      "providers": ["codex", "minimax"],
      "minimaxModels": ["MiniMax-M3"],
      "maxWorkerCalls": 6
    }
  }
}
```

`runDir` must be inside `workspaceDir`; grant paths must match exactly and its
time window must be active. For Codex-only execution, omit `minimax` and
`process.minimax.exec` together and set `minimaxModels` to `[]`.

```bash
pnpm --silent summer run dynamic-agent-workflow /absolute/path/to/request.json
```

On success, the CLI's `summer.mastra-envelope/v1` result contains a `summer.dynamic-task-result/v1` value in `result.current`.

## Boundary

The outer Summer workflow contains one node. That component creates an invocation-specific Mastra graph; the generated graph is not another `summer.workflow/v1` document. It must be a bounded linear sequence that alternates mapping and tool entries, ends with a worker tool, and uses between 1 and 16 worker calls without exceeding the request's `maxWorkerCalls`.

The grant is a typed application-level validation envelope, not an OS sandbox. Request and grant paths must match, `runDir` must be inside `workspaceDir`, and permissions must cover the selected providers. Grant activity is checked when `runDynamicTask` begins; it is not rechecked before every worker.

Codex workers start in `workspaceDir` with `--approve-for-me` and may edit files. MiniMax workers use the configured Claude-compatible CLI with tools disabled and are suited to independent reasoning or review; a final Codex worker is needed when synthesis requires file changes. Host permissions remain authoritative.

The planner schema and generated workflow are saved under `runDir/.summer/dynamic/<run-id>/`. Worker output records are appended to `runDir/.summer/dynamic-worker-receipts.jsonl`; they are separate from the outer node's `summer.node-receipt/v1` in `runDir/.summer/receipts.jsonl`. There is no dynamic-workflow resume or durable Mastra checkpoint.

The default commands are `codex` and `claude`; use `SUMMER_CODEX_BIN` and `SUMMER_CLAUDE_BIN` to override them. Catalog status does not prove that local credentials are configured or that a generated plan will pass validation.
