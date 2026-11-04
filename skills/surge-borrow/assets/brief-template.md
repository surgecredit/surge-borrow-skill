# Brief v4: Bitcoin-backed USDC borrowing on Surge.Credit, built with the `surge-borrow` skill

> **How to use this file.** Install the `surge-borrow` skill (§0), fill in §1 and §5, commit this file as `docs/SURGE-BRIEF.md` in the repository that will hold the work, and start a fresh coding-agent session with: "Read docs/SURGE-BRIEF.md and use the surge-borrow skill to build it." Everything durable about the protocol, the SDK as shipped, the pitfalls, the use cases and the funded test harness lives in the skill; this brief holds only what is specific to this project and the contract between the human and the agent.
>
> **Where it comes from.** The skill was distilled from a complete first integration against `@surgecredit/borrow-sdk@0.1.13` (October and November 2026: a working app, three live signet lifecycles with real coins, 51 findings, 13 defects reported to Surge) and then corrected by two rounds of evals in which fresh agents exposed two wrong facts. The self-contained edition of this brief, for a session that cannot load skills, is `docs/BRIEF-v3.md` in the reference repository; it carries the same content inline.

---

## 0. The skill

The agent must have the `surge-borrow` skill loaded before it designs anything. It is a Claude Code plugin whose repository is also its marketplace:

```bash
claude plugin marketplace add <URL or path of the surge-borrow-skill repository>
```

```bash
claude plugin install surge-borrow@surge-borrow-skill
```

Installing the plugin also gives `/surge-borrow:start` (writes this file from the answers to §1 and §5) and two hooks: one refuses any tool call that would print the harness mnemonic or `TEST_MNEMONIC`, the other reports secrets written into an edited file. A team that wants only the knowledge can copy `skills/surge-borrow/` into `.claude/skills/` instead and lose the command and the hooks.

**Agent: before anything else, confirm the skill is available** (it appears in your skills list as `surge-borrow`). If it is not, stop and say so; do not reconstruct its content from memory. If it cannot be installed, ask for `docs/BRIEF-v3.md` from the reference repository and work from that instead.

What the skill holds, so the human knows where to look and the agent knows what to open when:

| In the skill | Contents | Open it |
| --- | --- | --- |
| `SKILL.md` | the workflow, the thirteen rules of work, the build order, the script table | always, first |
| `references/sdk-and-facts.md` | the SDK as shipped (§3), the signatures per flow (§3.9), the 29 error codes (§3.10), the 52 verified facts (§4), external signers (Appendix A) | before designing; re-verify §4 against the installed SDK |
| `references/what-to-build.md` | architecture requirements, screens, display rules, safety rails, the stuck-state table (§6) | before the first screen |
| `references/use-cases.md` | the A–N inventory a complete integration tests (§7) | day one, to seed the test matrix |
| `references/harness.md` | test network and coins (§5), identities, funding protocol, costs, timings, test levels, the drive command (§8) | before the first live step |
| `scripts/` | wallet generator and signer, esplora client, funding helper, Playwright signer bridge, drive and pay commands, secret scanner | copy into the project; adapt the three marked spots |
| `evals/` | the cases the skill is tested with | not needed for a build |

Section numbers inside the references follow the executed brief, so a cross-reference such as §4.7 means fact 7 of the facts file. Two facts worth knowing before you fill in §1, because they shape the key design: a credit line is bound to its (BTC key, EVM address) pair for life (§4.6, §4.7), and the vault leaf needs one software-held single-sig taproot key (§4.9, §4.11).

## 1. This project (fill in before pasting)

