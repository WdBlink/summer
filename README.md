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
<a href="#use-it-from-codex">Use with Codex</a> &middot;
<a href="docs/workflow-products.md">User guide</a> &middot;
<a href="CHANGELOG.md">What's new</a>

</div>

---

## Good work should not start from scratch

If you repeat research, documentation or other multi-step agent tasks, getting a good result once is only half the job. Next week, you need the same process with different inputs — without rebuilding the prompt or guessing whether the result is complete.

Summer helps you keep the process. Use the bundled **Codex Skill** or **CLI** to plan a new task, check its deliverables, and turn an accepted run into a reviewed, versioned workflow. Next time, reuse that version with new inputs.

## What you get

- **Keep what worked.** Review an accepted run, test it with new inputs and failures, then publish a reusable version.
- **Plan what is new.** Ask the host-preferred Codex model to plan at its highest supported effort, using available tools.
- **Choose your workers.** Combine authorized Codex and MiniMax models; Codex works on the host, while MiniMax workers are tool-free.
- **Check the actual deliverables.** Require files, JSON fields and text, not just a successful process exit.
- **Resume and roll back.** Resume suspended work, inspect execution records and change the default version without changing in-flight runs.
- **Extend from what exists.** Discover workflows first; design missing capabilities around registered tools and contracts.

## Quick start

Run the complete **write → check → publish → reuse** example. Requires **Node.js ≥22.13.0**, **pnpm 11.2.2** and repository access while Summer remains private. No model credentials or Codex installation needed:

```bash
git clone https://github.com/WdBlink/summer.git && cd summer
pnpm install --frozen-lockfile
pnpm --silent demo
```

Verified output from the demo (the generated directory line is omitted):

```text
Summer demo | real Mastra execution, no model calls
[1/5] run-draft  accepted: note.md = "A verified note"
[2/5] promote    draft: write-note@1 (explicit candidate)
[3/5] verify     passed: new input, invalid input, exhausted budget
[4/5] publish    write-note@1 (temporary local library)
[5/5] reuse      accepted: note.md = "Next week's note"
Checks passed. Evidence saved in the directory above.
```

Open `source/note.md` and `reuse/note.md` under the printed directory to compare the results. The demo creates fresh, scoped grants and a **temporary local product library**; it does not modify your project files or publish to GitHub. Each rerun gets a new directory.

This is a predefined, parameterized graph running through the real CLI handlers and Mastra, **not a live-planning or model-quality demonstration**. Review the [executable example](examples/workflow-lifecycle.mjs) and [saved evidence guide](docs/workflow-products.md#runnable-lifecycle-demo). CI runs the same command.

## Install

The Quick start commands install Summer from source; it is not published to npm. For model-backed tasks, also configure your local Codex CLI and provider access. MiniMax workers need a configured Claude CLI; [research ideation](docs/workflow-products.md#native-research-ideation-v4) also needs Idea Spark and Python.

To register the bundled Skill in Codex, run from the repository root. The guard leaves any existing Summer installation untouched:

```bash
mkdir -p "$HOME/.codex/skills"
test ! -e "$HOME/.codex/skills/summer" && test ! -L "$HOME/.codex/skills/summer" &&
  ln -s "$PWD/skills/summer" "$HOME/.codex/skills/summer"
```

Start a new Codex task and invoke `$summer`. Existing installations should be reviewed before replacement.

## Use it from Codex

These are sample requests, not transcripts. Summer confirms inputs, acceptance checks and execution permissions before dispatch:

| Ask Summer | What happens |
| --- | --- |
| `$summer Find a workflow for literature-grounded research ideation.` | Discover matching workflows and missing prerequisites; nothing runs yet. |
| `$summer Use a dynamic workflow to write this project's documentation.` | Plan a new task, execute its steps and check the deliverables. |
| `$summer Turn this accepted run into a reusable workflow.` | Review a parameterized candidate, verify it, then explicitly publish. |
| `$summer Design a workflow for a task the catalog does not cover.` | Propose an extension using existing components and contracts. |

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
