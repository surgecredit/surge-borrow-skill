---
type: llm
focus: trace
weight: 1
---

docs/prompt-plan.md says what each signature is over: the EIP-712 domain and primary type, that the PSBT spends the vault's confirmed UTXOs via the repayment tapleaf, and that the envelopes are EIP-191 messages authenticating a relayer request (naming the action, such as request_btc_withdrawal_signature) rather than moving funds