- **WALLET_NAME** and **TARGET**: a feature inside an existing wallet, or a standalone app. A standalone app that generates or imports its own seed is a wallet for every rule in the skill; one that delegates signing to browser or hardware wallets follows the skill's Appendix A for the signing leg.
- **PLATFORM**: web, browser extension, React Native, Flutter, native iOS/Android, desktop. The E2E driver (harness §8.6) and the SDK runtime (facts §3.8) follow from it.
- **LANGUAGE and STACK**: the SDK is TypeScript (browser, Node, React Native). If the product is not TypeScript, decide per facts §3.8 how the SDK runs (a JavaScript runtime in the app or a keyless sidecar; do not port the relayer protocol). Use the product's own UI framework, state library, bundler and test runners; add nothing that duplicates them.
- **KEY_CUSTODY**: (a) the product holds BIP-39 seeds in software and can derive BIP-86 and BIP-44 keys and produce Schnorr and secp256k1 signatures; or (b) it delegates to external or hardware signers. A multisig product contributes one dedicated software key, not its policy; a hardware-first product needs a software key for this feature or a Keystone 3 Pro / Krux.
- **ACCOUNT_MODEL**: how accounts are indexed (one seed with an account index per account, or otherwise) and whether an EVM account on Base (8453) and Base Sepolia (84532) exists. Borrowed USDC lands on the EVM address of the pair, so the product must show USDC on Base.
- **SIWE_ORIGIN**: the origin Surge will allowlist for sign-in (facts §4.13). For a web product the page origin; for anything else a URL you choose and Surge allowlists. Until it exists, test from `http://localhost:3000`.
- **SURGE_CONTACT**: whether you have a channel to Surge. Needed for the allowlist, for the undocumented timing windows (facts §4.27), and to close a test line if a bound pair must be reused.
- **WHERE_IT_LIVES**: the screen or account view the feature hangs off, the design system to follow, and any product constraint the agent must respect (release train, review process, languages the copy must exist in).

## 2. What you are building and when it is done

