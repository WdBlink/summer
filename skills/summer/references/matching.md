# Capability matching

Use matching to produce a reviewable routing decision. It does not execute a workflow.

## Ordinary request

```bash
pnpm --silent --dir "$SUMMER_REPO" summer match-intent "生成三个经过审计的研究构思"
```

The result independently resolves workflows and components. For an end-to-end request, prefer the workflow resolution and inspect its `components`. A high-level workflow request may legitimately leave the atomic component resolution ambiguous.

## Constrained request

Create a strict request when constraints matter:

```json
{
  "schemaVersion": "summer.match-request/v1",
  "intent": "持续进行量化因子发现和策略调优",
  "target": "workflow",
  "profile": "iterative-campaign",
  "requiredCapabilities": ["workflow.quant.factor-discovery"],
  "runtimeIds": ["summer-core-v0"],
  "maxCandidates": 5
}
```

Optional constraints are `componentKinds`, `preferredWorkflowIds`, and exact `preferredComponents`. Required capabilities, profile, component kind, and runtime are hard filters. Phrase, keyword, domain, and token evidence rank the eligible candidates deterministically.

## Interpret the result

- `matched`: one candidate leads by the deterministic selection margin. This is a recommendation, not execution authority.
- `ambiguous`: ask the user to choose or add constraints. Do not silently take the first item.
- `no-match`: do not invent a component. Inspect `capabilityGaps` and enter extension design when needed.
- `dispatchable: false`: report `dispatchBlockers`. Common blockers include fixture status, missing executor bindings, or unavailable components/runtime.

Always retain `catalogDigest` with a routing or reuse decision. If the digest changes, rematch before execution or extension work.
