<!-- Carved from the executed brief (docs/BRIEF-v3.md in the reference repo). Section numbers are kept so cross-references such as §4.7 stay valid across the reference files. -->

## 7. Use cases to test

Seed the test matrix from this list and add every case you discover. Where a row cannot be provoked on signet it is covered by a contract test against recorded relayer responses and, where mainnet has real examples, by a live-read test. Rows marked † need an app restart mid-flow or a position with a particular debt level; plan them into the funded run (§1.13).

**A. Network, accounts, signers**

- A1 Switch network, or apply an endpoint override: all state torn down; refused while a flow is in flight.
- A2 EVM signer absent for any chain but the SDK network's; wrong-chain signing unrepresentable.
- A3 Signer conformance: vault address and signatures from the harness seed verify; live withdrawal and renewal signed by the product's own code.
- A4 Key store locked, account missing, biometric or confirmation declined: specific states, no crash.
- A5 Account change rebuilds signers and session; a JWT for another address is not reused.
- A6 Sign out clears the session and storage.
- A7 Line rediscovery from the seed alone: existing lines found per pair, bounded scan, no prompt.

**B. Session and identity**

- B1 First login prompts once (SIWE) and persists the JWT in the product's store.
- B2 Restart restores the session with no prompt.
- B3 Expired or revoked JWT → `SESSION_UNAUTHENTICATED` → sign in on the current screen without losing it.
- B4 New user: `userExists` false → `registerUser`; returning user skips it.
- B5 `IDENTITY_CONFLICT` → terminal explanation, no retry loop.
- B6 SIWE origin not allowlisted → clear message naming the origin.
- B7 Session revoked by a second sign-in elsewhere (§4.14) → B3 path.

**C. Wallet-free browsing**

- C1 Markets with kind, APR, max LTV, liquidation threshold, available liquidity, active flag; unfundable markets shown as such; the 89.99% markets hard-warned.
- C2 Borrow quote per market.
- C3 Oracle BTC price with the time of last read (fixed $190,000 on signet).
- C4 Required-collateral calculator for a new line and for a top-up (`positionId` given; `requiredSats: 0n` means draw without adding), net of coins already in the vault.
- C5 Fee tiers, with the signet fallback labelled.
- C6 `RATE_LIMITED` / `NETWORK_ERROR` → backoff, then a prompt to configure endpoints.

**D. Open a credit line**

- D1 Vault address derived locally equals `deriveVaultAddress` and the relayer's `vaultAddress`; a mismatch blocks funding.
- D2 Happy path, variable market, minimum borrow: `createDeposit` → address and QR → fund → `watchDeposit` through pending and confirming → `nft_id` → position readable → USDC balance up by the borrow.
- D3 Same on the fixed market.
- D4 Under $5 → `AMOUNT_BELOW_MINIMUM` before any prompt; malformed amounts → `INVALID_PARAMS`.
- D5 † Restart while a deposit is pending → `getActiveDeposit` → same address, watcher resumed; `createDeposit` again returns `resumed: true`.
- D6 † Second deposit while one is pending → `DEPOSIT_ALREADY_ACTIVE` → resume path.
- D7 Pair already has a line → `LOAN_ALREADY_ACTIVE` → routed to the position; after a sweep, the §4.7 explanation and the new-pair path.
- D8 Deposit expired or failed → old address hidden; `failure_reason` shown; fresh deposit offered.
- D9 Underfunded deposit → `failed` with the shortfall reason, represented in the UI.
- D10 Fresh deposit on a vault already holding coins → mints without a new send, surplus credited; the Open screen quoted the net amount.
- D11 Funding from several UTXOs; from a non-taproot source address.
- D12 First-line cap at the minimum until minted.
- D13 Rejecting the SIWE or envelope signature leaves clean state and a retry.
- D14 Term shown as 360 days derived from `exitBlock`; no term picker.

**E. Position and reads**

