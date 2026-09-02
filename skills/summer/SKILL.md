---
name: summer
description: Validate, compile, and explain Summer typed workflows and research-campaign contracts through the Summer CLI. Use for Summer workflow files or campaign questions; report unsupported runtime operations and never use it as an OPC alias.
---

# Summer

Use Summer as a thin interface to the product runtime. The Skill may translate user intent, locate the project, present validation failures, and relay explicit human decisions. It must not keep a second cursor, infer hidden transitions, rewrite receipts, or decide a campaign outcome itself.

## Current walking-skeleton scope

The repository currently supports protocol validation, deterministic compilation, inspection of compile output, and model-free conformance fixtures. Before invoking a command, locate the Summer checkout and verify its CLI is present. The copy under `skills/summer` is distributable Skill source; it is not automatically installed merely because the repository was cloned.

```bash
SUMMER_REPO=/absolute/path/to/summer
pnpm --silent --dir "$SUMMER_REPO" summer validate /absolute/path/to/workflow.json
pnpm --silent --dir "$SUMMER_REPO" summer compile /absolute/path/to/workflow.json
pnpm --silent --dir "$SUMMER_REPO" summer fixtures
```

If a user asks to start, resume, schedule, or persist a production campaign before that command exists, report the unsupported boundary. Do not simulate it with a Skill-owned state file, repeated prompt, cron job, or direct Mastra internals.

## Operating rules

- Accept only `summer.workflow/v1` data. Never execute JavaScript embedded in a workflow request.
- Treat `bounded-flow` and `iterative-campaign` as authoring profiles for the same compiled IR.
- Resolve exact component versions and schema bindings through the registry; fail closed on unknown references and invalid fan-out, effect, retry, policy-kind, or decision contracts.
- A Frame Check produces `FrameAssessment`. The reducer accepts a `DecisionReceipt` only when its digest matches the frozen Decision Policy descriptor and its decision selects a declared typed edge; producer authentication is a later runtime concern.
- Child runs may own local execution state and transient retry. They never own the campaign research cursor, posterior, cross-round backlog, or campaign terminal state.
- Preserve immutable identities and digests. Exact replay may be idempotent; conflicting replay must fail.
- Request user authorization at the point an actual workflow needs a privileged, irreversible, or externally visible action.
- When installed in a compatible host, invoke the Skill as `$summer`. Never register, forward, or describe `/opc` as a compatibility alias.

Read [references/protocol.md](references/protocol.md) when authoring a workflow, diagnosing a compiler failure, or explaining campaign decisions.
