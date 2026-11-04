---
name: surge-borrow
description: Integrate Bitcoin-backed USDC borrowing on Surge.Credit (the @surgecredit/borrow-sdk) into a wallet or build it as a standalone app, and test it on Surge's private signet with real coins through to mainnet behind a flag. Use this skill whenever a task mentions Surge, Surge.Credit, SurgeSats, the borrow SDK, a Bitcoin-collateralised USDC credit line, vault deposits, or an E2E run on Surge's signet, even when the user does not say "Surge" and only describes borrowing USDC against BTC, repaying, withdrawing collateral or renewing a term. It carries the verified SDK facts, the signature counts per flow, the full use-case inventory, and a funded test harness (identities, funding protocol, signer bridge, drive mode).
---

# Surge borrowing integration

Everything durable about building a Surge.Credit borrowing feature lives here: what the SDK actually does (not what its README says), the 52 facts that cost the first integration days, the use cases a complete integration must test, and the harness scripts that drove three live signet lifecycles with real coins. The per-project part (what product, which platform, who signs, what done looks like) is a one-page brief the project keeps at `docs/SURGE-BRIEF.md`.

## Start here

1. **Read the project's brief** at `docs/SURGE-BRIEF.md`. If it does not exist, create it from `assets/brief-template.md` (ask the user the "§1. This project" and "§5. Inputs from the human" questions it lists, or run `/surge-borrow:start` when the plugin is installed). Do not start building without it: the key-custody and account-model answers decide the signer design.
2. **Read `references/sdk-and-facts.md` in full before designing anything.** It is the protocol and SDK as shipped, the signature table per flow (a withdrawal is 3 + N signatures for N vault inputs and a renewal 2 + N, not the two the README claims), the 29 error codes, and the numbered facts. Section numbers in every reference file follow the executed brief, so a cross-reference such as §4.7 means fact 7 of that file.
3. Then read the SDK's own `README.md` ("Flows and their states" first) and `dist/index.d.ts`, and the reference signers in `examples/playground/signers/`. Where they disagree with the facts file or with each other, the shipped `dist/index.js` is the truth. Record each disagreement in `docs/FINDINGS.md` as you find it, and re-verify every numbered fact against the SDK version you install: they were true for 0.1.13.
4. Open the other references when the work reaches them: `references/what-to-build.md` (architecture requirements, screens, display rules, safety rails, the stuck-state table) before the first screen; `references/use-cases.md` (the A–N inventory) to seed the test matrix on day one; `references/harness.md` (test network, coins, identities, funding protocol, timings, test levels, drive mode) before the first live step.

## Rules of work

These are the rules the first integration learned the hard way. Each has a reason; keep the reason in mind when a situation the rule did not foresee comes up.