- E1 Collateral from the vault with confirmed and unconfirmed split and the contract figure beside it; debt breakdown; LTV; max LTV; available to draw with margin; health chip matches the dashboard's numbers.
- E2 Expiry: exit block, delinquency buffer, deadline block, blocks left, date from the measured rate; `overdue` and `pastExitBlock` (signet #1361, #1987).
- E3 Legacy position (`marketId: null`) empty state (mainnet #1, #55, #56).
- E4 Liquidation states read-only: `inLiquidation` (signet #1), `liquidated` with `full_liquidation` (signet #2018, mainnet #185–#204); `delinquency` type if one is found.
- E5 Activities feed: spinner on `isFlowTerminal`, tone on `classifyStatus`; auto-stop.
- E6 Post-action lag: refresh at 3 s and 9 s; never "nothing happened".
- E7 Withdrawable with `limitedBy` = `ltv`, `vault-balance`, `none`, each rendered; capped at confirmed coins.
- E8 Stale-collateral window after a withdrawal: figures from the vault, non-fatal sync failure, copy explaining the wait.
- E9 Expired-shape read today: signet #34 (`isActive: false` with collateral).
- E10 §4.20 figures never rendered as calibrated.

**F. Add collateral**

- F1 Send BTC → `addCollateral` → watching → waiting_confirmations → success; `maxBorrowUsd` rises.
- F2 Unconfirmed BTC shown as pending.
- F3 BTC never arrives → timeout; restart; nothing lost (window undocumented, contract only until Surge states it).
- F4 Load-time `syncCollateral` reconciles drift without a reboot loop; a no-op record is not watched (§4.45).
- F5 † Restart mid-sync → `getCollateralSyncStatus` → watcher resumed.

**G. Borrow more**

- G1 Within `maxBorrowUsd` → `borrowMore` → USDC increases (after a top-up sized for ≥ $5 of headroom, §4.28).
- G2 Above it → `LTV_EXCEEDED` before any prompt → `borrowMoreSync` with the exact top-up from `getRequiredCollateral({ positionId })`; terminal on `submitted` / `confirmed`.
- G3 Above `availableLiquidityUsd` → `INSUFFICIENT_MARKET_LIQUIDITY`.
- G4 Amount validation: more than 6 decimals rejected; boundary comparison as scaled integers.
- G5 Blocked states hide the button: `EXTENSION_ALREADY_PENDING`, `WITHDRAWAL_ALREADY_PENDING`, expired, liquidating; the throw is still handled if it fires.
- G6 Rejected signature leaves no state change.
- G7 † Restart mid `borrowMoreSync` → `getBorrowMoreSyncStatus` → resumed.

**H. Repay**

- H1 Partial repay: two signatures announced; debt falls; interest and principal split updates.
- H2 Full repay with margin: zero debt; excess stays; copy explains; position stays active.
- H3 `INSUFFICIENT_USDC_BALANCE` → top-up guidance with the exact shortfall.
- H4 Repay allowed while a withdrawal is pending.
- H5 Repay on an expired line → `POSITION_EXPIRED` (contract until the parked position expires).
- H6 Reject at signature 1 and at 2 → nothing submitted; slow signing → `SIGN_REQUEST_EXPIRED` → retry re-signs.
- H7 Typed-data regression per §4.30, both chains.

**I. Switch market**

- I1 Zero debt → `switchMarket` → confirmed → `borrowMore` on the new market.
- I2 With debt → rejected; never offered.

**J. Withdraw**

- J1 Partial withdraw to an external address at a chosen fee tier; change returns to the vault; `finalized`; coins arrive; collateral falls after 3 confirmations.
- J2 Full sweep (`sendAll`); vault empty; position still active and bound (§4.7); new deposit refused.
- J3 † Limited by LTV while debt is outstanding; above headroom refused.
- J4 † Dust clamp: `withdrawnSats` differs from the request and the UI says so.
- J5 `INVALID_WITHDRAW_ADDRESS`: empty, malformed, wrong network, own vault.
- J6 `INVALID_FEE_RATE`: zero, negative, over 1,000 sat/vB, units mistake; relayer-side fee ceiling → pending → `resumeWithdrawal`.
- J7 Reject the Bitcoin signature after the EVM authorization → stuck → Resume with the persisted destination → `finalized`; exactly one Bitcoin prompt, no retry.
- J8 † Close the app after broadcast → on load, pending with a `btcTxHash` → watched, not resumed.
- J9 Confirmed BTC tx the relayer never recorded → `reconcileWithdrawal` (one EIP-191 signature announced).
- J10 Withdraw while an extension is pending → `EXTENSION_ALREADY_PENDING`, also for a few blocks after the refresh confirms.
- J11 Unconfirmed vault UTXOs not spendable; withdrawable updates after one confirmation (observable only when debt is low enough for the vault balance, not LTV, to bind).
- J12 Fee estimate unavailable: signet fallback labelled; mainnet throws `NETWORK_ERROR`.
- J13 Draw inside the post-withdraw window → `WITHDRAWAL_ALREADY_PENDING` with copy.
- J14 Below the $5 withdraw minimum → `AMOUNT_BELOW_MINIMUM` before any prompt.

**K. Renew**

- K1 Proactive renewal: three signatures disclosed with the fee; `watchExtension` to `finalized`; `exitBlock` = tip + 52,416 (§4.42).
- K2 Reactive: expired with collateral → only Renew offered; after renewal, Draw returns (parked position, ~38 days).
- K3 `EXTENSION_ALREADY_PENDING` → existing one watched, no second request.
- K4 Reject the Bitcoin signature after the EVM request → `pending`, `btcTxHash: null` → Finish renewal → `finalized`; gate open at zero debt.
- K5 Contract refusal after the EIP-712 signature → explained with repay or add-collateral as the way forward.
- K6 Blocked by a pending withdrawal.
- K7 On a closed line → `POSITION_CLOSED` (contract; unreachable by a user, §4.7).

**L. End states**

- L1 Empty but bound after a sweep: explanation and the new-pair path.
- L2 `inLiquidation` → every action disabled with the auction state.
- L3 `liquidated` with type, time, seized collateral and settled debt.
- L4 Deadline countdown and overdue warning.
- L5 `pastExitBlock` → self-exit guidance (documented; the SDK has no route).

**M. Mainnet**

- M1 Flag off: no mainnet anywhere. Flag on without endpoints: refuses to start.
- M2 Chain 8453 enforced; `bc1p` prefix enforced; `"USD Coin"` domain separator asserted on chain.
- M3 Read-only smoke on the positions in §8.4.
- M4 Real-funds confirmation before every signature, restating amounts, fee and destination.
- M5 Gated paid mini-lifecycle (§8.6), only with the human's written approval.

**N. Cross-cutting**

- N1 All 29 codes plus user rejection mapped; unknown code falls back.
- N2 Every watcher unsubscribed on unmount, navigation, account and network change.
- N3 Buffer polyfill present in the production bundle; vault derivation runs there.
- N4 No secrets in logs or bundle; test signer, harness wallet and `/dev` entry excluded from production builds.
- N5 Accessibility and the product's layout rules.
- N6 Diagnostics shows everything in §6.7.
- N7 Retry and backoff policy on throttling; never on flows.
- N8 Prompt counts announced per flow match the shipped SDK's signature sites (§3.9).
