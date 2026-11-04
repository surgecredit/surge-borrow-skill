# surge-borrow-skill

A Claude Code skill, packaged as a plugin, for integrating Bitcoin-backed USDC borrowing on [Surge.Credit](https://surge.credit) into a wallet or building it as a standalone app, and testing it on Surge's private signet with real coins.

Repository: [github.com/surgecredit/surge-borrow-skill](https://github.com/surgecredit/surge-borrow-skill)

> **Status: experimental.** This skill is for prototyping integrations. It is not mainnet ready yet. Its facts were verified against `@surgecredit/borrow-sdk@0.1.13`, and its harness has only ever spent coins on Surge's signet; on mainnet it has done reads and nothing more. Keep mainnet behind a flag, off by default, as the skill itself requires.

It was distilled from a complete first integration against `@surgecredit/borrow-sdk@0.1.13` (October and November 2026): a working app, 182 offline tests, three live signet lifecycles, 49 findings and 13 defects reported to Surge. The skill carries what that run learned so the next team does not learn it again.

## What is in it

```
skills/surge-borrow/
  SKILL.md                      workflow, rules of work, build order (loaded when the skill triggers)
  references/sdk-and-facts.md   the SDK as shipped, signatures per flow, error codes, 52 verified facts, external signers
  references/what-to-build.md   architecture requirements, screens, display rules, safety rails, stuck states
  references/use-cases.md       the A–N use-case inventory a complete integration tests
  references/harness.md         test network, coins, identities, funding protocol, timings, test levels, drive mode
  assets/brief-template.md      the per-project brief (v4 of the executed brief; /surge-borrow:start writes it)
  scripts/                      wallet generator and signer, esplora client, funding helper, signer bridge,
                                drive and pay commands, secret scanner (copied into the project)
  evals/                        test cases for `claude plugin eval`
commands/start.md               /surge-borrow:start — asks the project questions and writes docs/SURGE-BRIEF.md
hooks/                          refuses tool calls that would print the harness mnemonic; scans edited files for secrets
```

## Install

From a terminal with Claude Code:

```bash
claude plugin marketplace add https://github.com/surgecredit/surge-borrow-skill
claude plugin install surge-borrow@surge-borrow-skill
```

The GitHub shorthand `surgecredit/surge-borrow-skill` or a local path to a clone works in place of the URL.

Or, to use only the skill without the command and hooks, copy `skills/surge-borrow/` into your project's `.claude/skills/`, or into `~/.claude/skills/` for every project.

## Use

In the repository that will hold the integration:

```
/surge-borrow:start
```

answers the per-project questions (wallet or standalone, platform, who holds the keys, account model, SIWE origin, Surge contact) and writes `docs/SURGE-BRIEF.md`. Then:

```
Read docs/SURGE-BRIEF.md and use the surge-borrow skill to build it.
```

The skill also answers questions on its own: how many wallet prompts a withdrawal takes, why a swept wallet cannot open a new line, how long a deposit takes to mint on signet.

## Test the skill

```bash
claude plugin eval skills/surge-borrow --allow-tools Write,Edit,Bash
```

runs the cases under `skills/surge-borrow/evals/` with and without the skill and writes a report under `evals/results/`. These are billed model runs.

## Keeping it current

The facts were verified against SDK 0.1.13. When Surge ships a new version, re-run the probes the skill describes, re-verify the numbered facts in `references/sdk-and-facts.md`, update the signature table if any call site moved, and bump `version` in `.claude-plugin/plugin.json`.
