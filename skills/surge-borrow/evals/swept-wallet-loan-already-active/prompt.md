---
tags: [surge-borrow]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Our Surge integration is on signet. A tester repaid in full, swept the whole vault with sendAll, and now createDeposit for the same wallet throws LOAN_ALREADY_ACTIVE and getPosition still says isActive: true. Is this a relayer bug we should retry around? What should the app do so the user can borrow again? Write the answer into docs/second-line.md.
