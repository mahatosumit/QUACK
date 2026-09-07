import { createId, now } from "../core/types.js";
import type { ScientificWorkflow, ScientificWorkflowStep } from "./types.js";

export function createScientificWorkflowEngine() {
  const workflows = new Map<string, ScientificWorkflow>();

  const defaultPhases = [
    "question-formulation",
    "literature-review",
    "hypothesis-generation",
    "experiment-design",
    "data-collection",
    "analysis",
    "validation",
    "report-drafting",
    "peer-review",
    "publication",
  ];

  function createWorkflow(question: string): ScientificWorkflow {
    const steps: Record<string, ScientificWorkflowStep> = {};
    for (const phase of defaultPhases) {
      steps[phase] = {
        phase,
        status: "pending",
        output: null,
        startedAt: null,
        completedAt: null,
        provenance: {},
      };
    }

    const workflow: ScientificWorkflow = {
      id: createId("sci"),
      question,
      hypothesis: null,
      steps,
      report: null,
      createdAt: now(),
      completedAt: null,
    };

    workflows.set(workflow.id, workflow);
    steps["question-formulation"] = {
      ...steps["question-formulation"],
      status: "completed",
      output: question,
      startedAt: workflow.createdAt,
      completedAt: workflow.createdAt,
      provenance: { source: "user-question", timestamp: workflow.createdAt },
    };

    return workflow;
  }

  function updateStep(workflowId: string, phase: string, step: ScientificWorkflowStep): void {
    const workflow = workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    workflow.steps[phase] = step;
  }

  function setHypothesis(workflowId: string, hypothesis: string): void {
    const workflow = workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    workflow.hypothesis = hypothesis;
    workflow.steps["hypothesis-generation"] = {
      phase: "hypothesis-generation",
      status: "completed",
      output: hypothesis,
      startedAt: now(),
      completedAt: now(),
      provenance: { source: "scientific-workflow" },
    };
  }

  function setReport(workflowId: string, report: string): void {
    const workflow = workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    workflow.report = report;
    workflow.steps["report-drafting"] = {
      phase: "report-drafting",
      status: "completed",
      output: report,
      startedAt: now(),
      completedAt: now(),
      provenance: { source: "scientific-workflow" },
    };
  }

  function getWorkflow(id: string): ScientificWorkflow | undefined {
    return workflows.get(id);
  }

  function listWorkflows(): ScientificWorkflow[] {
    return Array.from(workflows.values());
  }

  function getProvenance(workflowId: string): Record<string, unknown> {
    const workflow = workflows.get(workflowId);
    if (!workflow) return {};
    const provenance: Record<string, unknown> = {};
    for (const [phase, step] of Object.entries(workflow.steps)) {
      if (step.provenance && Object.keys(step.provenance).length > 0) {
        provenance[phase] = step.provenance;
      }
    }
    return provenance;
  }

  return { createWorkflow, updateStep, setHypothesis, setReport, getWorkflow, listWorkflows, getProvenance };
}
