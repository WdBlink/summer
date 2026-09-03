# Research ideation bounded Flow

`research-ideation@2` is Summer's first executable `bounded-flow`. It reproduces the control semantics of the installed ResearchStudio Idea Spark workflow without copying its dynamic routing into a second state machine.

## Contract

The CLI accepts a strict JSON input:

```json
{
  "schemaVersion": "summer.research-ideation-request/v1",
  "query": "the research problem and frozen evidence",
  "workspaceDir": "/absolute/path/to/research-workspace",
  "runDir": "/absolute/path/to/research-workspace/ideaspark_run/topic-slug"
}
```

`runDir` must be exactly one child under `<workspaceDir>/ideaspark_run`. A `.summer/request.json` manifest digest-binds the query and paths to that directory. Reusing the directory with different input fails closed; an existing Idea Spark run without a Summer manifest is not silently adopted.

```bash
pnpm --silent summer run research-ideation /absolute/path/to/request.json
```

## Execution model

The outer Mastra graph is deliberately small and typed:

```text
freeze-request -> run-idea-spark -> verify-terminal
```

The nested executor starts a separate ephemeral Codex process for each bounded stage:

1. literature grounding
2. bottleneck diagnosis
3. candidate generation
4. coherence and collision checking
5. quality gauntlet with bounded revision/re-audit
6. package rendering

Within each stage, Idea Spark's `scripts/run.py next` output is authoritative. This retains its current branches, sentinels, retry caps, context-isolation rules, and three terminal states while Summer owns the typed outer input/output, executor resolution, timeout, receipts, and final verification.

The Flow succeeds only after one terminal contract is verified:

- `done`: all three `phase4` idea cards exist and are non-empty;
- `do-not-generate`: `do_not_generate.md` exists and is non-empty;
- `phase-3-failed`: `phase_3_failed.md` exists and is non-empty.

Every outer node emits `summer.node-receipt/v1` with the compiled workflow and registry digests, run/node/attempt identity, input/output digest, status, and timing.

## Runtime dependencies and limits

- Idea Spark must be installed under ResearchStudio or supplied through `SUMMER_IDEA_SPARK_SKILL_DIR`.
- `codex` and `python3` must be on `PATH`, or supplied through `SUMMER_CODEX_BIN` and `SUMMER_PYTHON_BIN`.
- A live run performs literature retrieval and multiple agent calls, so it can take substantially longer than an ordinary CLI command.
- Mastra v0 does not yet provide durable checkpoint storage. Resume is artifact-driven through the immutable request manifest and Idea Spark navigator, not a durable Mastra checkpoint.
- The nested workflow may use network retrieval and writes only inside the research workspace; callers remain responsible for any host-level authorization required by those tools.
