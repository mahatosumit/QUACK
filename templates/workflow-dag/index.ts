import { type TaskGraph, type TaskNode } from "@quack/os";

// Step 1: Define individual task nodes
const readDataTask: TaskNode = {
  id: "read-data",
  dependencies: [], // Runs immediately
  timeoutMs: 5000,
  requiredTools: ["fs.readFile"],
  retryPolicy: { maxRetries: 3, backoffMs: 1000 }
};

const processDataTask: TaskNode = {
  id: "process-data",
  dependencies: ["read-data"], // Waits for read-data to finish
  timeoutMs: 15000,
  requiredTools: ["llm.summarize"],
  retryPolicy: { maxRetries: 1, backoffMs: 2000 }
};

// Step 2: Combine into a directed acyclic graph (DAG)
export const customWorkflow: TaskGraph = {
  id: "data-processing-workflow",
  nodes: [readDataTask, processDataTask]
};
