---
type: llm
focus: trace
weight: 1
---

docs/prompt-plan.md lists the withdrawal signatures in order as one EIP-712 WithdrawCollateral, one Schnorr PSBT signature covering every vault input in a single signPsbt call, then one EIP-191 envelope per vault input, then one more EIP-191 envelope that hands the broadcast txid to Surge (3 + N signatures for N inputs, 4 for a single-UTXO vault)
