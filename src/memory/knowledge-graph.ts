/**
 * Knowledge Graph - Core graph data model for QUACK intelligence layer.
 * 
 * Provides:
 * - Node and edge data structures
 * - Graph queries (BFS, shortest path)
 * - Community detection (basic)
 * - Import/export
 */

import { createId, type JsonObject } from "../core/types.js";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

/** Types of nodes in the knowledge graph. */
export type NodeType =
  | "concept"
  | "entity"
  | "document"
  | "code"
  | "task"
  | "agent"
  | "tool"
  | "provider"
  | "file"
  | "folder"
  | "decision"
  | "rationale"
  | "requirement"
  | "custom";

/** Types of edges (relationships) in the knowledge graph. */
export type EdgeType =
  | "contains"
  | "references"
  | "implements"
  | "depends_on"
  | "produces"
  | "uses"
  | "calls"
  | "imports"
  | "extends"
  | "similar_to"
  | "contradicts"
  | "supports"
  | "requires"
  | "rationale_for"
  | "custom";

/** A node in the knowledge graph. */
export interface KnowledgeNode {
  readonly id: string;
  readonly label: string;
  readonly type: NodeType;
  readonly description?: string;
  readonly source?: string; // Where this node came from (file, URL, etc.)
  readonly sourceLocation?: string; // Line/column or specific location
  /** Confidence level for this node's existence. */
  readonly confidence?: "extracted" | "inferred" | "ambiguous";
  readonly confidenceScore?: number; // 0.0 to 1.0
  readonly tags?: readonly string[];
  readonly properties: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An edge (relationship) between two nodes in the knowledge graph. */
export interface KnowledgeEdge {
  readonly id: string;
  readonly sourceId: string; // Node ID
  readonly targetId: string; // Node ID
  readonly relation: EdgeType;
  readonly description?: string;
  readonly weight: number; // 0.0 to 1.0
  readonly confidence?: "extracted" | "inferred" | "ambiguous";
  readonly confidenceScore?: number;
  readonly evidence: readonly string[]; // Supporting evidence
  readonly createdAt: string;
}

/** A hyperedge connecting 3+ nodes in a shared concept. */
export interface KnowledgeHyperedge {
  readonly id: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly relation: string;
  readonly description?: string;
  readonly confidenceScore?: number;
  readonly createdAt: string;
}

/** Query results from the graph. */
export interface GraphQueryResult {
  readonly nodes: readonly KnowledgeNode[];
  readonly edges: readonly KnowledgeEdge[];
  readonly path?: readonly string[]; // Node IDs in path order
}

// ------------------------------------------------------------------
// Store Interface
// ------------------------------------------------------------------

/** Store for knowledge graph persistence. */
export interface KnowledgeGraphStore {
  addNode(node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">): Promise<KnowledgeNode>;
  updateNode(id: string, updates: Partial<KnowledgeNode>): Promise<KnowledgeNode | undefined>;
  removeNode(id: string): Promise<boolean>;
  getNode(id: string): Promise<KnowledgeNode | undefined>;
  searchNodes(options: {
    query?: string;
    type?: NodeType;
    tags?: readonly string[];
    limit?: number;
  }): Promise<KnowledgeNode[]>;

  addEdge(edge: Omit<KnowledgeEdge, "id" | "createdAt">): Promise<KnowledgeEdge>;
  removeEdge(id: string): Promise<boolean>;
  getEdge(id: string): Promise<KnowledgeEdge | undefined>;
  getEdgesForNode(nodeId: string): Promise<{ outgoing: KnowledgeEdge[]; incoming: KnowledgeEdge[] }>;

  addHyperedge(edge: Omit<KnowledgeHyperedge, "id" | "createdAt">): Promise<KnowledgeHyperedge>;
  removeHyperedge(id: string): Promise<boolean>;
  getHyperedgesForNode(nodeId: string): Promise<KnowledgeHyperedge[]>;

  /** Query the graph with BFS up to a given depth. */
  bfs(startNodeId: string, maxDepth: number): Promise<GraphQueryResult>;
  /** Find the shortest path between two nodes. */
  shortestPath(startNodeId: string, endNodeId: string): Promise<GraphQueryResult>;
  /** Get basic stats about the graph. */
  stats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    hyperedgeCount: number;
    nodeTypes: Record<NodeType, number>;
    topNodesByDegree: { id: string; label: string; degree: number }[];
  }>;
}

// ------------------------------------------------------------------
// In-Memory Implementation
// ------------------------------------------------------------------

/** In-memory implementation of the KnowledgeGraphStore. */
export class InMemoryKnowledgeGraphStore implements KnowledgeGraphStore {
  private nodes = new Map<string, KnowledgeNode>();
  private edges = new Map<string, KnowledgeEdge>();
  private hyperedges = new Map<string, KnowledgeHyperedge>();
  private nodeEdges = new Map<string, Set<string>>(); // nodeId -> edgeIds

