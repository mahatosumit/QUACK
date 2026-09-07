import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeIngestionPipeline, HashEmbedder, InMemoryVectorStore, type KnowledgeSource } from "./ingestion-pipeline.js";

test("KnowledgeIngestionPipeline ingests a document and returns chunks", async () => {
  const pipeline = new KnowledgeIngestionPipeline();
  const text = "QUACK is an autonomous AI operating system. It uses multi-agent organization.";
  const doc = await pipeline.ingest("documentation", text, { title: "Overview" });
  assert.equal(doc.title, "Overview");
  assert.ok(doc.chunks.length >= 1);
  assert.ok(doc.chunks[0].embedding.length > 0);
});

test("KnowledgeIngestionPipeline query returns nearest chunks", async () => {
  const pipeline = new KnowledgeIngestionPipeline();
  await pipeline.ingest("codebase", "function login(user, pass) { return authenticate(user, pass); }");
  await pipeline.ingest("documentation", "The login process validates user credentials and returns a token.");
  const hits = await pipeline.query("how does login work?");
  assert.ok(hits.length > 0);
  assert.ok(hits.length <= 5);
});

test("HashEmbedder produces normalized vectors", async () => {
  const e = new HashEmbedder(64);
  const v = await e.embed("hello world");
  assert.equal(v.length, 64);
  let sq = 0;
  for (const x of v) sq += x * x;
  assert.ok(Math.abs(Math.sqrt(sq) - 1) < 1e-6);
});

test("InMemoryVectorStore add and search", async () => {
  const store = new InMemoryVectorStore();
  await store.add({ id: "c1", documentId: "d1", text: "a", embedding: [1, 0], position: 0 });
  await store.add({ id: "c2", documentId: "d1", text: "b", embedding: [0, 1], position: 1 });
  assert.equal(store.size(), 2);
  const hits = await store.search([1, 0.1], 1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "c1");
});

test("Pipeline throws for unknown source", async () => {
  const pipeline = new KnowledgeIngestionPipeline();
  await assert.rejects(() => pipeline.ingest("pdf" as KnowledgeSource, "raw bytes"));
});

test("Pipeline summary counts documents and chunks", async () => {
  const pipeline = new KnowledgeIngestionPipeline();
  await pipeline.ingest("documentation", "doc one content here");
  await pipeline.ingest("documentation", "doc two content here");
  const s = pipeline.summary();
  assert.equal(s.documents, 2);
  assert.ok(s.chunks >= 2);
  assert.equal(s.vectorSize, s.chunks);
});
