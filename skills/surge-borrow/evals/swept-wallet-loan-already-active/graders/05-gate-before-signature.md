---
type: llm
focus: trace
weight: 1
---

docs/second-line.md tells the app to gate on getPositionId() (or an equivalent read) before any signature so that LOAN_ALREADY_ACTIVE is never reached in production
