---
name: summer
description: Match user requests to registered Summer workflows, components, and runtimes; validate typed workflows; and frame protocol-compliant extensions. Use for Summer capability routing or secondary development, never as an OPC alias.
---

# Summer

Use Summer as a thin discovery and interaction layer. Translate intent into typed requests, but let the Catalog, Registry, Compiler, runtime adapter, and campaign ledger remain authoritative. Never keep a second cursor, infer hidden transitions, rewrite receipts, or decide a campaign outcome in the Skill.

## Locate Summer

Locate the checkout and verify the CLI before routing. Cloning the repository does not install this Skill.

```bash
SUMMER_REPO=/absolute/path/to/summer
pnpm --silent --dir "$SUMMER_REPO" summer catalog
pnpm --silent --dir "$SUMMER_REPO" summer match-intent "the user's request"
pnpm --silent --dir "$SUMMER_REPO" summer match /absolute/path/to/match-request.json
pnpm --silent --dir "$SUMMER_REPO" summer extension-check /absolute/path/to/proposal.json
pnpm --silent --dir "$SUMMER_REPO" summer validate /absolute/path/to/workflow.json
pnpm --silent --dir "$SUMMER_REPO" summer compile /absolute/path/to/workflow.json
pnpm --silent --dir "$SUMMER_REPO" summer fixtures
```

## Match existing capabilities

Run `match-intent` for ordinary natural-language requests. Use a typed `summer.match-request/v1` file when profile, component kind, exact capability, runtime, or preferred ID constraints matter. Read [references/matching.md](references/matching.md) for the request contract and decision rules.

- Prefer a matched workflow for an end-to-end goal and its declared component list for composition.
- Use component matches for atomic work or extension design.
- Treat `ambiguous` as a user choice, not permission to pick the first candidate.
- Treat `no-match` or `capabilityGaps` as an extension candidate.
- Check `dispatchable` before proposing execution. If false, report the exact blockers; a fixture or descriptor is not a runnable capability.

## Frame an extension

Search the current catalog before designing anything new. If reuse or composition cannot satisfy the request, read [references/extensions.md](references/extensions.md), create a `summer.extension-proposal/v1` artifact, and run `extension-check`.

A valid proposal is admissible design input, not implemented code and not a registered capability. Only describe it as available after its schemas, descriptor, executor, registry entry, runtime conformance, tests, and catalog status are committed together.

## Runtime boundary

If a user asks to start, resume, schedule, or persist a production campaign before those commands and executor bindings exist, report the unsupported boundary. Do not simulate it with Skill-owned state, repeated prompts, cron, or direct Mastra internals.

## Operating rules

- Accept only declared Summer protocol data. Never execute JavaScript embedded in a workflow or extension proposal.
- Resolve exact component/schema versions and use the current `catalogDigest`; stale reuse assessments must be repeated.
- Treat `bounded-flow` and `iterative-campaign` as authoring profiles for the same compiled IR.
- Fail closed on unknown capabilities, missing permissions, incompatible runtimes, invalid effects/retries, or unsupported graph shapes.
- A Frame Check produces `FrameAssessment`. The reducer accepts a `DecisionReceipt` only when its digest matches the frozen Decision Policy descriptor and its decision selects a declared typed edge; producer authentication is a later runtime concern.
- Child runs may own local execution state and transient retry. They never own the campaign research cursor, posterior, cross-round backlog, or campaign terminal state.
- Preserve immutable identities and digests. Exact replay may be idempotent; conflicting replay must fail.
- Request user authorization at the point an actual workflow needs a privileged, irreversible, or externally visible action.
- When installed in a compatible host, invoke the Skill as `$summer`. Never register, forward, or describe `/opc` as a compatibility alias.

Read [references/protocol.md](references/protocol.md) when authoring a workflow, diagnosing a compiler failure, or explaining campaign decisions.
