import { createReadStream } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { relative, resolve } from "node:path";
import { type SearchQuery, type SearchResult, type SearchMode, type Language } from "../types.js";
import { type SymbolDatabase } from "../symbols/symbol-database.js";
import { type KnowledgeGraphStore } from "../../memory/knowledge-graph.js";
import { type MemoryStore } from "../../memory/memory.js";

export class SemanticSearch {
  constructor(
    private readonly workspaceRoot: string,
    private readonly symbolDb: SymbolDatabase,
    private readonly kg?: KnowledgeGraphStore,
    private readonly memory?: MemoryStore,
  ) {}

  async search(query: SearchQuery): Promise<SearchResult[]> {
    switch (query.mode) {
      case "text": return this.textSearch(query);
      case "regex": return this.regexSearch(query);
      case "symbol": return this.symbolSearch(query);
      case "file": return this.fileSearch(query);
      case "reference": return this.referenceSearch(query);
      case "hybrid": return this.hybridSearch(query);
      case "semantic": return this.semanticSearch(query);
      default: return this.textSearch(query);
    }
  }

  async textSearch(query: SearchQuery): Promise<SearchResult[]> {
    const maxResults = query.maxResults ?? 50;
    const results: SearchResult[] = [];
    const q = query.caseSensitive ? query.query : query.query.toLowerCase();

    const files = await this.collectFiles(query.path);
    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const lines: string[] = [];
        const stream = createReadStream(file, { encoding: "utf-8" });
        const rl = createInterface({ input: stream });
        for await (const line of rl) lines.push(line);

        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const lineText = query.caseSensitive ? lines[i] : lines[i].toLowerCase();
          if (lineText.includes(q)) {
            const before = lines.slice(Math.max(0, i - 2), i);
            const after = lines.slice(i + 1, Math.min(lines.length, i + 3));
            const relPath = relative(this.workspaceRoot, file).replace(/\\/g, "/");
            results.push({
              file: relPath,
              line: i + 1,
              column: lines[i].indexOf(query.query),
              text: lines[i].trim(),
              context: { before, after },
              score: 0.5,
              matchType: "exact",
            });
          }
        }
      } catch { continue; }
    }

    return results;
  }

  async regexSearch(query: SearchQuery): Promise<SearchResult[]> {
    const maxResults = query.maxResults ?? 50;
    const results: SearchResult[] = [];
    let regex: RegExp;
    try {
      regex = new RegExp(query.query, query.caseSensitive ? "g" : "gi");
    } catch {
      return results;
    }

    const files = await this.collectFiles(query.path);
    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = await readFile(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            const before = lines.slice(Math.max(0, i - 2), i);
            const after = lines.slice(i + 1, Math.min(lines.length, i + 3));
            const relPath = relative(this.workspaceRoot, file).replace(/\\/g, "/");
            results.push({
              file: relPath,
              line: i + 1,
              column: lines[i].search(regex),
              text: lines[i].trim(),
              context: { before, after },
              score: 0.6,
              matchType: "exact",
            });
          }
        }
      } catch { continue; }
    }

    return results;
  }

  async symbolSearch(query: SearchQuery): Promise<SearchResult[]> {
    const symbols = await this.symbolDb.fuzzySearch(query.query, query.maxResults ?? 30);
    return symbols.map((sym) => ({
      file: relative(this.workspaceRoot, sym.filePath).replace(/\\/g, "/"),
      line: sym.line,
      column: sym.column,
      text: `${sym.kind} ${sym.name}${sym.signature ? ` ${sym.signature}` : ""}`,
      language: sym.language,
      context: { before: [], after: [] },
      score: sym.score,
      matchType: "symbol" as const,
    }));
  }

  async fileSearch(query: SearchQuery): Promise<SearchResult[]> {
    const q = query.query.toLowerCase();
    const results: SearchResult[] = [];

    const files = await this.collectFiles();
    for (const file of files) {
      const relPath = relative(this.workspaceRoot, file).replace(/\\/g, "/");
      if (relPath.toLowerCase().includes(q)) {
        results.push({
          file: relPath,
          line: 0,
          column: 0,
          text: relPath,
          context: { before: [], after: [] },
          score: relPath === q ? 1.0 : 0.8,
          matchType: "exact",
        });
      }
    }

    return results.slice(0, query.maxResults ?? 50);
  }

  async referenceSearch(query: SearchQuery): Promise<SearchResult[]> {
    const symbols = await this.symbolDb.searchByName(query.query, 5);
    const results: SearchResult[] = [];

    for (const sym of symbols) {
      try {
        const content = await readFile(sym.filePath, "utf-8");
        const lines = content.split("\n");
        const q = sym.name;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(q)) {
            const relPath = relative(this.workspaceRoot, sym.filePath).replace(/\\/g, "/");
            results.push({
              file: relPath,
              line: i + 1,
              column: lines[i].indexOf(q),
              text: lines[i].trim(),
              context: { before: [], after: [] },
              score: 0.7,
              matchType: "reference",
            });
          }
        }
      } catch { continue; }
    }

    return results.slice(0, query.maxResults ?? 50);
  }

  async hybridSearch(query: SearchQuery): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    const textQ = { ...query, maxResults: 20, mode: "text" as SearchMode };
    const symQ = { ...query, maxResults: 20, mode: "symbol" as SearchMode };
    const fileQ = { ...query, maxResults: 10, mode: "file" as SearchMode };
    const refQ = { ...query, maxResults: 10, mode: "reference" as SearchMode };

    const [text, sym, files, refs] = await Promise.all([
      this.textSearch(textQ),
      this.symbolSearch(symQ),
      this.fileSearch(fileQ),
      this.referenceSearch(refQ),
    ]);

    all.push(...text, ...sym, ...files, ...refs);
    return all.sort((a, b) => b.score - a.score).slice(0, query.maxResults ?? 50);
  }

  async semanticSearch(query: SearchQuery): Promise<SearchResult[]> {
    const q = query.query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const maxResults = query.maxResults ?? 30;
    const scored: Array<{ file: string; line: number; text: string; score: number }> = [];

    const files = await this.collectFiles(query.path);
    for (const file of files) {
      try {
        const content = await readFile(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase();
          let matchCount = 0;
          for (const word of words) {
            if (lower.includes(word)) matchCount++;
          }
          if (matchCount > 0) {
            const relPath = relative(this.workspaceRoot, file).replace(/\\/g, "/");
            scored.push({
              file: relPath,
              line: i + 1,
              text: lines[i].trim(),
              score: matchCount / words.length,
            });
          }
        }
      } catch { continue; }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((r) => ({
        ...r,
        column: 0,
        context: { before: [], after: [] },
        matchType: "semantic" as const,
      }));
  }

  private async collectFiles(subpath?: string): Promise<string[]> {
    const root = subpath ? resolve(this.workspaceRoot, subpath) : this.workspaceRoot;
    const files: string[] = [];

    async function walk(dir: string) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        const promises = entries.map(async (entry) => {
          if (entry.name.startsWith(".") || entry.name === "node_modules") return;
          const full = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else if (entry.isFile()) {
            files.push(full);
          }
        });
        await Promise.all(promises);
      } catch { /* skip unreadable dirs */ }
    }

    await walk(root);
    return files;
  }
}
