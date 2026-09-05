# Workflow products (Summer 0.1)

Summer owns capability admission, grants, acceptance and publication. Mastra owns
execution state and control flow. Legacy v1 contracts remain readable and runnable;
they are not silently translated or upgraded. See [ADR 0003](adr/0003-mastra-first-workflow-products.md).

## First deterministic product

For an immediate run with generated paths and fresh grants, use `pnpm --silent demo`
from the repository root after installation. It runs the [complete lifecycle below](#runnable-lifecycle-demo).
To author a product yourself, follow the explicit JSON example here.

Save this as `note.product.json`. This is an executable example, not a prepublished capability.

```json
{
  "schemaVersion": "summer.product/v2",
  "id": "write-note",
  "version": 1,
  "title": "Write a note",
  "description": "Write and verify a parameterized Markdown note.",
  "parameters": ["message"],
  "keywords": ["write a note", "写笔记"],
  "maxCalls": 4,
  "graph": [
    {"type":"mapping","id":"prepare","mapConfig":{"path":{"value":"note.md"},"text":{"template":"${initData.message}"}}},
    {"type":"tool","id":"write","toolId":"summer.write-text@1"},
    {"type":"tool","id":"read","toolId":"summer.read-text@1"}
  ],
  "acceptance": [{"path":"note.md","kind":"contains","expected":"${input.message}"}]
}
```

Save a request with actual absolute paths and a fresh active grant. The timestamps
below are placeholders and must be replaced; permissions never come from `message`.

```json
{
  "input": {"message":"A verified note"},
  "grant": {
    "schemaVersion":"summer.product-grant/v2",
    "grantId":"note-first-run",
    "workspaceDir":"/absolute/workspace",
    "runDir":"/absolute/workspace/runs/note-1",
    "issuedAt":"2026-09-05T00:00:00.000Z",
    "expiresAt":"2026-09-05T08:00:00.000Z",
    "maxCalls":4,
    "timeoutMs":60000,
    "allowWrite":true,
    "providers":[],
    "models":[],
    "allowUnrestrictedHostWorker":false,
    "approvedSteps":[]
  }
}
```

```bash
pnpm --silent summer contracts
pnpm --silent summer validate-product note.product.json
pnpm --silent summer run-draft note.product.json note.request.json
pnpm --silent summer status /absolute/workspace/runs/note-1
```

`contracts` emits schemas directly from the code. Path/symlink, active-window,
registered-tool and control-flow checks supplement JSON Schema validation.
Parameters are nonempty strings in this first product revision; use registered
domain components when richer semantics are required.

## Runnable lifecycle demo

```bash
pnpm --silent demo
```

The [example script](../examples/workflow-lifecycle.mjs) executes real CLI handlers
in separate Node processes, with the library root set to a fresh OS temporary
directory. It reuses the registered write/read tools and Mastra persistence;
there is no mock runner, model call or change to the production runtime.
Its graph and parameterization are predefined, so it does not demonstrate live
planning, automatic generalization or research quality.

The five stages run an accepted draft, promote the explicit candidate, verify
different input plus missing-input and exhausted-budget cases, publish `write-note@1`
to the temporary library, and run that exact version with a third input. Assertions
check statuses, file contents, verification categories and persisted tool receipts.
The failure case deliberately exhausts one call before the read step; its expected
runtime diagnostic is retained in the saved CLI response rather than printed as
an unexpected demo error.

Inspect these paths under the printed `Evidence directory`:

| Path | Evidence |
| --- | --- |
| `note.product.json` | Explicit graph, parameters and artifact acceptance |
| `source/note.md` / `reuse/note.md` | Different text produced by the same process |
| `products/drafts/write-note@1.json.verification.json` | All three verification cases |
| `products/published/write-note@1.json` | Exact local release and compact provenance |
| `reuse/run/.summer-v2/` | Frozen manifest, Mastra database, acceptance result and append-only events |
| `cli-*.json` | Arguments, exit status, stdout and stderr for each CLI invocation |

The temporary outputs remain for inspection; your operating system may eventually
remove them. Each rerun uses a new directory. Nothing is published into the real
repository's product catalog or sent to a provider. For a lasting product, use the
normal [promotion and publication commands](#promotion-and-publication).

## Registered primitives and acceptance

| ID | Input | Effect |
| --- | --- | --- |
| `summer.read-text@1` | `path` | Workspace file read |
| `summer.write-text@1` | `path`, `text` | Atomic replacement of exact text |
| `summer.codex@1` | `prompt`, `model`, optional `reasoningEffort` | Host agent; effects are not assumed idempotent |
| `summer.minimax@1` | `prompt`, `model` | Tool-free provider call through configured Claude CLI |
| `summer.approval@1` | Optional `text`, `path` | Native suspension until the fresh grant lists the step in `approvedSteps` |

Tools return nonempty `text` and an optional relative `path`. Native mapping, tool,
parallel, conditional and tool-loop entries are supported. Loop execution counts
against a persisted direct-call budget. Arbitrary generated JavaScript, unregistered
tools and per-step automatic retry settings are rejected.

Acceptance is required, separate from worker text. Checks support nonempty files,
JSON objects with required keys, and required text. `${input.parameter}` expands
only from frozen input. These checks establish the declared contract, not universal
document quality or scientific validity. Subjective or domain-specific evaluation
must be implemented explicitly, not implied by a success status.

## Dynamic planning

Create a brief with the same fields as a product except `graph` and `sourceRun`.
The user/host defines parameters, acceptance and budget before planning. Run:

```bash
pnpm --silent summer dynamic brief.json request.json
```

The planner discovers visible Codex models and selects the host-preferred entry at
its highest supported effort. Its exact model must be granted. This is a recorded
selection policy, not an objective intelligence ranking. The grant must permit
Codex inference; workers may use only granted providers/models.

The planner writes a native Mastra graph referencing registered tools. It cannot
change the externally supplied acceptance or grant. Planning consumes one call;
live generation currently uses a finite mapping/tool sequence; native branches and
loops are available in explicitly authored products and research v4.
Failed calls also consume budget. Definitions freeze before execution. The graph
is saved in `<runDir>/.summer-v2/planned-product.json`; rerunning `dynamic` in that
directory refuses to replan. Use the saved definition to inspect or recover.

Codex workers require `allowUnrestrictedHostWorker: true`: a shell-capable host
agent can create descendants outside Summer's direct-call counter. This opt-in is
not a filesystem sandbox or a guarantee of strict descendant accounting. MiniMax
workers have no tools. Provider availability is checked by actual invocation;
there is no silent provider fallback or claim that a requested model was attested
by the provider. The planner itself uses the host's read-only sandbox.

## Promotion and publication

```bash
pnpm --silent summer promote /absolute/source-run candidate.product.json
pnpm --silent summer verify /absolute/draft.json verification-suite.json
pnpm --silent summer publish /absolute/draft.json
pnpm --silent summer run-product write-note@1 new-request.json
```

`promote` requires an accepted source run. Supply a reviewed parameterized candidate;
the CLI does not pretend a single successful graph can be automatically generalized.
It writes an unregistered draft and digest-only provenance, never copies the grant,
and rejects the source's private workspace/run paths in the candidate. Review other
private literals or task-specific assumptions before publication.

Verification suite:

```json
{"cases":[
  {"kind":"normal","request":{"input":{"message":"A different note"},"grant":{}}},
  {"kind":"invalid-input","request":{"input":{}}},
  {"kind":"failure","request":{"input":{"message":"Budget case"},"grant":{}},"expectedError":"EXECUTION_FAILED"}
]}
```

The empty grants above must be replaced with complete fresh grants and separate
run directories. Use `maxCalls:1` for the failure case of the two-tool note example.
Normal verification must use different input from the source run. Failure cases
must reach runtime/acceptance, not pass because of malformed authorization.
Verification invokes tools and may incur model usage; it is not a dry run.

Publication requires a current verification digest and all three case categories.
Published versions cannot be overwritten. Local files are trusted developer inputs;
digests detect accidental drift, not a malicious user who can rewrite the repository.
The public release contains compact verification provenance, not private run paths.

`summer products` lists releases; `catalog` and `match-intent` also return a
`products` section. Ambiguous matches remain a user choice. `summer select id@version`
changes the default version (including rollback); existing runs remain pinned.

## Pause, resume, recovery and receipts

Optional request `pauseAfter` pauses before the next tool after N completed calls.
An approval primitive pauses until explicitly approved. Use a fresh grant:

```bash
pnpm --silent summer resume-product /absolute/run fresh-grant.json
pnpm --silent summer recover-product /absolute/run fresh-grant.json
```

`resume-product` requires a suspended native checkpoint. `recover-product` only
permits linear read/atomic-text-write graphs; it uses native restart or failed-step
time travel after repair, and refuses shell-agent effects and ambiguous topology.
A stale lock is moved aside only after its recorded PID is confirmed absent.
Unknown write outcomes require inspection/reconciliation, not an automatic retry.

The runtime rechecks grants at calls, bounds process time by timeout and expiry,
and records started/completed/failed calls plus worker heartbeats across invocations.
POSIX subprocess groups receive TERM then KILL on cancellation. Liveness is not
evidence of useful progress; token/cost limits are not claimed without reliable usage.

`manifest.json` freezes definition, input, scope and run ID. `mastra.db` is the
authoritative native checkpoint. `events.jsonl` is audit evidence, not a second
cursor. `result.json` and `last-failure.json` make acceptance and later failures
visible independently. Recovery never edits old receipts or silently replans.

## Native research ideation v4

```bash
pnpm --silent summer run research-ideation@4 research-request.json
pnpm --silent summer resume research-ideation@4 /absolute/research-run fresh-grant.json
```

Uses the existing [research request and provider grant](workflows/research-ideation.md).
Stages, candidate retry, bottleneck re-diagnosis and terminal packaging execute via
native branches and a finite candidate loop. Provider checks and domain artifact
verification remain mandatory. State persists to `.summer/native-v4/mastra.db`.
Only suspended checkpoints resume automatically; failed host-worker effects need
reconciliation. Existing v3 runs are not migrated.

The installed Idea Spark text navigator is still a compatibility dependency. Its
adapter converts recognized outcomes to a typed decision; native routing rejects
missing/unknown decisions. This is not a complete reimplementation of Idea Spark.

## Offline factor tuning

`summer quant-loop plan.json grant.json` composes exact published experiment
products using a native bounded loop. It freezes data/environment/evaluator/baseline
digests, requires a single declared parameter change per candidate, accepts only
validation-split evaluations, tracks an incumbent and stops on a predeclared lack
of material improvement or budget. Errors and incomparable results stop with
`repair-required` and do not update the incumbent.

This initial loop uses a predeclared candidate list, not an autonomous optimizer.
Backtest products must provide accepted evaluation JSON matching `QuantPlanSchema`
and the evaluation contract in `quant-loop.ts`. No live order primitive exists.
No Vibe-Trading campaign is launched or modified. The reference project motivates
separating runtime repair from research evidence; its controller is not imported.
The test evaluator is explicitly synthetic and proves control behavior only.

Optional plan `pauseAfter` suspends after that many completed experiments per
invocation. `summer quant-resume <run-dir> <fresh-grant.json>` resumes the native
checkpoint with the same plan, exact product versions and cumulative budget.
Long-running distributed campaigns, autonomous successor planning and automatic
replay of crashed quant effects are not included. Inspect partial child artifacts
and start an explicitly reviewed successor when no suspended checkpoint exists.
