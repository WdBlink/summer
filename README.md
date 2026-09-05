<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
    <img alt="Summer" src=".github/logo-light.svg" width="400">
  </picture>

  <p><strong>Turn one-off agent work into workflows you can run again.</strong></p>
  <p>Plan with Codex. Execute with Mastra. Keep what works.</p>
</div>

<div align="center">

[![Release v0.1.0][release-badge]][release-url]
[![MIT license][license-badge]][license-url]
[![CI on GitHub Actions][ci-badge]][ci-url]
[![Mastra native][mastra-badge]][architecture-url]

<a href="#quick-start">Quick start</a> &middot;
<a href="#install">Install</a> &middot;
<a href="docs/workflow-products.md">User guide</a> &middot;
<a href="CHANGELOG.md">What's new</a>

</div>

---

## Good work should not start from scratch

You get an agent task right. Next week, you need the same process with different inputs — without rebuilding the prompt, rediscovering the tools, or guessing whether the result is complete.

Summer helps you keep the process. Start with a task-specific plan, run it within declared limits, check the deliverables, then turn a successful run into a reviewed, versioned workflow. Use the bundled **Codex Skill** to choose what to run, or use the **CLI** directly.

## What you get

- **A workflow you can keep.** Turn an accepted run into a parameterized draft, test it on new inputs and failure cases, then explicitly publish a reusable version.
- **A fresh plan when you need one.** Let the host-preferred Codex model plan the task at its highest supported effort, using the tools Summer actually has.
- **The right worker for each step.** Combine granted Codex and MiniMax models. Codex can work in the host environment; MiniMax workers are tool-free.
- **Deliverables with a definition of done.** Check required files, JSON fields and text instead of treating a successful process exit as task completion.
- **A way back into interrupted work.** Resume suspended runs from persistent checkpoints, inspect receipts, and roll back a published default without changing in-flight versions.
- **An entry point for your next workflow.** Discover existing capabilities first; design extensions around registered tools and contracts when something is missing.

## Quick start

