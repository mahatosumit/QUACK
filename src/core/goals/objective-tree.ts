import { type GoalDefinition, type GoalMilestone } from "../../cos/types.js";

/** Status of an objective node in the decomposition tree. */
export type ObjectiveNodeStatus = "pending" | "active" | "blocked" | "completed" | "failed" | "skipped";

/** A node in the objective decomposition tree: Vision -> Goals -> Projects -> Tasks -> Actions. */
export interface ObjectiveNode {
  readonly id: string;
  readonly level: "vision" | "goal" | "project" | "task" | "action";
  label: string;
  description: string;
  status: ObjectiveNodeStatus;
  parentId?: string;
  children: string[];
  goalId?: string;
  milestoneId?: string;
  estimatedHours?: number;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * ObjectiveTree — decomposes long-term vision into executable objectives per
 * quackos.md §6: Vision -> Goals -> Projects -> Tasks -> Actions. Works as a
 * view layer over the existing GoalManager; never replaces it.
 */
export class ObjectiveTree {
  private nodes = new Map<string, ObjectiveNode>();
  private rootId?: string;

  setVision(label: string, description = ""): ObjectiveNode {
    const id = `vision_${Date.now().toString(36)}`;
    const node: ObjectiveNode = {
      id, level: "vision", label, description,
      status: "active", children: [], progress: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    this.nodes.set(id, node);
    this.rootId = id;
    return node;
  }

  addChild(parentId: string, level: ObjectiveNode["level"], label: string, description = "", extra?: Partial<ObjectiveNode>): ObjectiveNode | undefined {
    const parent = this.nodes.get(parentId);
    if (!parent) return undefined;
    const id = `${level}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const node: ObjectiveNode = {
      id, level, label, description,
      status: "pending", parentId, children: [], progress: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      ...extra,
    };
    this.nodes.set(id, node);
    parent.children.push(id);
    parent.updatedAt = new Date().toISOString();
    return node;
  }

  /** Decompose a GoalManager goal into goal -> project -> task -> action nodes. */
  decomposeGoal(goal: GoalDefinition, parentId: string): ObjectiveNode {
    const goalNode = this.addChild(parentId, "goal", goal.mission, goal.objectives.join("; "), {
      goalId: goal.id,
      estimatedHours: goal.estimatedEffortHours,
      progress: goal.progress,
      status: goal.status === "active" ? "active" : "pending",
    })!;
    for (const objective of goal.objectives) {
      const projectNode = this.addChild(goalNode.id, "project", objective);
      if (projectNode) this.addChild(projectNode.id, "task", `Implement: ${objective}`);
    }
    for (const ms of goal.milestones) {
      this.linkMilestone(goalNode.id, ms);
    }
    return goalNode;
  }

  linkMilestone(goalNodeId: string, milestone: GoalMilestone): ObjectiveNode | undefined {
    return this.addChild(goalNodeId, "task", milestone.description, undefined, {
      milestoneId: milestone.id,
      status: milestone.status === "completed" ? "completed" : "pending",
      estimatedHours: milestone.dueBy ? undefined : undefined,
    });
  }

  get(id: string): ObjectiveNode | undefined {
    return this.nodes.get(id);
  }

  getChildren(id: string): ObjectiveNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return node.children.map((c) => this.nodes.get(c)).filter((n): n is ObjectiveNode => !!n);
  }

  getPath(id: string): ObjectiveNode[] {
    const path: ObjectiveNode[] = [];
    let cur = this.nodes.get(id);
    while (cur) {
      path.unshift(cur);
      cur = cur.parentId ? this.nodes.get(cur.parentId) : undefined;
    }
    return path;
  }

  setStatus(id: string, status: ObjectiveNodeStatus): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    node.status = status;
    node.updatedAt = new Date().toISOString();
    this.recalculateProgress(node);
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) this.recalculateProgress(parent);
    }
    return true;
  }

  updateProgress(id: string, progress: number): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;
    node.progress = Math.max(0, Math.min(100, progress));
    node.updatedAt = new Date().toISOString();
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) this.recalculateProgress(parent);
    }
    return true;
  }

  getRoot(): ObjectiveNode | undefined {
    return this.rootId ? this.nodes.get(this.rootId) : undefined;
  }

  getAll(): readonly ObjectiveNode[] {
    return [...this.nodes.values()];
  }

  find(label: string): ObjectiveNode[] {
    const lower = label.toLowerCase();
    return this.getAll().filter((n) => n.label.toLowerCase().includes(lower));
  }

  private recalculateProgress(node: ObjectiveNode): void {
    if (node.children.length === 0) return;
    const children = node.children.map((c) => this.nodes.get(c)).filter((n): n is ObjectiveNode => !!n);
    const completed = children.filter((c) => c.status === "completed").length;
    node.progress = Math.round((completed / children.length) * 100);
    if (node.progress === 100) node.status = "completed";
    else if (children.some((c) => c.status === "active")) node.status = "active";
  }

  clear(): void {
    this.nodes.clear();
    this.rootId = undefined;
  }
}
