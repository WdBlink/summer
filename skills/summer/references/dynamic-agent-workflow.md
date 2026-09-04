# Dynamic agent workflow

Use this contract after matching selects `dynamic-agent-workflow@1` and the user
asks to execute it. Prefer a specialized available workflow when one matches;
this is the general live-planned fallback.

Create a strict `summer.dynamic-task-request/v1` JSON file with the user's task,
an absolute workspace path, a run directory inside that workspace, and an
active `summer.dynamic-task-execution-grant/v1`. The grant must bind those paths
exactly and name `dynamic-agent-workflow`.

Required base permissions are:

- `filesystem.workspace.read`
- `filesystem.workspace.write`
- `network.model.inference`
- `process.codex.exec`

If `workerPolicy.providers` includes `minimax`, also grant
`process.minimax.exec` and list the permitted local MiniMax model names.
`maxWorkerCalls` is a hard bound from 1 through 16.

```bash
pnpm --silent --dir "$SUMMER_REPO" summer run dynamic-agent-workflow /absolute/path/to/request.json
```

Summer, not the Skill, discovers and selects the strongest visible Codex host
model and compiles the invocation-specific graph. Codex workers can operate in
the granted workspace. MiniMax workers currently run without tools, so use them
for analysis or review and use Codex for file changes. Do not manually execute
planner output, weaken the grant, or simulate unsupported resume/checkpoint
behavior.
