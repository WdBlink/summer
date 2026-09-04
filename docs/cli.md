# CLI reference

[Documentation](README.md) · [Repository README](../README.md)

Run the repository CLI from the project root as:

```bash
pnpm --silent summer <command> [arguments]
```

The `summer` package script builds `packages/cli` before invoking it. Each invocation emits one compact JSON value. Successful commands and help write to stdout; failures write to stderr.

| Command | Arguments | Effect |
| --- | --- | --- |
| `validate` | `<workflow.json>` | Parse strict `summer.workflow/v1` JSON |
| `compile` | `<workflow.json>` | Resolve the repository registry and compile the workflow |
| `fixtures` | none | Compile the model-free conformance workflow inventory |
| `catalog` | none | Compile and print the repository catalog |
| `run` | `<workflow-id> <input.json>` | Run an available bounded workflow through `mastra-v0` |
| `resume` | `<workflow-id> <run-dir> <grant.json>` | Resume the supported research workflow from verified artifacts |
| `match-intent` | `<intent>` | Match free text against all catalog targets |
| `match` | `<request.json>` | Match a typed `summer.match-request/v1` |
| `extension-check` | `<proposal.json>` | Validate a `summer.extension-proposal/v1` |

There are no command flags beyond `help`, `--help`, and `-h` for usage output.

## Validate and compile

```bash
pnpm --silent summer validate workflows/research-ideation.v3.json
pnpm --silent summer compile workflows/research-ideation.v3.json
pnpm --silent summer compile workflows/dynamic-agent-workflow.v1.json
```

`validate` checks only the strict source contract and reports identity, profile, node count, and edge count. `compile` additionally resolves exact registry entries and bindings, applies compiler invariants, and prints the full `summer.compiled-workflow/v1` value.

## Inspect fixtures and catalog

```bash
pnpm --silent summer fixtures
pnpm --silent summer catalog
```

`fixtures` uses the fixture conformance registry, whose executors are intentionally unbound. `catalog` compiles the active catalog, repository workflows, registry, and runtime declarations before returning them.

## Match without running

For a quick natural-language match:

```bash
pnpm --silent summer match-intent "generate a literature-grounded research idea"
```

For hard filters, create a request such as:

```json
{
  "schemaVersion": "summer.match-request/v1",
  "intent": "use a dynamic workflow for a bounded repository task",
  "target": "workflow",
  "profile": "bounded-flow",
  "requiredCapabilities": ["workflow.dynamic.execute"],
  "runtimeIds": ["mastra-v0"]
}
```

Then run:

```bash
pnpm --silent summer match /absolute/path/to/match-request.json
```

Both matching commands are read-only. A result may be `matched`, `ambiguous`, or `no-match`; candidates include reasons, blockers, and dispatchability.

## Run and resume

Only the two cataloged available bounded flows are executable:

```bash
pnpm --silent summer run research-ideation /absolute/path/to/request.json
pnpm --silent summer run dynamic-agent-workflow /absolute/path/to/request.json
```

The input file must match the selected entry node's schema and include an absolute `runDir`. Running invokes local model tooling and writes workflow artifacts and receipts. See the [research](workflows/research-ideation.md) and [dynamic](workflows/dynamic-agent-workflow.md) guides before use.

Only `research-ideation@3` has a typed application-layer resume protocol:

```bash
pnpm --silent summer resume research-ideation /absolute/path/to/existing-run-dir /absolute/path/to/fresh-grant.json
```

Resume loads and digest-verifies `<run-dir>/.summer/request.json`, requires its embedded run directory to match, rejects a previously used grant ID, and starts a new invocation. Other workflow IDs fail with `WORKFLOW_RESUME_UNSUPPORTED`.

## Validate an extension proposal

```bash
pnpm --silent summer extension-check /absolute/path/to/proposal.json
```

This validates the proposal against the current catalog digest, registry, compiler, and selected runtime validators. It does not install, register, catalog, or execute the proposal. See [Extension development](extensions.md).

## Exit behavior

| Exit code | Meaning |
| --- | --- |
| `0` | Help or successful command |
| `1` | Validation, compilation, catalog, matching, execution, resume, or extension failure |
| `2` | Unknown command or wrong argument count |

An invalid extension proposal is a normal validation failure: it returns `ok: false` on stderr with exit code `1`. Other failures use a JSON error object containing `code`, `message`, and optional `details`.