After [installation](#install), try these distinct operations in Codex. These are sample requests, not transcripts of completed runs:

| Ask Summer | What you get |
| --- | --- |
| `$summer Find a workflow for literature-grounded research ideation.` | Matching candidates and missing prerequisites; nothing runs yet. |
| `$summer Use a dynamic workflow to write this project's documentation.` | A task-specific plan and execution after inputs, acceptance and grants are set. |
| `$summer Turn this accepted run into a reusable workflow.` | A reviewed draft, validation cases and an explicit publication step. |
| `$summer Design a workflow for a task the catalog does not cover.` | An extension proposal grounded in existing components and their limits. |

Prefer the terminal? Inspect capabilities without invoking a model:

```bash
pnpm --silent summer catalog
pnpm --silent summer match-intent "literature-grounded research ideation"
```

Want a complete first run with **no model credentials**? The [write-a-note example](docs/workflow-products.md#first-deterministic-product) writes an artifact, checks it, and persists its run state.

## Install

Requires **Node.js ≥22.13.0** and **pnpm 11.2.2**. Install from source; Summer is not published to npm. Access to this repository is required while it remains private.

```bash
git clone https://github.com/WdBlink/summer.git
cd summer
pnpm install --frozen-lockfile
pnpm --silent summer catalog
```

To register the bundled Skill in Codex, run from the repository root. The guard leaves any existing Summer installation untouched:

```bash
mkdir -p "$HOME/.codex/skills"
test ! -e "$HOME/.codex/skills/summer" && test ! -L "$HOME/.codex/skills/summer" &&
  ln -s "$PWD/skills/summer" "$HOME/.codex/skills/summer"
```

Start a new Codex task and invoke `$summer`. Existing installations should be reviewed before replacement. Model workflows additionally need their configured local CLIs and provider access; [research ideation](docs/workflow-products.md#native-research-ideation-v4) also needs Idea Spark and Python.

## Choose your starting point

| You want to… | Start here | Know before running |
| --- | --- | --- |
| Plan a new bounded task | [`summer dynamic`](docs/workflow-products.md#dynamic-planning) | Live planning generates a finite sequence of registered steps. |
| Develop a grounded research idea | [`research-ideation@4`](docs/workflow-products.md#native-research-ideation-v4) | Idea Spark stages, provider checks and bounded retries; external dependencies required. |
| Compare factor experiments | [`summer quant-loop`](docs/workflow-products.md#offline-factor-tuning) | Offline, predeclared candidates; bring your own published backtest workflow. |
| Reuse a validated process | [`summer run-product`](docs/workflow-products.md#promotion-and-publication) | Resolve a published local product and pin its exact version. |

With the [brief and request files](docs/workflow-products.md#dynamic-planning) prepared, a new dynamic run is one command:

```bash
pnpm --silent summer dynamic brief.json request.json
```

A satisfied result becomes a candidate, not an automatic release. Review its parameters and private content, verify it, then publish when ready. A fresh checkout has no prepublished reusable products.

## How it fits together

```text
Task -> Skill or CLI -> Existing product / new plan -> Mastra -> Deliverables
                              ^                                    |
                              +-- Publish <- Verify <- Review <----+
```

**Skill** handles selection and interaction. **Summer** owns grants, acceptance and versioned publication. **Mastra** owns execution, branches, bounded loops and checkpoints. Published and dynamically planned products share the native execution path.

The [architecture decision](docs/adr/0003-mastra-first-workflow-products.md) explains these boundaries. The [product guide](docs/workflow-products.md) covers contracts, approval, recovery and audit records.

## Know the boundaries

Summer **0.1.0 is a developer release**. Its 132-test release suite and model-free CLI smoke checks establish engineering behavior, not real-provider business quality.

- Grants are application checks, **not OS sandboxes**. Codex workers require explicit host-scope opt-in; direct-call budgets do not count every hidden descendant or token.
- Suspended checkpoints can resume with a fresh grant. Unknown shell writes and crashed experiment effects require reconciliation before another attempt.
- File acceptance checks do not establish scientific validity. The quant loop has no bundled backtest adapter, autonomous candidate proposer or live trading.
- Wiki learning and automatic workflow improvement are not included. Successful runs need review and verification before reuse.

Old runs remain old runs: unversioned `run research-ideation` and `run dynamic-agent-workflow` retain their legacy paths. New research should use `research-ideation@4`; new native planning uses `dynamic`. See [upgrade notes](CHANGELOG.md#upgrade-notes).

## Documentation

| Guide | Find your next step |
| --- | --- |
| [User manual](docs/README.md) | Setup, navigation and workflow prerequisites |
| [Workflow products](docs/workflow-products.md) | Runnable example, planning, publication, resume and recovery |
| [CLI reference](docs/cli.md) | Native and legacy commands, inputs and exit behavior |
| [Architecture](docs/adr/0003-mastra-first-workflow-products.md) | Why the Skill stays thin and Mastra owns execution |
| [Changelog](CHANGELOG.md) | What's in 0.1.0, migration notes and validation limits |
| [Roadmap](docs/roadmap.md) | Implemented work, deferred work and historical plans |

## Contributing

Keep changes focused. New executable capabilities need a registered tool, explicit contracts and a failure test. Open a pull request with the use case and validation evidence; run `pnpm validate` before submitting. Native development follows [ADR 0003](docs/adr/0003-mastra-first-workflow-products.md); the [v1 extension guide](docs/extensions.md) is for legacy work.

## License

[MIT](LICENSE) © 2026 WdBlink. Summer is an independent project; it does not install an OPC compatibility alias.

<sub>Crafted with <a href="https://github.com/motiful/readme-craft">Readme Craft</a>.</sub>

[release-badge]: https://img.shields.io/badge/release-v0.1.0-c65d21?style=flat-square
[release-url]: https://github.com/WdBlink/summer/releases/tag/v0.1.0
[license-badge]: https://img.shields.io/badge/license-MIT-64748b?style=flat-square
[license-url]: LICENSE
[ci-badge]: https://img.shields.io/badge/CI-GitHub_Actions-64748b?style=flat-square&logo=githubactions&logoColor=white
[ci-url]: https://github.com/WdBlink/summer/actions/workflows/ci.yml
[mastra-badge]: https://img.shields.io/badge/Mastra-native-0f766e?style=flat-square
[architecture-url]: docs/adr/0003-mastra-first-workflow-products.md
