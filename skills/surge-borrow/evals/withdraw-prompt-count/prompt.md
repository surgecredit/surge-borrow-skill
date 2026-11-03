---
tags: [surge-borrow]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

hey, we're wiring @surgecredit/borrow-sdk 0.1.13 into our mobile wallet (React Native, we hold the keys). Product wants the exact wallet prompt sequence for a collateral withdrawal and for renewing the term so the confirmation sheets can say "1 of N". The SDK readme says 1 EVM + 1 BTC for both. Can you confirm and write it up in docs/prompt-plan.md with what each signature is?