  async addNode(node: Omit<KnowledgeNode, "id" | "createdAt" | "updatedAt">): Promise<KnowledgeNode> {
    const now = new Date().toISOString();
    const newNode: KnowledgeNode = {
      ...node,
      id: createId("node"),
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(newNode.id, newNode);
    this.nodeEdges.set(newNode.id, new Set());
    return newNode;
  }

  async updateNode(id: string, updates: Partial<KnowledgeNode>): Promise<KnowledgeNode | undefined> {
    const existing = this.nodes.get(id);
    if (!existing) return undefined;
    const updated: KnowledgeNode = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.nodes.set(id, updated);
    return updated;
  }

  async removeNode(id: string): Promise<boolean> {
    // Clean up edges connected to this node
    const edgeIds = this.nodeEdges.get(id);
    if (edgeIds) {
      for (const edgeId of edgeIds) {
        this.edges.delete(edgeId);
      }
      this.nodeEdges.delete(id);
    }
    // Also remove from other nodes' edge sets where this node is target
    for (const [nodeId, edgeSet] of this.nodeEdges) {
      if (nodeId === id) continue;
      for (const edgeId of [...edgeSet]) {
        const edge = this.edges.get(edgeId);
        if (edge && (edge.sourceId === id || edge.targetId === id)) {
          edgeSet.delete(edgeId);
          this.edges.delete(edgeId);
        }
      }
    }
    return this.nodes.delete(id);
  }

  async getNode(id: string): Promise<KnowledgeNode | undefined> {
    return this.nodes.get(id);
  }

  async searchNodes(options: {
    query?: string;
    type?: NodeType;
    tags?: readonly string[];
    limit?: number;
  }): Promise<KnowledgeNode[]> {
    const limit = options.limit ?? 50;
    let results = [...this.nodes.values()];

    if (options.type) {
      results = results.filter((n) => n.type === options.type);
    }

    if (options.tags && options.tags.length > 0) {
      results = results.filter((n) => options.tags!.some((tag) => n.tags?.includes(tag)));
    }

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.description?.toLowerCase().includes(q) ||
          n.properties?.toString().toLowerCase().includes(q),
      );
    }

    return results.slice(0, limit);
  }

  async addEdge(edge: Omit<KnowledgeEdge, "id" | "createdAt">): Promise<KnowledgeEdge> {
    const newEdge: KnowledgeEdge = {
      ...edge,
      id: createId("edge"),
      createdAt: new Date().toISOString(),
    };
    this.edges.set(newEdge.id, newEdge);

    // Update node -> edge mappings
    const sourceEdges = this.nodeEdges.get(newEdge.sourceId) ?? new Set();
    sourceEdges.add(newEdge.id);
    this.nodeEdges.set(newEdge.sourceId, sourceEdges);

    const targetEdges = this.nodeEdges.get(newEdge.targetId) ?? new Set();
    targetEdges.add(newEdge.id);
    this.nodeEdges.set(newEdge.targetId, targetEdges);

    return newEdge;
  }

  async removeEdge(id: string): Promise<boolean> {
    const edge = this.edges.get(id);
    if (edge) {
      this.nodeEdges.get(edge.sourceId)?.delete(id);
      this.nodeEdges.get(edge.targetId)?.delete(id);
    }
    return this.edges.delete(id);
  }

  async getEdge(id: string): Promise<KnowledgeEdge | undefined> {
    return this.edges.get(id);
  }

  async getEdgesForNode(nodeId: string): Promise<{ outgoing: KnowledgeEdge[]; incoming: KnowledgeEdge[] }> {
    const edgeIds = this.nodeEdges.get(nodeId);
    if (!edgeIds) return { outgoing: [], incoming: [] };

    const all = [...edgeIds].map((id) => this.edges.get(id)!);
    return {
      outgoing: all.filter((e) => e.sourceId === nodeId),
      incoming: all.filter((e) => e.targetId === nodeId),
    };
  }

  async addHyperedge(edge: Omit<KnowledgeHyperedge, "id" | "createdAt">): Promise<KnowledgeHyperedge> {
    const newEdge: KnowledgeHyperedge = {
      ...edge,
      id: createId("hyperedge"),
      createdAt: new Date().toISOString(),
    };
    this.hyperedges.set(newEdge.id, newEdge);
    return newEdge;
  }

  async removeHyperedge(id: string): Promise<boolean> {
    return this.hyperedges.delete(id);
  }

  async getHyperedgesForNode(nodeId: string): Promise<KnowledgeHyperedge[]> {
    return [...this.hyperedges.values()].filter((he) => he.nodeIds.includes(nodeId));
  }

  // ------------------------------------------------------------------
  // Graph Traversal & Queries
  // ------------------------------------------------------------------

