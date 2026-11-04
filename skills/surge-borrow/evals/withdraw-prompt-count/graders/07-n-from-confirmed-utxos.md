---
type: llm
focus: trace
weight: 1
---

docs/prompt-plan.md says N must be taken from the vault's confirmed UTXOs (for example an esplora query filtered on confirmed), not from getWithdrawable().utxoCount, which counts unconfirmed coins the flows cannot spend
