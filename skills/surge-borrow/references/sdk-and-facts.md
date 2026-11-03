<!-- Carved from the executed brief (docs/BRIEF-v3.md in the reference repo). Section numbers are kept so cross-references such as §4.7 stay valid across the reference files. -->

## 3. The protocol and the SDK as shipped (`@surgecredit/borrow-sdk@0.1.13`, Oct 2026)

Public on npm, no `.npmrc`. Pin the exact version. `viem` is the only peer dependency; Node >= 18; dual ESM + CJS.

**3.1 Headless and signer-agnostic.** You inject an `EvmSigner` (`address`, `signMessage` for EIP-191, `signTypedData` for EIP-712) and a `BtcSigner` (`address`, x-only `publicKey`, `signPsbt(psbtBase64, inputs: TapInputRef[])` that script-path Schnorr-signs the vault's repayment tapleaf). The SDK never holds keys. Borrowed USDC is disbursed to the EVM address. Smart-contract wallets (ERC-1271) are not supported.

**3.2 Session.** `createBorrowClient({ network, storage?, evmRpcUrl?, btcApiUrl?, siwe? })`, then `client.restoreSession({ evmSigner, btcSigner })` (never prompts; `null` if there is no JWT for this wallet) or `client.createSession(...)` (one SIWE signature via Supabase `signInWithWeb3`). Then `userExists()` / `registerUser()` on first use. Pass a `storage` adapter backed by the product's persistent store, keyed per network and EVM address: without it the session is memory-only on every runtime, whatever the docs site says about a localStorage fallback **(verified)**.

**3.3 Buffer.** bitcoinjs-lib needs a global `Buffer` or the first vault derivation crashes with `Buffer is not defined`. Verify in the production build, not only in development; under Turbopack a webpack `ProvidePlugin` recipe does nothing, so install the polyfill as the first import of the one module that imports the SDK **(verified)**.

**3.4 Vault.** `session.getVault()` derives the P2TR deposit address locally from the BTC x-only pubkey, the EVM address and nonce 0 (`vaultId = keccak256(evmAddress, nonce)`). The internal key is the NUMS point, so every spend is a script path: a repayment leaf (the user's Schnorr signature plus Surge's MPC co-signature, prefixed by `<vaultId> OP_DROP`) and an exit leaf with a 52,416-block relative timelock. Nonce must stay 0. Details at https://docs.surge.credit/tech/vaults.

**3.5 Term and constants.** Omit `durationDays`: the SDK supplies `CREDIT_LINE_TERM_DAYS = 360`, bounded by `EXIT_CSV_BLOCKS = 52,416`; anything above 360 is refused with `INVALID_PARAMS` and the docs site's `durationDays: 90` example is stale **(verified)**. `MIN_BORROW_USD = 5`. `COLLATERAL_BUFFER_MULTIPLIER = 1.015`. Dust is 546 sats.

**3.6 Networks** (from `getNetworkConfig`; read them at runtime, the table is for orientation and the Diagnostics screen):

| | signet | mainnet |
| --- | --- | --- |
| Bitcoin | Surge's private signet (`tb1p…`) | Bitcoin (`bc1p…`) |
| EVM | Base Sepolia, chain 84532 | Base, chain 8453 |
| Relayer gateway | https://test.relay.surge.dev | https://beta.relay.surge.build |
| Default EVM RPC | https://sepolia.base.org | https://mainnet.base.org |
| Default BTC API (esplora) | https://esplora.signet.surge.dev | https://mempool.space/api |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| VaultManager | `0x4b6b3Ea5936d144A3edC783aFDfdcC1f95f1818e` | `0x0D5D12de1cC71060A38F25DD9d24DA1DD6eB705a` |
| Oracle | `0x8172Db638e71382c4bD3d0ed425011a09c73642A` | `0x54DE003026dCa32E7cb28BDC79dDDcdB1bc1194D` |
| USDC EIP-712 domain name | `"USDC"` | `"USD Coin"` |
| Bitcoin explorer | https://signet.surge.dev (mempool UI) | https://mempool.space |
| EVM explorer | https://sepolia.basescan.org | https://basescan.org |
| Surge dashboard | https://testnet.earn.surge.credit/#/vaults | https://earn.surge.credit |

The relayer gateway and the oracle are fixed per network inside the SDK; only `evmRpcUrl` and `btcApiUrl` (esplora-compatible: `/blocks/tip/height`, `/address/:a/utxo`, `/fee-estimates`, `/tx`) can be changed.

**3.7 Method surface** (session unless noted).

- **Reads** (also on the client, wallet-free): `getMarkets`, `getPosition`, `getLiquidation`, `getRepaymentDeadline`, `getBorrowQuote`, `getRequiredCollateral`, `getBtcPriceUsd`, `getFeeRates`. Session-only: `getPositionId`, `getVault`, `getVaultBalance`, `getWithdrawable`, `getUsdcBalance`, `getActivities`, `getAccessToken`, and the one-shot status reads `getDepositStatus`, `getActiveDeposit`, `getCollateralSyncStatus`, `getBorrowMoreSyncStatus`, `getWithdrawStatus`, `getPendingWithdrawal`, `getExtensionStatus`.
- **Actions:** `createDeposit`, `addCollateral`, `syncCollateral`, `borrowMore`, `borrowMoreSync`, `switchMarket`, `repay`, `withdraw`, `resumeWithdrawal`, `reconcileWithdrawal`, `extendCreditLine`, `resumeExtension`, `registerUser`, `signOut`.
- **Watchers** (each returns an unsubscribe function you must call on unmount): `watchDeposit`, `watchCollateralSync`, `watchBorrowMoreSync`, `watchWithdrawal`, `watchExtension`, `watchActivities` (polls every 30 s by default).
- **Helpers:** `isFlowTerminal(flow, status)`, `classifyStatus(status)`, `isDepositTerminal`, `parseAmountUsd`, `parsePositionId`, `parseSats`, `estimateFeeSats`, `fetchBlockHeight`, `deriveVaultAddress`, `getVaultId`, `getNetworkConfig`, `computeRepaymentDeadline`.
- Dev-only entry `@surgecredit/borrow-sdk/dev` (`setDebugAccessToken`) must never reach a production bundle; the contract tests use it to mint a session without SIWE.

**3.8 If the product is not TypeScript.** Prefer running the real SDK over porting it: a JavaScript runtime inside the app (a hidden WebView or an embedded JS engine with signer callbacks into the native side; for Flutter, a JS bridge plugin), or a thin TypeScript sidecar service that holds no keys and receives signatures from the product over a local channel. The relayer gateway is not a published API; a port has to be derived from `dist/index.js` and re-derived on every release. For orientation, the routes the shipped SDK uses and how each is authenticated (**verified** in code): `POST /v1/users` (register, JWT), `GET /v1/users/exists` (keyed on the BTC public key), `POST /v1/btc/deposits` (EIP-191 envelope), `GET /v1/btc/deposits/{id}` and `/v1/btc/deposits/by-address/{evm}`, `POST /v1/beta/borrow-more` (envelope), `POST /v1/beta/borrow-more/switch-market` (JWT), `POST /v1/borrow-more-sync` (envelope) and `GET /v1/borrow-more-sync/status/{nft}`, `POST /v1/beta/sync-collateral` (JWT) and `GET /v1/beta/sync-collateral/status/{nft}`, `POST /v1/repay/gasless` (JWT, carrying two EIP-712 signatures), `POST /v1/withdraw/gasless` (JWT, carrying one EIP-712 signature), `POST /v1/beta/repay/sign-repayment` (envelope, carrying the user-signed PSBT; returns Surge's co-signature), `GET /v1/withdraw/status/{nft}`, `POST /v1/beta/repay/submit-btc-withdrawal-tx` (envelope; the reconcile path), `POST /v1/credit-line-extension` (JWT, carrying one EIP-712 signature), `GET /v1/credit-line-extension/status/{nft}`, `POST /v1/credit-line-extension/sign-refresh` (envelope). The JWT comes from Supabase SIWE. The envelope is an EIP-191 signature over a canonical form of the request body plus an action name; copy the canonicalisation from the SDK, do not guess it. Position, liquidation, deadline, pending-withdrawal and market reads are `eth_call`s against the VaultManager and the oracle. Vault derivation, PSBT construction and the combine-and-finalize step are in the SDK too.

**3.9 Signatures per flow, as the shipped code performs them (verified).** The README's "At a glance" table under-counts two flows: after the Bitcoin signature, `withdraw` and `extendCreditLine` each sign **one EIP-191 envelope per vault input** (Surge co-signs each input), and a withdrawal signs **one more** to hand the txid to Surge. With N confirmed inputs a withdrawal is 3 + N signatures and a renewal 2 + N; the SDK re-signs an envelope on every retry of a slow relayer call, so the counts are a floor. Design copy and prompt counters from this table, sized from the confirmed UTXO count and corrected at the PSBT prompt.

| Flow | Signatures, in order | Returns when | Then |
| --- | --- | --- | --- |
| `createSession` | 1 EIP-191 (SIWE) | JWT stored | `userExists` → `registerUser` on first use |
| `createDeposit` | 1 EIP-191 envelope | deposit record exists | user sends BTC; `watchDeposit` until `nft_id` |
| `addCollateral` / `syncCollateral` | none (JWT only) | relayer starts watching | user sends BTC; `watchCollateralSync` |
| `borrowMore` | 1 EIP-191 envelope | draw submitted | re-read the position at 3 s and 9 s |
| `borrowMoreSync` | 1 EIP-191 envelope | job queued | user sends BTC; `watchBorrowMoreSync` (terminal on `submitted` / `confirmed`) |
| `switchMarket` | none (JWT only) | confirmed on-chain | done |
| `repay` | 2 EIP-712: `RepayWithERC3009`, then `ReceiveWithAuthorization` on the USDC domain (`version: "2"`) | broadcast | re-read |
| `withdraw` | 1 EIP-712 `WithdrawCollateral` → 1 Schnorr PSBT (one call, every confirmed vault input) → N EIP-191 envelopes (Surge co-signs each input) → 1 EIP-191 envelope (hands the txid to Surge; re-signed on up to 3 retries) | BTC tx broadcast | `watchWithdrawal` to `finalized` |
| `resumeWithdrawal` | 1 Schnorr → N EIP-191 → 1 EIP-191 | broadcast | `watchWithdrawal` |
| `reconcileWithdrawal` | 1 EIP-191 | relayer notified | re-read |
| `extendCreditLine` | 1 EIP-712 `RequestCreditLineExtension` → 1 Schnorr (vault self-spend, pays a miner fee) → N EIP-191 envelopes (one per input; each re-signed on up to 4 retries while the relayer indexes the request) | refresh tx broadcast | `watchExtension` |
| `resumeExtension` | 1 Schnorr → N EIP-191 | broadcast | `watchExtension` |

Two meanings of "done" disagree: `isFlowTerminal` says whether another update will ever arrive (gate spinners on it); `classifyStatus` says good or bad (pick styling with it). `borrowMoreSync` stops on `submitted` / `confirmed` and extension on `confirmed`, which `classifyStatus` still calls `in_progress`. On-chain reads lag the relayer: refresh again at about 3 s and 9 s after an action.

**3.10 Error codes (29).** `SESSION_UNAUTHENTICATED`, `GATEWAY_ERROR`, `INVALID_PARAMS`, `NOT_FOUND`, `RATE_LIMITED`, `RELAYER_UNAVAILABLE`, `RELAYER_OUT_OF_GAS`, `IDENTITY_CONFLICT`, `NETWORK_ERROR`, `DEPOSIT_ALREADY_ACTIVE`, `LOAN_ALREADY_ACTIVE`, `EXTENSION_ALREADY_PENDING`, `SIMULATION_REVERT`, `INSUFFICIENT_USDC_BALANCE`, `VAULT_ADDRESS_MISMATCH`, `VAULT_NOT_CONFIRMED`, `LTV_EXCEEDED`, `AMOUNT_BELOW_MINIMUM`, `INSUFFICIENT_COLLATERAL`, `WITHDRAWAL_AMOUNT_MISMATCH`, `INVALID_FEE_RATE`, `INVALID_WITHDRAW_ADDRESS`, `POSITION_IN_LIQUIDATION`, `POSITION_EXPIRED`, `POSITION_CLOSED`, `WITHDRAWAL_ALREADY_PENDING`, `INSUFFICIENT_MARKET_LIQUIDITY`, `SIGN_REQUEST_EXPIRED`, `NONCE_REUSED`. Every flow and read throws `BorrowError` with `.code`, `.status`, `.details`. Branch on `code`, never on `message`. The README's table lists 27 and the docs site 22; the type union has 29 **(verified)**. Two behave unlike their documentation: `VAULT_NOT_CONFIRMED` has no throw site in the shipped code (acting too early surfaces as `GATEWAY_ERROR`), and the `loanExpiry` guard behind `POSITION_EXPIRED` runs only in `withdraw` and `resumeWithdrawal`; `borrowMore`, `repay`, `switchMarket` and `addCollateral` check `isActive` only, and `extendCreditLine` checks neither **(verified)**. The UI contract (§6.5) must cover all 29 plus a normalised user rejection, which is not a `BorrowError`.

## 4. Facts that will cost you days

Numbered so the findings file can cite them. Re-verify each against the installed SDK and record the result.

**Chain and timing**

1. **Surge's signet is a private chain.** It shares the genesis block with public signet and diverges at block 1; the tip is above 3.33 million and blocks arrive about every 64 s (about 1,350 a day; the SDK's `BLOCK_MINUTES` assumes 60 s). Coins from any public signet, testnet3 or testnet4 faucet are on the wrong chain, look valid (`tb1…`) and are lost. The only source of test BTC is https://wallet.surge.dev (§5). The docs site still points at public faucets. **(verified)**
2. **The term is measured in blocks at 144 a day regardless of network**, so a 360-day line on signet reaches its repayment deadline about 38 real days after opening and its exit block about 40. Every countdown comes from `exitBlock`, the delinquency buffer (`getRepaymentDeadline`: deadline = `exitBlock − delinquentBufferBlocks`, currently 1,008) and a **measured** block rate (esplora timestamps over the last 1,000 blocks), never from a day count or the SDK's fixed `BLOCK_MINUTES` (1 min signet, 10 min mainnet; measured 64 s and 566 s). **(verified)**
3. **Deposits and syncs act after `expected_confirmations` (3)**; read it, do not hardcode it. Mint, add-collateral sync, withdrawal finalization and renewal confirmation each take 4 to 9 minutes on signet. **(verified)**
4. **The testnet dashboard lags about 20 minutes and omits zero-collateral vaults**; its Healthy chip ignores expiry. Match its numbers, not its chip, and never wait on it mid-flow. **(verified)**
5. **Signet has three markets, not the two the dashboard filter shows**: 0 variable (2% APR, 80% max LTV), 10 fixed (9.9%, 50%), 11 fixed (9.9%, 89.99% max LTV against a 90% liquidation threshold). Mainnet: 0 variable (11.9%, 50%), 1 fixed (9.9%, 50%), 2 fixed (9.9%, 89.99%); liquidity is pooled across markets. The signet oracle is a fixed $190,000. **(verified)**

**Keys, vaults and identities**

6. **A credit line is bound to a (BTC key, EVM address) pair.** The vault is derived from the BTC x-only pubkey, the EVM address and nonce 0; the relayer profile is keyed on the BTC pubkey; the JWT is per EVM address; USDC is disbursed to that EVM address. Present one pair per line and rediscover it from the seed: document the paths (BIP-86 `m/86'/1'/N'/0/0` on signet and `m/86'/0'/N'/0/0` on mainnet, BIP-44 `m/44'/60'/N'/0/0`, with N the product's account index or a dedicated Surge index). `IDENTITY_CONFLICT` means a key is already bound to another identity and no client action clears it (contract-tested, not provoked live).
7. **One line per pair, for life.** After a full repay and a `sendAll` sweep, `getPosition` still reports `isActive: true` with zero collateral and zero debt, and `createDeposit` for the same pair is refused with `LOAN_ALREADY_ACTIVE`. The README's "closed, open a new line" path cannot be reached by any user action; only Surge can close a line. **(verified)** Borrowing again therefore goes through the existing line, not a new deposit: once the sweep's withdrawal has finalized, send BTC to the same vault and `addCollateral` (or `borrowMoreSync`, which adds and draws in one step). The SDK's guards allow both on an active position whatever its balance; they refuse every action only once `isActive` is false (the `POSITION_CLOSED` / `POSITION_EXPIRED` branch). This re-fund path follows from the shipped code but was not exercised live: test it on the swept identity before relying on it and record the outcome. A **fresh pair** (a fresh account index, since the nonce is fixed at 0) is needed only for a second, separate line. Decide and document this before the Open screen exists (done criterion 4).
8. **`VAULT_ADDRESS_MISMATCH` cannot catch a wrong key.** Relayer and SDK both derive from the pubkey you send, so a key from the wrong path yields a wrong vault that both agree on. The guard is procedural: derive from a path you own and document, assert the address prefix matches the network, show the derived vault on the Diagnostics screen, and cap the first line at the $5 minimum until it has minted (§6.9). (Aug 2026, mechanism unchanged)
9. **Script-path signing, with the untweaked key.** `signPsbt` receives the PSBT and `inputs: { index, tapLeafScriptHex }[]`. For each input: compute the tapleaf hash (leaf version `0xc0`), the BIP-341 sighash with `SIGHASH_DEFAULT` and that leaf hash, Schnorr-sign it with the **untweaked** BIP-86 private key, and add `tapScriptSig: [{ pubkey: xOnly, signature, leafHash }]`. Return the PSBT base64 unfinalized; the SDK adds Surge's co-signature and finalizes. A signature with the tweaked (key-path) key is accepted by no one and fails silently later; this was the Unisat < 1.6.3 bug. The SDK's `examples/playground/signers/mnemonic.ts` shows it in about forty lines. **(verified)**
10. **Signers never assert the chain.** `signMessage` and `signTypedData` sign for any chain. Make wrong-network signing unrepresentable: the `EvmSigner` instance exists only for the SDK network's `chainId`, and every EIP-712 domain comes from the SDK, never from UI state. (Aug 2026)
11. **Hardware wallets are out of scope for the Bitcoin leg.** Ledger, Trezor, Coldcard, BitBox02 and Jade cannot register the vault leaf (its `<vaultId> OP_DROP` prefix is not miniscript); only Keystone 3 Pro and Krux were shown to sign it. Ledger can be the EVM signer. Do not promise hardware support. (Aug 2026)

**Sessions**

12. **The relayer pays gas; users need no ETH on either chain.** Every EVM action is a signature the relayer submits; `RELAYER_OUT_OF_GAS` is Surge's problem and the user's signature is not consumed. A test identity held zero ETH through a whole lifecycle. **(verified)**
13. **SIWE origin allowlist.** Supabase validates the URI inside the SIWE message against Surge's per-project allowlist; `http://localhost:3000` is allowed, other origins fail with "message was signed for another app". In a browser the SDK signs `window.location.href` (sign the origin instead, so every page mints the same URI); outside a browser it defaults to the gateway URL, which is never allowed, so native products and headless scripts must pass `siwe: { url: SIWE_ORIGIN }`. Get the product's origin allowlisted before the first live sign-in from it; until then test from `http://localhost:3000`. (localhost acceptance **verified**; the rejection text is from Aug 2026)
14. **One session per user.** A second sign-in for the same EVM address revokes the first client's session within minutes, while the relayer keeps accepting the first JWT until it expires (it validates by JWKS, not session state). Expect `restoreSession` to return `null` after the user signs in elsewhere; offer sign-in on the current screen without losing it. **(verified)**
15. **`restoreSession` is per wallet.** A JWT minted for another EVM address is never reused; an account switch drops the session and reruns boot. (Aug 2026)

**Position model**

16. **`isActive` flips on nothing you can observe.** It stays `true` after a settled full liquidation (mainnet #185–#204: `liquidated: true`, zero collateral, zero debt), after the deadline (signet #1361 overdue with debt), and after a sweep (§4.7). Derive the end state yourself: `inLiquidation` → liquidating; `getLiquidation().liquidated` → liquidated (type, time); `!isActive` with collateral → expired; `!isActive` without → closed; else live. Gate every action on that derivation, with `inLiquidation` first. **(verified)**
17. **`getLiquidation().type` is populated during an in-progress liquidation** (`liquidated: false, at: null, type: "full_liquidation"` on signet #1), and a liquidation can stay in progress indefinitely. **(verified)**
18. **Live LTV above a market's max LTV is normal.** Max LTV gates new borrowing; liquidation is at `liquidationThresholdBps` (90% on every market seen). Never render `ltvPercent > maxLtvBps/100` as an error. The dashboard flags 78.8% as Warning and 66.4% as Healthy on a 90% threshold; Warning from 80% of the threshold fits every row seen. Hard-warn on any market whose max LTV sits within a point of the threshold (signet 11, mainnet 2). **(verified)**
19. **Legacy mainnet positions have `marketId: null`**, forcing `maxLtvBps` and `maxBorrowUsd` to 0 while active with collateral and debt (#1, #2, #55, #56; #55 and #56 share one vault). That needs a real empty state. **(verified)**
20. **Never format `healthFactorRaw`, `collateralValueUsd` or `debtValueUsd` as calibrated figures**: `healthFactorRaw` is `MAX_UINT256` on zero debt, `collateralValueUsd` has 4 decimals on signet and up to 16 on mainnet. Use `ltvPercent`. **(verified)**
21. **Exact-amount repays leave dust debt** (`$0.00005` on several signet positions). "Repay in full" must overpay a margin; the contract caps to live debt and the excess stays in the wallet. 50 bps plus $0.01 covered hours of accrual at every live APR. **(verified)**
22. **`maxBorrowUsd` is the absolute ceiling.** Drawing all of it lands exactly on max LTV. Present an "available" figure with a margin (150 bps mirrors the SDK's own buffer) and compare USD strings as scaled integers (6 decimals), never through `Number()`. (Aug 2026)

**Deposits**

23. **An underfunded deposit is marked `failed` by the relayer after the confirmations**, with `failure_reason: "Deposit is short by N sats: … Send N more sats to <vault>, or request a smaller loan amount."`. The SDK's `DepositStatus` type omits `failure_reason` (and `loan_status`, `market_id`, `exit_block`), so read the raw record to show the one line the user needs. **(verified)**
24. **Topping up a failed deposit's address does nothing.** The README is right that a failed deposit is no longer watched; the relayer's own reason text sends users to a dead end, and the sats land in the vault outside any deposit. **(verified)**
25. **A fresh `createDeposit` on a vault that already holds coins mints at once**, counting every confirmed UTXO already there, surplus included, as collateral (a position minted from 7,905 sats against a 5,342-sat request). So the rescue for an underfunded deposit is a new deposit, any surplus becomes collateral, and multi-UTXO funding is accepted. The deposit screen must show the vault's current balance before quoting what to send. **(verified)**
26. **Acting before the confirmations surfaces as `GATEWAY_ERROR`**, not `VAULT_NOT_CONFIRMED` (§3.10). (Aug 2026, consistent with the code)
27. **Deposit expiry and collateral-sync timeout windows are undocumented.** Ask Surge for them (§10); until then they are covered by contract tests only.

**Draw and repay**

28. **A $5 opening line leaves no room to draw.** On the 80% market it leaves $0.08 of headroom and a 3,000-sat top-up only $4.64, both under the $5 minimum draw. A "draw within headroom" needs collateral sized for at least $5 of extra debt first; route to `borrowMoreSync` with the exact top-up from `getRequiredCollateral({ positionId })` and say why. **(verified)**
29. **The $5 floor lives in `createDeposit` and `borrowMore`, not in reads**: `getRequiredCollateral("4.99")` answers. **(verified)**
30. **USDC's EIP-712 domain name differs by chain** (`"USDC"` on Base Sepolia, `"USD Coin"` on Base). 0.1.13 signs `ReceiveWithAuthorization` (0.1.8 signed `TransferWithAuthorization` and every repay reverted). Keep the regression: wrap the `EvmSigner`, record every typed-data payload, assert the primaryType and domain per chain, and compare the computed domain separator with the token's on-chain `DOMAIN_SEPARATOR()`. **(verified, both chains)**
31. **`switchMarket` only at zero debt**; with debt the relayer rejects it and the UI never offers it. (zero-debt switch **verified**; the with-debt rejection is the README's statement)
32. **`sendAll: true` is honoured** (0.1.8 needed `amountSats` too). **(verified)**

**Withdraw**

33. **`getVaultBalance` and `getWithdrawable` count unconfirmed UTXOs that `withdraw` cannot spend** (`fetchUtxos` versus `fetchConfirmedUtxos`), so "available to withdraw" can exceed what a withdrawal can build right after a deposit. Read the vault's UTXOs yourself, show the unconfirmed part, and cap the withdrawable figure at confirmed coins. **(verified)**
34. **Withdrawals have an undocumented $5 minimum** (`MIN_WITHDRAW_USD`, thrown as `AMOUNT_BELOW_MINIMUM` at the oracle price) on top of the dust clamp. **(verified)**
35. **Pending is not stuck.** `getPendingWithdrawal().pending` is true for the whole healthy life of a withdrawal. Stuck means pending with no `btcTxHash` in `getWithdrawStatus()` (or a failed status). Same for extensions: `status: "pending"` with `btcTxHash: null` will not self-heal and needs `resumeExtension`. `resumeWithdrawal` needs `toBtcAddress` again, so persist the destination per position. **(verified)**
36. **A rejected Bitcoin prompt after the EVM authorization leaves an on-chain-authorized withdrawal** that blocks draws and renewals until resumed or expired. Calling `withdraw` again resumes that authorization with the original signer and executes it, which is how a retry produced a second 3,000-sat withdrawal on signet. Treat the rejection as a state: show it, offer Resume, never retry. The same holds for rejecting the final envelope. **(verified)**
37. **After a withdrawal, `getPosition().collateralSats` and `maxBorrowUsd` stay stale until the withdrawal has 3 confirmations**, `syncCollateral` fails with an opaque `GATEWAY_ERROR`, and draws are refused with `WITHDRAWAL_ALREADY_PENDING`. Size and display from the vault balance, treat a sync failure on load as non-fatal, and explain the window. (Aug 2026, consistent with the runs)
38. **`reconcileWithdrawal` costs one EIP-191 signature** (its route is envelope-protected); the README calls it a notification. **(verified)**
39. **Fee estimates on signet are a silent fallback.** Surge's esplora returns `{}` from `/fee-estimates` and the SDK returns 2/2/1 sat/vB with no flag; detect it from the raw response and label it. Mainnet (mempool.space) returns fractional tiers. **(verified)** The relayer also enforces a 5× half-hour fee ceiling after the EVM authorization, which leaves the withdrawal pending for `resumeWithdrawal` at an acceptable rate. (Aug 2026)
40. **`EXTENSION_ALREADY_PENDING` blocks draws and withdrawals too**, for a few blocks after the refresh confirms as well; wait for the gate to reopen before a sweep. **(verified)**

**Renewal**

41. **Renewal needs a Bitcoin signature, pays a miner fee and waits for confirmations.** The README's Signers section and the docs site still say the withdraw PSBT is the only Bitcoin signature; the README's own flows table and `refreshBtc` in the code disagree. The signature mix is EIP-712 + Schnorr + one EIP-191 per vault input (§3.9). **(verified)**
42. **A renewal resets `exitBlock` to the current tip + 52,416**, it does not add a term to the old exit block. Renewing early gains only the blocks elapsed since the last reset. **(verified)**
43. **`/sign-refresh` answers 400 for about 10 s after the extension request** while the relayer indexes the EVM transaction; the SDK's retries covered it. A longer delay would surface as a failed renewal with the EVM leg pending; `resumeExtension` is the way out. **(verified)**
44. **The expired-line cases are reachable on signet only about 38 days after opening.** Open a parked position with a dedicated pair on day one (§8.2); until then they are contract tests plus live reads on existing expired positions (signet #34 is `isActive: false` with collateral).

**Collateral sync**

45. **`syncCollateral` is not idempotent on the relayer side.** Every call creates a new sync record (`watching`, then `success` within seconds when nothing is pending). An app that reconciles on every load and watches the result sees an in-flight sync on the next load; watch it and reclassify on settle and you get a reboot loop that unmounts screens. Rule: a sync record whose `confirmedSats` equals `onchainSats` is not watched; a settled sync only refreshes the position. Skip the load-time sync while a withdrawal or extension is pending. **(verified)**

**Endpoints**

46. **Public RPCs fail on the first screen.** `getMarkets` fans out to 1 + 4 × markets `eth_call`s and `getPosition` to five more per refresh; `https://sepolia.base.org` returned dozens of 429s per page load, `https://base-sepolia-rpc.publicnode.com` none. Endpoints must be configurable per network, with retry and backoff on `RATE_LIMITED` / `NETWORK_ERROR`, and the mainnet build refuses to start without operator endpoints: a throttled RPC fails the pre-signature guards and would let a user sign for an action the SDK could not check. Applying an endpoint override is a network switch: tear everything down the same way. Never poll `watch*` below the defaults. **(verified)**

**Tooling that bit**

47. **Test-runner function bridges drop custom error properties** (Playwright's `exposeFunction` strips `code: 4001`), so the rejection normaliser must also match the message text. **(verified)**
48. **React Strict Mode constructs the controller twice**; building the SDK client eagerly then produced two Supabase clients and a "Multiple GoTrueClient instances" warning. Build the client lazily on first use. **(verified)**
49. **jsdom cannot run bitcoinjs's secp256k1 binding** ("ecc library invalid"); make vault derivation injectable for component tests. **(verified)**
50. **A prompt-progress wrapper applied through `Function.prototype.call` does nothing**: the SDK's session methods are closures over their own context. Wrap the signers once at connection time instead. **(verified)**
51. **Page scripts serialized from a tsx-run process carry esbuild's `__name` helper**, which does not exist in the page; define `globalThis.__name = (f) => f` in an init script before them. Playwright's own loader does not inject it. **(verified)**
52. **If the product uses Reown AppKit for anything, AppKit 1.8.24 requires wagmi 3** (`@wagmi/connectors` imports `@wagmi/core/tempo`). A product with its own keys needs neither. **(verified)**

## Appendix A. If the product delegates Bitcoin signing to an external wallet

Applies only when §0 KEY_CUSTODY is (b). In Aug 2026 only Unisat produced the script-path Schnorr signature the vault needs; Xverse, Leather, Phantom and Magic Eden modelled `signPsbt` as key-path signing and failed. The README now lists Xverse and Leather as taproot options; treat that as unverified and offer a wallet only after a real signet withdrawal succeeds with it. Unisat preconditions, each checked at connect and before every Bitcoin signature: address type P2TR (otherwise `getPublicKey()` returns the wrong key), chain `BITCOIN_SIGNET` on signet, custom HD path `m/86'/1'/0'/0/0` on signet (Unisat derives at coin type `0'` even on signet and nothing can catch it, §4.8: ask the user to confirm the derived vault address, remembered per address), version >= 1.6.3 (older versions sign with the tweaked key), rebuild the signer on `accountsChanged`, `toSignInputs[].address` must equal the active account. For the EVM leg any EIP-1193 wallet works with the chain gate of §4.10 (`wallet_switchEthereumChain`, `wallet_addEthereumChain` on 4902); WalletConnect needs a Reown project ID and AppKit (§4.52) and is optional. The use cases gain: each Unisat precondition failing separately with a specific blocking message; wallet missing, locked or connection rejected; and a manual pass with the real extensions on signet, recording what each prompt shows and that rejecting it leaves the state the app says it does.
