# Surge borrowing: project brief for WALLET_NAME

> One page per project. Fill in §0 and §10, commit this file as `docs/SURGE-BRIEF.md`, and start the session with: "Read docs/SURGE-BRIEF.md and use the surge-borrow skill." Everything durable about the protocol, the SDK, the pitfalls, the use cases and the test harness lives in the skill, not here.

You are adding Bitcoin-backed USDC borrowing on Surge.Credit to **WALLET_NAME** (§0), using the official `@surgecredit/borrow-sdk`. A user locks BTC in a per-user taproot vault, receives USDC on Base, and later repays, withdraws or renews. The integration has three parts: a `BtcSigner` and an `EvmSigner` built from the keys the product controls; a service layer that drives the SDK and models the credit line's state; and the screens. It must run against Surge's test network ("signet": Surge's private Bitcoin signet + Base Sepolia) and against mainnet (Bitcoin + Base), switchable at runtime, with mainnet behind a flag and reads-only until the human's written go/no-go. It must be tested at every level, finishing with end-to-end tests against the live test network with real coins for every use case the protocol exposes.

**Definition of done.** All of the following are true and demonstrated in `docs/E2E-REPORT.md`:

1. Every use case in §7 (extended by you) has a test at the highest level at which it can be exercised, and every row of the test matrix states its evidence: a Bitcoin txid on https://signet.surge.dev, a Base Sepolia tx hash on https://sepolia.basescan.org, a relayer record id, a vault row on https://testnet.earn.surge.credit/#/vaults, or a recorded-fixture test for states that cannot be provoked live.
2. Unit, component, SDK-contract, live-read and E2E suites all pass from a clean clone with one command each, and CI runs the first four on every push.
3. The signer adapters pass a **conformance test on live signet**: one withdrawal and one renewal built by the SDK, signed by the product's own keys, confirmed on chain. Until that passes, no screen is done.
4. The **key and account strategy for credit lines is written down**: which key pair backs a line, how a second line is opened after the first is swept (§4.7), and how existing lines are rediscovered from the seed alone.
5. The mainnet build is behind a flag, uses operator-supplied RPC endpoints, and passes a read-only smoke suite against real mainnet positions.
6. `docs/FINDINGS.md` lists every place the SDK's README, docs, type definitions and shipped code disagreed with each other or with observed behaviour, with evidence, including the re-verification of §4.
7. No secret, seed, signature, PSBT or JWT appears in any log, screenshot, trace or committed file, and the production key store is unreachable from test code.

## 0. Fill in before starting

- **WALLET_NAME** and **TARGET**: a feature inside an existing wallet, or a standalone app. A standalone app that generates or imports its own seed is a wallet for every rule below; a standalone app that delegates signing to browser or hardware wallets follows Appendix A for the signing leg.
- **PLATFORM**: web, browser extension, React Native, Flutter, native iOS/Android, desktop. The E2E driver (§8.6) and the SDK runtime (§3.8) follow from it.
- **LANGUAGE and STACK**: the SDK is TypeScript (browser, Node, React Native). If the product is not TypeScript, decide per §3.8 how the SDK runs. Use the product's own UI framework, state library, bundler and test runners; add nothing that duplicates them.
- **KEY_CUSTODY**: (a) the product holds BIP-39 seeds in software and can derive BIP-86 and BIP-44 keys and produce Schnorr and secp256k1 signatures; (b) it delegates to external or hardware signers. The vault leaf needs one software-held single-sig taproot key (§4.9, §4.11): a multisig product contributes one dedicated key, not its policy, and a hardware-first product needs a software key for this feature or a Keystone 3 Pro / Krux.
- **ACCOUNT_MODEL**: how accounts are indexed (one seed with an account index per account, or otherwise) and whether an EVM account on Base (8453) and Base Sepolia (84532) exists. Borrowed USDC lands on the EVM address of the pair (§4.6), so the product must show USDC on Base.
- **SIWE_ORIGIN**: the origin Surge will allowlist for sign-in (§4.13). For a web product the page origin; for anything else a URL you choose and Surge allowlists. Until it exists, test from `http://localhost:3000`.
- **SURGE_CONTACT**: whether you have a channel to Surge. Needed for the allowlist, for the undocumented timing windows (§4.27), and to close a test line if a bound pair must be reused.

## 10. Inputs from the human

- **`TEST_MNEMONIC`** (optional): a test-only phrase for the harness identities. Leave unset and the harness generates and stores its own.
- **SIWE_ORIGIN**: the origin Surge has allowlisted for this product, or confirmation that `http://localhost:3000` is to be used until one exists.
- **SurgeSats access**: an account at https://wallet.surge.dev the human can sign in to and that holds signet BTC. The harness asks them to confirm they are signed in before its first funding request.
- **Funding on request**: the harness prints funding requests for signet BTC and Base Sepolia USDC and waits; the human sends from SurgeSats or wherever they source Sepolia USDC; the harness verifies arrival on chain. Expect one request of about 100,000 sats and one of about 10 USDC for a full set of lifecycles.
- **Surge contact** (if any): to allowlist the origin, to ask for the deposit-expiry and sync-timeout windows (§4.27), and to close a test line if a bound pair needs reuse.
- **Mainnet**: `MAINNET_EVM_RPC_URL`, `MAINNET_BTC_API_URL`, and a written go/no-go for the paid run of §8.6. Until that approval exists, mainnet work is reads only.

Begin by installing the SDK, reading the files in §1.1, running the probes in §1.2 on both networks, generating the test wallet of §8.1 (print identity 0's addresses, never the phrase), and writing the first versions of the test matrix, the findings file and the key-strategy decision. Then build in this order: signer adapters with their fixture test → network state and the boot/resume machine → wallet-free screens → the Open flow and the E2E runner skeleton → the first funding request, made only when the Open step is ready to use the coins → the signer conformance test live (one withdrawal, one renewal) → the parked position → the rest of the flows, each landing with its unit, component and contract tests before its E2E step is added → the drive command.
