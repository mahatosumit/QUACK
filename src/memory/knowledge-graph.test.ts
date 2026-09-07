import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryKnowledgeGraphStore } from "./knowledge-graph.js";

test("knowledge graph add and retrieve nodes", async () => {
  const kg = new InMemoryKnowledgeGraphStore();

  const node = await kg.addNode({
    label: "QUACK",
    type: "concept",
    description: "AI Operating System",
    confidence: "extracted",
    confidenceScore: 1.0,
    properties: {},
  });

  assert.ok(node.id.startsWith("node_"));
  assert.equal(node.label, "QUACK");
  assert.equal(node.type, "concept");

  const retrieved = await kg.getNode(node.id);
  assert.ok(retrieved);
  assert.equal(retrieved!.label, "QUACK");
});

test("knowledge graph add and traverse edges", async () => {
  const kg = new InMemoryKnowledgeGraphStore();

  const a = await kg.addNode({ label: "Node A", type: "concept", properties: {} });
  const b = await kg.addNode({ label: "Node B", type: "concept", properties: {} });

  const edge = await kg.addEdge({
    sourceId: a.id,
    targetId: b.id,
    relation: "references",
    weight: 1.0,
    evidence: ["test"],
  });

  assert.ok(edge.id.startsWith("edge_"));
  assert.equal(edge.sourceId, a.id);
  assert.equal(edge.targetId, b.id);

  const bfs = await kg.bfs(a.id, 2);
  assert.equal(bfs.nodes.length, 2);
  assert.equal(bfs.edges.length, 1);
});

test("knowledge graph search by type and tags", async () => {
  const kg = new InMemoryKnowledgeGraphStore();

  await kg.addNode({ label: "doc1", type: "document", tags: ["important"], properties: {} });
  await kg.addNode({ label: "doc2", type: "document", tags: ["archived"], properties: {} });
  await kg.addNode({ label: "code1", type: "code", tags: ["important"], properties: {} });

  const documents = await kg.searchNodes({ type: "document" });
  assert.equal(documents.length, 2);

  const important = await kg.searchNodes({ tags: ["important"] });
  assert.equal(important.length, 2);
});

test("knowledge graph shortest path", async () => {
  const kg = new InMemoryKnowledgeGraphStore();

  const a = await kg.addNode({ label: "A", type: "concept", properties: {} });
  const b = await kg.addNode({ label: "B", type: "concept", properties: {} });
  const c = await kg.addNode({ label: "C", type: "concept", properties: {} });

  await kg.addEdge({ sourceId: a.id, targetId: b.id, relation: "references", weight: 1.0, evidence: [] });
  await kg.addEdge({ sourceId: b.id, targetId: c.id, relation: "references", weight: 1.0, evidence: [] });

  const path = await kg.shortestPath(a.id, c.id);
  assert.ok(path.path);
  assert.equal(path.path!.length, 3);
  assert.deepEqual(path.path, [a.id, b.id, c.id]);
});

test("knowledge graph stats", async () => {
  const kg = new InMemoryKnowledgeGraphStore();

  const a = await kg.addNode({ label: "A", type: "concept", properties: {} });
  const b = await kg.addNode({ label: "B", type: "concept", properties: {} });

  await kg.addEdge({ sourceId: a.id, targetId: b.id, relation: "references", weight: 1.0, evidence: [] });

  const stats = await kg.stats();
  assert.equal(stats.nodeCount, 2);
  assert.equal(stats.edgeCount, 1);
  assert.equal(stats.nodeTypes["concept"], 2);
  assert.equal(stats.topNodesByDegree.length, 2);
});

test("knowledge graph remove node cascades edges", async () => {
  const kg = new InMemoryKnowledgeGraphStore();

  const a = await kg.addNode({ label: "A", type: "concept", properties: {} });
  const b = await kg.addNode({ label: "B", type: "concept", properties: {} });

  await kg.addEdge({ sourceId: a.id, targetId: b.id, relation: "references", weight: 1.0, evidence: [] });

  const removed = await kg.removeNode(a.id);
  assert.equal(removed, true);

  const stats = await kg.stats();
  assert.equal(stats.nodeCount, 1);
  assert.equal(stats.edgeCount, 0);
});