You are adding Bitcoin-backed USDC borrowing on Surge.Credit to WALLET_NAME with the official `@surgecredit/borrow-sdk`: a `BtcSigner` and an `EvmSigner` built from the keys the product controls, a service layer that drives the SDK and models the credit line's state, and the screens. It runs against Surge's test network ("signet": Surge's private Bitcoin signet + Base Sepolia) and against mainnet (Bitcoin + Base), switchable at runtime, with mainnet behind a flag and reads-only until the human's written go/no-go. It is tested at every level, finishing with end-to-end tests against the live test network with real coins for every use case the protocol exposes.

**Definition of done.** All of the following are true and demonstrated in `docs/E2E-REPORT.md`:

1. Every use case in the skill's inventory (`references/use-cases.md`, extended by you) has a test at the highest level at which it can be exercised, and every row of `docs/USE-CASES.md` states its evidence: a Bitcoin txid on https://signet.surge.dev, a Base Sepolia tx hash on https://sepolia.basescan.org, a relayer record id, a vault row on https://testnet.earn.surge.credit/#/vaults, or a recorded-fixture test for states that cannot be provoked live.
2. Unit, component, SDK-contract, live-read and E2E suites all pass from a clean clone with one command each, and CI runs the first four on every push.
3. The signer adapters pass a **conformance test on live signet**: one withdrawal and one renewal built by the SDK, signed by the product's own keys, confirmed on chain, with the signature counts the skill's §3.9 table predicts for the vault's input count. Until that passes, no screen is done.
4. The **key and account strategy is written down**: which key pair backs a line, how borrowing resumes after a sweep and when a second pair is needed (facts §4.7), and how existing lines are rediscovered from the seed alone.
5. The mainnet build is behind a flag, uses operator-supplied RPC endpoints, and passes a read-only smoke suite against real mainnet positions.
6. `docs/FINDINGS.md` lists every place the SDK's README, docs, type definitions and shipped code disagreed with each other or with observed behaviour, with evidence, including the re-verification of every numbered fact in the skill's §4 against the SDK version installed here.
7. No secret, seed, signature, PSBT or JWT appears in any log, screenshot, trace or committed file, and the production key store is unreachable from test code.

## 3. The contract between the human and the agent

The skill's rules of work apply in full. These are the points that need the human's agreement in writing, because they decide what the agent may do on its own:

1. **Only these things come from the human** (§5): being signed in to the SurgeSats wallet and sending test BTC and USDC when the harness asks, an optional test mnemonic, the SIWE origin, mainnet endpoints and the mainnet go/no-go. No WalletConnect project ID and no browser wallet extension is needed at any test level. Everything else the agent decides and writes down with a one-line reason.
2. **Funding is requested, never assumed.** The harness computes the need, prints one request block (asset, network, address, amount, purpose, explorer link), stops until the human says it is sent, and verifies arrival on chain before continuing. A full set of lifecycles costs about 100,000 sats and about 10 USDC (harness §8.3); never millions.
3. **Secrets.** The harness mnemonic lives only in `.e2e/wallet.json` (mode 0600, git-ignored from the first commit) or comes from `TEST_MNEMONIC`, in which case only a fingerprint is written. Derived addresses are printed, never the phrase; never signatures, PSBTs, JWTs or seeds. Test builds receive the harness seed through the product's ordinary restore flow or the signer bridge, never through a production code path, and a build-time check fails the production bundle if harness code, the injection point or the SDK's `/dev` entry is reachable.
4. **Mainnet is reads-only** until the human approves, in writing, a dry-run plan with the exact amounts and fees. The paid run is then the minimum: minimum borrow, smallest collateral the market allows, partial withdraw and sweep, nothing else.
5. **No result is reported that was not observed.** An assertion that touches money quotes the on-chain evidence; a flow that cannot be completed is recorded as such with the reason. Never weaken a test to make it pass.
6. **Waits are bounded and flows are never retried after an error** (skill rules 7 and 10); a rejected prompt is a state the resume paths handle.

## 4. What to build and how to test it

The skill's `references/what-to-build.md` is the build specification (architecture requirements, screens, display rules, safety rails, the stuck-state table) and `references/harness.md` the test specification (identities, funding protocol, timings, the six test levels, the drive command). This project adds only:

- **Placement**: the feature lives where §1 WHERE_IT_LIVES says; the entry point is on the BTC account ("Borrow USDC against this BTC").
- **Signers**: from the product's keys per facts §4.9 and §4.10; copy the skill's `scripts/lib/wallet.ts` as the reference implementation and the conformance fixture.
- **Prompts**: copy and counters follow the skill's §3.9 table, sized from the confirmed vault UTXO count and corrected at the PSBT prompt; a withdrawal is 3 + N signatures and a renewal 2 + N.
- **E2E driver**: Playwright on web; Detox or Maestro on React Native; the platform's integration driver on Flutter or native; the extension's own harness for extensions. Keys enter the test build through the product's restore flow where possible, otherwise through the skill's signer bridge.
- **Deliverables**: the integration with a README section (setup, environment variables, the SIWE origin, the key strategy, the signet funding procedure, the drive command); `docs/SURGE-BRIEF.md` (this file), `docs/USE-CASES.md`, `docs/FINDINGS.md` (decisions as a section of it), `docs/E2E-REPORT.md`, `docs/RUNBOOK.md`, `docs/probes/`; `tests/` and `scripts/`; `SURGE-BUGS.md` addressed to Surge, starting from the defects the skill already lists and marking which still reproduce.

## 5. Inputs from the human (fill in before pasting)

- **`TEST_MNEMONIC`** (optional): a test-only phrase for the harness identities. Leave unset and the harness generates and stores its own.
- **SIWE_ORIGIN**: the origin Surge has allowlisted for this product, or confirmation that `http://localhost:3000` is to be used until one exists.
- **SurgeSats access**: an account at https://wallet.surge.dev the human can sign in to and that holds signet BTC. The harness asks them to confirm they are signed in before its first funding request; the agent never creates an account or signs in there.
- **Funding on request**: signet BTC from SurgeSats and Base Sepolia USDC from wherever the human sources it; the harness verifies arrival on chain. Expect one request of about 100,000 sats and one of about 10 USDC for a full set of lifecycles.
- **Surge contact** (if any): to allowlist the origin, to ask for the deposit-expiry and sync-timeout windows, and to close a test line if a bound pair needs reuse.
- **Mainnet**: `MAINNET_EVM_RPC_URL`, `MAINNET_BTC_API_URL`, and a written go/no-go for the paid run. Until that approval exists, mainnet work is reads only.

## 6. Begin

Load the skill and follow its "Start here": read `references/sdk-and-facts.md` in full, then the SDK's own README, `dist/index.d.ts` and reference signers, recording every disagreement in `docs/FINDINGS.md`; run the wallet-free probes on both networks and commit them under `docs/probes/`; generate the harness wallet (print identity 0's addresses, never the phrase); write the first `docs/USE-CASES.md` from the inventory and the key-strategy decision. Then build in the skill's order: signer adapters with their fixture test → network state and the boot/resume machine → wallet-free screens → the Open flow and the E2E runner skeleton → the first funding request, made only when the Open step is ready to use the coins → the signer conformance test live → the parked position on identity 1 → the rest of the flows, each with its unit, component and contract tests before its E2E step → the drive command. Report progress against the definition of done, and when the skill and the installed SDK disagree, the shipped `dist/index.js` is the truth: record the disagreement and tell the human, because the skill will need the correction too.
