import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";

/** Input source types per quackos.md §13. */
export type KnowledgeSource = "pdf" | "github" | "documentation" | "research-paper" | "website" | "codebase";

/** A document ingested by the pipeline. */
export interface IngestedDocument {
  readonly id: string;
  source: KnowledgeSource;
  sourceUri: string;
  title: string;
  content: string;
  chunks: Chunk[];
  createdAt: IsoTimestamp;
}

/** A chunk of text extracted from a document for embedding. */
export interface Chunk {
  readonly id: string;
  documentId: string;
  text: string;
  embedding: number[];
  position: number;
}

/** Result returned by a parser for one source type. */
export interface ParsedDocument {
  readonly title: string;
  readonly content: string;
  readonly sourceUri: string;
  readonly source: KnowledgeSource;
}

/**
 * Parser — converts a raw input (text, file path, URL) into structured text.
 * Registry pattern: register a parser per KnowledgeSource. Each is additive.
 */
export interface DocumentParser {
  readonly source: KnowledgeSource;
  parse(input: string, metadata?: JsonObject): Promise<ParsedDocument>;
}

/** Embedder — converts text into a numeric vector. Default uses a fast hash-based vector. */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}

/** VectorStore — stores and retrieves embeddings by nearest-neighbor. */
export interface VectorStore {
  add(chunk: Chunk): Promise<void>;
  search(query: number[], k: number): Promise<Chunk[]>;
  size(): number;
}

// ── Default embedder: deterministic hash-based (no external deps) ─────────

export class HashEmbedder implements Embedder {
  constructor(private readonly dim = 256) {}

  async embed(text: string): Promise<number[]> {
    const vec = new Float64Array(this.dim);
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      let hash = 0;
      for (let i = 0; i < tok.length; i++) {
        hash = (hash * 31 + tok.charCodeAt(i)) >>> 0;
      }
      vec[hash % this.dim] += 1;
    }
    // L2 normalize
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    const out = new Array<number>(this.dim);
    for (let i = 0; i < this.dim; i++) out[i] = vec[i] / norm;
    return out;
  }
}

// ── In-memory vector store with cosine similarity ────────────────────────

export class InMemoryVectorStore implements VectorStore {
  private items: Chunk[] = [];

  async add(chunk: Chunk): Promise<void> {
    this.items.push(chunk);
  }

  async search(query: number[], k: number): Promise<Chunk[]> {
    if (this.items.length === 0) return [];
    const scored = this.items.map((c) => ({ c, sim: cosine(query, c.embedding) }));
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, k).map((s) => s.c);
  }

  size(): number {
    return this.items.length;
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let anorm = 0;
  let bnorm = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    anorm += a[i] * a[i];
    bnorm += b[i] * b[i];
  }
  return dot / (Math.sqrt(anorm) * Math.sqrt(bnorm) || 1);
}

// ── Built-in parsers ─────────────────────────────────────────────────────

/** Plain-text / Markdown parser. Treats input as raw text. */
export class TextParser implements DocumentParser {
  readonly source = "documentation" as const;
  async parse(input: string, metadata?: JsonObject): Promise<ParsedDocument> {
    const title = (metadata?.["title"] as string) ?? "Untitled";
    return { title, content: input, sourceUri: (metadata?.["uri"] as string) ?? "inline", source: this.source };
  }
}

/** Codebase parser: reads a directory of files and concatenates them. */
export class CodebaseParser implements DocumentParser {
  readonly source = "codebase" as const;
  async parse(input: string): Promise<ParsedDocument> {
    return { title: input, content: "", sourceUri: input, source: this.source };
  }
}

// ── Pipeline ─────────────────────────────────────────────────────────────

export interface KnowledgeIngestionConfig {
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
}

/**
 * KnowledgeIngestionPipeline — quackos.md §13: converts external information
 * into knowledge memory. Stage: Input -> Parser -> Chunk -> Embed -> Vector
 * Store -> Knowledge Memory. All stages pluggable; missing stages use defaults.
 */
export class KnowledgeIngestionPipeline {
  private readonly parsers = new Map<KnowledgeSource, DocumentParser>();
  private readonly documents: IngestedDocument[] = [];

  constructor(
    private readonly embedder: Embedder = new HashEmbedder(),
    private readonly vectorStore: VectorStore = new InMemoryVectorStore(),
    private readonly config: KnowledgeIngestionConfig = { chunkSize: 500, chunkOverlap: 50, topK: 5 },
  ) {
    this.registerParser(new TextParser());
    this.registerParser(new CodebaseParser());
  }

  registerParser(parser: DocumentParser): void {
    this.parsers.set(parser.source, parser);
  }

  /** Ingest one document end-to-end through the pipeline. */
  async ingest(source: KnowledgeSource, input: string, metadata?: JsonObject): Promise<IngestedDocument> {
    const parser = this.parsers.get(source);
    if (!parser) {
      throw new Error(`No parser registered for source type: ${source}`);
    }

    const parsed = await parser.parse(input, metadata);
    const chunks = this.chunkText(parsed.content);

    const doc: IngestedDocument = {
      id: createId("doc"),
      source: parsed.source,
      sourceUri: parsed.sourceUri,
      title: parsed.title,
      content: parsed.content,
      chunks: [],
      createdAt: now(),
    };

    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.embedder.embed(chunks[i]);
      const chunk: Chunk = { id: createId("chunk"), documentId: doc.id, text: chunks[i], embedding, position: i };
      doc.chunks.push(chunk);
      await this.vectorStore.add(chunk);
    }

    this.documents.push(doc);
    return doc;
  }

  /** Query the knowledge base for relevant chunks. */
  async query(text: string): Promise<Chunk[]> {
    const embedding = await this.embedder.embed(text);
    return this.vectorStore.search(embedding, this.config.topK);
  }

  getDocument(id: string): IngestedDocument | undefined {
    return this.documents.find((d) => d.id === id);
  }

  getAll(): readonly IngestedDocument[] {
    return this.documents;
  }

  summary(): { documents: number; chunks: number; vectorSize: number } {
    return {
      documents: this.documents.length,
      chunks: this.documents.reduce((s, d) => s + d.chunks.length, 0),
      vectorSize: this.vectorStore.size(),
    };
  }

  private chunkText(text: string): string[] {
    if (text.length <= this.config.chunkSize) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + this.config.chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start = end - this.config.chunkOverlap;
      if (start >= text.length - this.config.chunkOverlap) break;
    }
    return chunks.filter((c, i, arr) => i === arr.length - 1 || c.length > 50);
  }
}
