# Production improvement loop

`QuackRuntime.submitGoal` and `AgentLoop.start` both call `ImprovementCoordinator.onMissionCompleted` only after successful completion. The coordinator records eligibility, enforces enabled/auto-evaluate/evidence/cooldown/recursion policies, runs the evidence improvement cycle, and emits proposal events.

## Controlled code-proposal bridge

An `ImprovementReviewItem` is **not** automatically a source-code proposal. The cycle must supply an explicit `codeProposal` candidate with evidence references, a falsifiable hypothesis, a bounded description, and concrete source-file scope. The `ImprovementProposalBridge` rejects all other review items, including vague prose and non-code findings.

For a valid candidate, the production path is:

`verified mission -> ImprovementCoordinator -> EvidenceImprovementCycle -> ImprovementProposalBridge -> CodeImprovementController.queueProposal -> persisted PROPOSED -> proposal.awaiting_approval`

`queueProposal` is persistence-only. It does not invoke tools, read or write source files, create a git worktree, create a patch, execute verification, approve a proposal, or merge a branch. The bridge is capped at one proposal per mission by default and declines improvement-originated work as a second recursion guard.

After an external human records `APPROVE`, `materializeApprovedProposal` enters the pre-existing isolated-worktree path: patch generation -> candidate verification -> fingerprint-bound human review -> merge -> post-merge verification -> revert-based rollback on regression. A pending proposal therefore cannot mutate the base checkout, and approval never occurs automatically.
