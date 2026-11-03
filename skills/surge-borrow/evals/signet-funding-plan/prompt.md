---
tags: [surge-borrow]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We're about to run the first live test of our Surge.Credit borrowing feature on their signet. The team lead wants a one-page plan in docs/SIGNET-PLAN.md: where test BTC and USDC come from, how much to ask for for two full lifecycles plus a position we leave untouched, how the test wallet and identities are organised, and how long each on-chain step takes so we size timeouts. We don't want browser wallet extensions involved.
