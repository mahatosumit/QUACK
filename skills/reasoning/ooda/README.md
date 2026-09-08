# OODA

Observe → Orient → Decide → Act loop for decisions under uncertainty.

Governed reasoning policy — selected automatically when a goal matches its
tags/triggers through the contextual skill selector, then compiled into the
mission graph through the canonical governed path:

  CLI → QuackRuntime → Planner → CapabilityBroker → governed execution → evidence → receipt

## Install

```
quack skills install skills/reasoning/ooda
quack skills enable reasoning.ooda
```

## Example

```
quack run "ooda: <your goal>"
```

See instructions.md for the full policy and permissions.yaml for the
permission declaration.