  async bfs(startNodeId: string, maxDepth: number): Promise<GraphQueryResult> {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: startNodeId, depth: 0 }];
    const resultNodes: KnowledgeNode[] = [];
    const resultEdges: KnowledgeEdge[] = [];

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (visited.has(nodeId) || depth > maxDepth) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) resultNodes.push(node);

      // Find connected edges (both outgoing and incoming)
      const edgeIds = this.nodeEdges.get(nodeId);
      if (edgeIds) {
        for (const edgeId of edgeIds) {
          const edge = this.edges.get(edgeId);
          if (edge) {
            resultEdges.push(edge);
            const otherNodeId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
            if (!visited.has(otherNodeId)) {
              queue.push({ nodeId: otherNodeId, depth: depth + 1 });
            }
          }
        }
      }
    }

    return {
      nodes: this.deduplicateNodes(resultNodes),
      edges: this.deduplicateEdges(resultEdges),
    };
  }

  async shortestPath(startNodeId: string, endNodeId: string): Promise<GraphQueryResult> {
    if (startNodeId === endNodeId) {
      const node = this.nodes.get(startNodeId);
      return {
        nodes: node ? [node] : [],
        edges: [],
        path: [startNodeId],
      };
    }

    // BFS to find shortest path
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: startNodeId, path: [startNodeId] }];
    const parentMap = new Map<string, { parent: string; edgeId: string }>();

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      if (nodeId === endNodeId) {
        // Reconstruct path and edges
        const resultNodes: KnowledgeNode[] = [];
        const resultEdges: KnowledgeEdge[] = [];
        for (const id of path) {
          const node = this.nodes.get(id);
          if (node) resultNodes.push(node);
        }
        for (let i = 0; i < path.length - 1; i++) {
          const edge = [...this.edges.values()].find(
            (e) => (e.sourceId === path[i] && e.targetId === path[i + 1]) ||
                   (e.sourceId === path[i + 1] && e.targetId === path[i]),
          );
          if (edge) resultEdges.push(edge);
        }
        return {
          nodes: this.deduplicateNodes(resultNodes),
          edges: this.deduplicateEdges(resultEdges),
          path,
        };
      }

      // Get connected nodes
      const edgeIds = this.nodeEdges.get(nodeId);
      if (edgeIds) {
        for (const edgeId of edgeIds) {
          const edge = this.edges.get(edgeId);
          if (!edge || visited.has(edge.targetId) && edge.targetId !== nodeId) continue;
          const otherNodeId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
          if (!visited.has(otherNodeId)) {
            queue.push({ nodeId: otherNodeId, path: [...path, otherNodeId] });
          }
        }
      }
    }

    // No path found
    return { nodes: [], edges: [] };
  }

  async stats(): Promise<{
    nodeCount: number;
    edgeCount: number;
    hyperedgeCount: number;
    nodeTypes: Record<NodeType, number>;
    topNodesByDegree: { id: string; label: string; degree: number }[];
  }> {
    const nodeTypes = {} as Record<NodeType, number>;
    for (const node of this.nodes.values()) {
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }

    const topNodes = [...this.nodes.values()]
      .map((node) => {
        const edgeCount = this.nodeEdges.get(node.id)?.size ?? 0;
        return { id: node.id, label: node.label, degree: edgeCount };
      })
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 10);

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      hyperedgeCount: this.hyperedges.size,
      nodeTypes,
      topNodesByDegree: topNodes,
    };
  }

  private deduplicateNodes(nodes: KnowledgeNode[]): KnowledgeNode[] {
    const seen = new Set<string>();
    return nodes.filter((n) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }

  private deduplicateEdges(edges: KnowledgeEdge[]): KnowledgeEdge[] {
    const seen = new Set<string>();
    return edges.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }
}

// ------------------------------------------------------------------
// Graph Builder (Factory)
// ------------------------------------------------------------------

/**
 * Builds a KnowledgeGraph from a set of files/nodes.
 */
export class KnowledgeGraphBuilder {
  constructor(private store: KnowledgeGraphStore) {}

  async fromFiles(files: string[]): Promise<KnowledgeGraphStore> {
    // Placeholder: In a real implementation, this would:
    // 1. Read each file
    // 2. Extract entities and relationships
    // 3. Add nodes and edges to the store
    for (const file of files) {
      // For now, just create a file node
      await this.store.addNode({
        label: file,
        type: "file",
        description: `File: ${file}`,
        source: file,
        confidence: "extracted",
        confidenceScore: 1.0,
        properties: { path: file },
      });
    }
    return this.store;
  }

  async fromCode(filePath: string, content: string): Promise<KnowledgeGraphStore> {
    // Placeholder for code-aware graph building
    const node = await this.store.addNode({
      label: filePath,
      type: "code",
      source: filePath,
      confidence: "extracted",
      confidenceScore: 1.0,
      properties: { lines: content.split("\n").length, size: content.length },
    });
    return this.store;
  }

  async fromText(label: string, text: string, source?: string): Promise<KnowledgeGraphStore> {
    const node = await this.store.addNode({
      label,
      type: "document",
      description: text.slice(0, 200),
      source,
      confidence: "extracted",
      confidenceScore: 1.0,
      properties: { length: text.length },
    });
    return this.store;
  }
}
