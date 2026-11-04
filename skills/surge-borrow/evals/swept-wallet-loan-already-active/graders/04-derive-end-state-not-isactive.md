---
type: llm
focus: trace
weight: 1
---

docs/second-line.md tells the app to derive the position's end state from inLiquidation, getLiquidation and the collateral and debt figures rather than from isActive, noting that isActive stays true after a settled liquidation, after the deadline and after a sweep
