---
type: llm
focus: trace
weight: 1
---

docs/prompt-plan.md states that rejecting the Bitcoin signature or a co-sign envelope after the EIP-712 leaves the withdrawal or renewal pending on chain and only the resume flow completes it, that calling withdraw again while one is pending resumes it, and that rejecting the final post-broadcast envelope of a withdrawal leaves a broadcast transaction the relayer has not recorded, which reconcileWithdrawal fixes
