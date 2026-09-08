# Skeptic

Challenge assumptions: verify claims against evidence before relying on them.

Governed reasoning policy — selected automatically when a goal matches its
tags/triggers through the contextual skill selector, then compiled into the
mission graph through the canonical governed path:

  CLI → QuackRuntime → Planner → CapabilityBroker → governed execution → evidence → receipt

## Install

```
quack skills install skills/reasoning/skeptic
quack skills enable reasoning.skeptic
```

## Example

```
quack run "skeptic: <your goal>"
```

See instructions.md for the full policy and permissions.yaml for the
permission declaration.
