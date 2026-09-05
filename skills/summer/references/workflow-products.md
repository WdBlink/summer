# Native workflow product operations

Get exact schemas with `summer contracts`. Products use `summer.product/v2`;
requests contain `input`, a `summer.product-grant/v2` grant, and optional
`pauseAfter`. Inspect the repository's `docs/workflow-products.md` for worked examples.

## Execute

- `run-product <id[@version]> <request>` resolves only published products.
- `run-draft <definition> <request>` runs a reviewed unpublished definition.
- `dynamic <brief> <request>` discovers the host-preferred Codex planner at its
  highest supported effort; the exact selected model must be granted. A brief
  is the product schema without `graph`/`sourceRun`; acceptance is fixed before planning.
  Live generation uses finite mapping/tool sequences; explicitly authored products
  may also use native branches and bounded loops.
- `validate-product <definition>` validates without execution.

Use only the tools returned by `contracts`. Inputs are named nonempty strings;
mapping templates use `${initData.parameter}`, acceptance templates use
`${input.parameter}`. A tool's output text is not its acceptance verdict.

## Publish

`promote <accepted-run> <candidate>` creates an unregistered draft. The candidate
must parameterize the successful run and preserve appropriate acceptance rules.
Remove private literals; the runtime only detects source workspace/run paths,
not every possible secret. Source provenance is recorded as digests, not raw data.

`verify <draft> <suite>` requires normal/different-input, invalid-input and expected
runtime-failure cases. Each executed case needs a fresh grant and separate run
directory. Invalid authorization does not count as a runtime failure test.

`publish <draft>` requires current verification; it cannot overwrite a version.
`select <id@version>` changes the default, including rollback. Publication and
selection are explicit user-directed mutations, not side effects of matching.

## Recover

- `status <run>` exposes immutable identity, last result/failure and audit path.
- `resume-product <run> <fresh-grant>` resumes a suspended native checkpoint.
- `recover-product <run> <fresh-grant>` supports only linear read/atomic-write
  graphs after repair. Shell-agent effects and ambiguous graphs are rejected.
- Human approval uses `summer.approval@1`; include its exact step ID in the fresh
  grant's `approvedSteps` only when the user authorizes that action.

Do not edit journals, checkpoints or manifests. Do not expand scope to make a
recovery pass. Local grants cannot enforce a sandbox around unrestricted host
workers, and direct-call counts are not complete descendant/token/cost accounting.

## Offline quantitative loop

`quant-loop <plan> <grant>` runs predeclared candidates through exact published
experiment products. It requires fixed data, environment, evaluator and baseline
digests, accepted validation-only evaluation artifacts, and a one-parameter change
per experiment. Unknown/incomparable results require repair rather than a research
conclusion. It never trades, uses holdout for optimization, or silently starts a
successor. A Vibe-Trading backtest adapter is not bundled.

Plan `pauseAfter` can suspend after N completed experiments; use
`quant-resume <run-dir> <fresh-grant.json>` to resume the native checkpoint without
resetting evidence, definitions or budget. Crashed/unknown effects are not replayed.