1. **Probe before building.** Reads need no wallet. Run `getMarkets`, `getBtcPriceUsd`, `getFeeRates`, `fetchBlockHeight` and the position reads on the known positions listed in `references/harness.md` §8.4 on both networks, and commit the outputs as dated JSON under `docs/probes/`. The real numbers contradict assumptions (the signet oracle is a fixed $190,000; the term is 52,416 blocks whatever the network; a liquidated position still reports `isActive: true`), and the probe outputs are the evidence the findings cite.
2. **Keep a living test matrix** (`docs/USE-CASES.md`) seeded from the inventory. Columns: ID, use case, level (unit / component / contract / live-read / E2E / manual), provokable live on signet (yes / no / ~40 days / mainnet-only), status, evidence. A use case without a row does not exist; a row without evidence is not done.
3. **Never weaken a test to make it pass, and never report an E2E result you did not observe.** An assertion that touches money quotes the on-chain evidence (txid, tx hash, relayer record). If a flow cannot be completed, say so and record why. A result card left by the previous flow is not the next flow's outcome: clear it before submitting, and prove a renewal by the relayer's extension record and the moved exit block, never by the card (a run recorded a withdrawal's txid as its renewal that way).
4. **Only funding, an optional test mnemonic, the SIWE origin, mainnet endpoints and the mainnet go/no-go come from the human.** No WalletConnect project ID and no browser wallet extension is needed at any test level; the harness injects signers. Everything else you decide and write down with a one-line reason.
5. **Secrets.** The harness mnemonic lives only in `.e2e/wallet.json` (mode 0600, git-ignored from the first commit) or comes from `TEST_MNEMONIC`, in which case only a fingerprint is written. Print derived addresses, never the phrase. Never print signatures, PSBTs, JWTs or seeds. Harness code is imported only under `tests/` and `scripts/`, and a build-time check fails the production bundle if it, the test-signer injection point or the SDK's `/dev` entry is reachable. `scripts/check-secrets.ts` scans the repo and the bundle.
6. **Work in verified increments.** Run the whole non-E2E suite before claiming any milestone; run the E2E suite before claiming the project is done.
7. **Bound every wait.** Signet blocks arrive about every 64 seconds; a deposit mints 3 confirmations after it is sent (4 to 8 minutes); a withdrawal or renewal finalizes in 4 to 9 minutes. Every wait is condition-driven with a timeout sized from those numbers. Unbounded waits cost the first run about an hour, and a button that never rendered cost 45 minutes.
8. **Evidence hierarchy.** The chain and the explorers are primary; relayer status records second; the testnet dashboard is a delayed confirmation (about 20 minutes behind, and it omits empty vaults). Never block a funded run on a dashboard row.
9. **One SDK session per wallet.** A second SIWE sign-in for the same EVM address revokes the first within minutes. Tests memoise one headless session per test and sign the app back in before driving it.
10. **Never retry a flow after any error.** A rejected prompt is a state the resume paths handle; a retry executed a second withdrawal on live signet because the SDK resumed the pending authorization with the original signer.
11. **Mark one-shot live steps in the ledger before they run**, not after; a rerun repeated a top-up because the mark was written afterwards.
12. **Design each lifecycle spec to restart the app at every interruption point** (after `createDeposit`, mid collateral sync, mid `borrowMoreSync`, after the withdraw broadcast, mid extension), so the reload-and-resume use cases come out of the funded run instead of staying at contract level.

## Build order

Signer adapters with a fixture test → network state and the boot/resume state machine → wallet-free screens (markets, quote, calculator, diagnostics) → the Open flow and the E2E runner skeleton → the first funding request, made only when the Open step is ready to use the coins → the signer conformance test live (one withdrawal, one renewal, signed by the product's own keys) → the parked position on identity 1 → the rest of the flows, each landing with its unit, component and contract tests before its E2E step → the drive command. Done means every criterion in the project brief's "Definition of done", demonstrated in `docs/E2E-REPORT.md`.

## The harness scripts

`scripts/` holds the pieces that took real effort to get right. Copy them into the project's `scripts/` and `tests/` (they are not run from the skill folder) and install their dependencies there: `@surgecredit/borrow-sdk`, `viem`, `bitcoinjs-lib`, `@bitcoinerlab/secp256k1` (or `tiny-secp256k1`), `bip32`, `bip39`, `@playwright/test`, `tsx`.

| File | What it does | Adapt |
| --- | --- | --- |
| `lib/wallet.ts` | Generates or loads the harness mnemonic (0600 file, fingerprint only when supplied), derives identity N (EVM `m/44'/60'/N'/0/0`, BTC `m/86'/1'/N'/0/0` on signet) with a `BtcSigner` that script-path signs the vault leaf with the untweaked key, a key-path signer for the identity's own coins, and the identities ledger. | Nothing; this is the reference implementation of the signer the facts file describes. |
| `lib/esplora.ts` | Minimal esplora client: tip height, UTXOs, balances, broadcast, confirmation polling. | Nothing. |
| `lib/funding.ts` | Key-path P2TR spends from identity 0 to a vault or another identity, with fee estimation and change. | Nothing. |
| `bridge.ts` | Playwright signer bridge: keys stay in Node, the page gets proxy signers through a flag-guarded handle the app exposes only in test builds; controls to reject or delay the next signature and to record typed data; adopts on every page load; shims esbuild's `__name` helper so it also works under tsx. | The handle name and the two `setEvmWallet` / `setBtcWallet` calls must match the app's controller. |
| `e2e-drive.ts` | `drive`: a real browser signed by an unused identity with every signature confirmed in the terminal (Enter signs, `n` rejects), starting the dev server with the test flag and a non-throttling RPC, refusing at once a server started without the flag. `pay`: funds a vault from identity 0 and waits for one confirmation. | `DEV_SERVER`, `OVERRIDE_KEY` and the handle check at the top of the file. |
| `check-secrets.ts` | Scans tracked files and a built bundle for JWTs, PSBTs, extended private keys, PEM blocks, 65-byte signatures and 12-word runs of BIP-39 words; allowlists the SDK's public anon keys. | The bundle directory. |

For a product that is not TypeScript, the knowledge still applies and the scripts become the specification of what to port; `references/sdk-and-facts.md` §3.8 says how to run the SDK in a JavaScript runtime or a keyless sidecar instead of porting the relayer protocol.

## When the user only has a question

Not every use of this skill is a build. If the user asks how many prompts a withdrawal takes, why a swept wallet cannot open a new line, how long a deposit takes to mint on signet, or what a stuck renewal looks like, the answer is in `references/sdk-and-facts.md` (§3.9 for signatures, §4 for behaviour) or the stuck-state table in `references/what-to-build.md`; quote the fact and its verification status rather than the SDK README, which is wrong on several of these points.
