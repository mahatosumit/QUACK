import { type BenchmarkScenario } from "./types.js";

export const benchmarkScenarios: readonly BenchmarkScenario[] = [
  {
    id: "file-creation-mission",
    name: "File creation mission",
    missionInput: {
      missionId: "scenario-file-create",
      goal: "create a workspace file with specified content",
      actor: "benchmark",
    },
    expectedTools: ["core.workspace.write-file"],
    expectedCapabilities: ["permission.workspace.write"],
    expectedOutcome: "success",
    tags: ["workspace", "write", "happy-path"],
  },
  {
    id: "coding-mission",
    name: "Coding mission",
    missionInput: {
      missionId: "scenario-coding",
      goal: "inspect the repository and make a focused TypeScript change",
      actor: "benchmark",
    },
    expectedTools: ["core.workspace.code-search", "core.workspace.read-file", "core.workspace.write-file"],
    expectedCapabilities: ["permission.workspace.read", "permission.workspace.write"],
    expectedOutcome: "success",
    tags: ["coding", "repository", "tool-chain"],
  },
  {
    id: "failed-tool-recovery",
    name: "Failed tool recovery",
    missionInput: {
      missionId: "scenario-recovery",
      goal: "recover from a transient workspace tool failure",
      actor: "benchmark",
    },
    expectedTools: ["core.workspace.list-files"],
    expectedCapabilities: ["permission.workspace.read"],
    expectedOutcome: "success",
    tags: ["recovery", "tool-failure"],
  },
  {
    id: "denied-capability-request",
    name: "Denied capability request",
    missionInput: {
      missionId: "scenario-denied-capability",
      goal: "attempt a workspace action without a grant",
      actor: "benchmark",
    },
    expectedTools: ["core.workspace.read-file"],
    expectedCapabilities: ["permission.workspace.read"],
    expectedOutcome: "failure",
    tags: ["security", "capability-denied"],
  },
];
