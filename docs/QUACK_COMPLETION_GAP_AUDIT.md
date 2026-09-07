# QUACK completion gap audit

- DONE: runtime goal execution, persistence, capability broker, approval policy, isolated self-modification controller, verification and rollback controller.
- PARTIAL: provider routing now supports explicit fallback and local OpenAI-compatible endpoints; production cost accounting remains provider-specific.
- DONE: runtime and agent-loop completion call the same coordinator. Explicit, evidence-backed code candidates now cross the `ImprovementProposalBridge` into persisted `CodeImprovementController` records in `PROPOSED` state, emitting `proposal.awaiting_approval` without a worktree or source mutation.
- DELIBERATELY_CONSERVATIVE: ordinary improvement review items do not infer code changes. A future candidate producer must explicitly populate the bounded `codeProposal` contract; vague or non-code output is skipped.
- MISSING: live Agent-Reach process/MCP integration is intentionally not bundled.
- DEFERRED: vector and temporal-graph storage adapters, durable distributed workflow execution, and full MCP transport exposure.
