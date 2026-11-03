---
type: llm
focus: trace
weight: 1
---

docs/prompt-plan.md lists the renewal (extendCreditLine) as one EIP-712 RequestCreditLineExtension, one Schnorr signature over a vault self-spend that pays a miner fee, then one EIP-191 envelope per vault input (2 + N signatures, 3 for a single-UTXO vault)
