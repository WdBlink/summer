# ADR 0002: Capability catalog and extension gate

- Status: Accepted
- Date: 2026-09-03

## Context

Summer needs a Skill that can map user intent to existing workflows and atomic Agent-system capabilities. It must also help secondary developers add capabilities without bypassing the protocol, registry, runtime constraints, or safety contracts.

Natural-language routing alone is insufficient: a model can name a plausible but nonexistent component, confuse a fixture with an executable binding, or design a workflow that the selected runtime cannot represent. Letting the Skill resolve those questions internally would create a second control plane.

## Decision

Summer adds three versioned data contracts:

- `summer.catalog/v1` describes discoverable workflows, exact-version components, and runtime support boundaries.
- `summer.match-request/v1` turns user intent and hard constraints into explainable ranked candidates.
- `summer.extension-proposal/v1` freezes reuse evidence and the complete design contract for a new component or workflow.

The Component Registry remains authoritative for schemas, descriptors, permissions, effects, and executor bindings. The Catalog is a discoverability index compiled against that Registry and the compiled workflows. A catalog claiming `componentCoverage: complete` fails if any registered component is missing or any catalog component is unregistered.

Matching uses hard filters for exact capability, profile, component kind, and runtime. Phrase, keyword, domain, and token evidence rank only eligible entries. A small or tied lead returns `ambiguous`. Every candidate reports its reasons, component composition, runtime choices, `dispatchable` status, and blockers. Matching never starts execution.

Extension proposals must cite the current `catalogDigest` and existing entries reviewed before adding a new surface. Component proposals include exact schemas and descriptor identity, discoverability metadata, repository ownership, runtime, permissions, effect, authorization/retry policy, and verification cases. Workflow proposals use registered components and must pass both the Summer compiler and a validator for every selected runtime.

The `$summer` Skill translates user intent, invokes these contracts, explains the result, and relays choices. It does not maintain state, invent transitions, promote catalog status, or call runtime internals directly.

## Consequences

- Existing capabilities become inspectable and matchable without granting execution authority.
- Fixture-only capabilities cannot be misreported as runnable because their catalog/runtime bindings expose blockers.
- New development begins with a machine-checkable proposal rather than unconstrained generated code.
- Catalog annotations and selector quality become maintained product assets and require conformance tests.
- A future production catalog must bind real executors and promote entries explicitly from `candidate` or `fixture` to `available`.

## Current limit

`research-ideation@2` is the first available, dispatchable bounded Flow. Its exact component schemas, executors, Mastra runtime conformance, receipt emission, and terminal artifact checks are registered together. The factor workflows and campaign runtime remain fixtures; durable campaign infrastructure is still not implemented.
