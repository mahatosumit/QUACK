import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type DefinitionResult, type ReferenceResult, type CallHierarchy } from "../types.js";

export class SemanticNavigator {
  constructor(private readonly sl: SemanticLayer) {}

  async findDefinition(symbol: string, file?: string): Promise<DefinitionResult | undefined> {
    const symbolDb = this.sl.symbolDb;
    const matches = await symbolDb.getByName(symbol, 1);
    if (matches.length === 0) return undefined;

    const s = matches[0];
    const content = await this.getFileContext(s.filePath, s.line);
    return {
      symbol: s.name,
      file: s.filePath,
      line: s.line,
      column: s.column,
      context: content,
    };
  }

  async findReferences(symbol: string): Promise<ReferenceResult> {
    const search = this.sl.search;
    const refResults = await search.referenceSearch({ query: symbol, mode: "reference" });
    const refs = refResults.map((r) => ({
      file: r.file,
      line: r.line,
      column: r.column,
      context: [...r.context.before, ...r.context.after].join("\n"),
    }));

    return {
      symbol,
      references: refs,
      totalCount: refs.length,
    };
  }

  async getCallHierarchy(symbol: string): Promise<CallHierarchy> {
    const callers = await this.findCallers(symbol);
    const callees = await this.findCallees(symbol);

    return {
      symbol,
      callers,
      callees,
    };
  }

  async resolveSymbolAtLocation(file: string, line: number, column: number): Promise<string | undefined> {
    const lsp = this.sl.lsp;
    const files = this.sl.getFiles();
    const target = files.find((f) => f.relativePath === file);
    if (!target) return undefined;

    const def = await lsp.findDefinition(file, line, column, target.language);
    if (!def) return undefined;
    const content = await this.getFileContext(def.uri, def.line);
    const firstLine = content.split("\n")[0] ?? "";
    const wordMatch = firstLine.match(/(\w+)\s*\(/);
    return wordMatch ? wordMatch[1] : undefined;
  }

  private async findCallers(symbol: string): Promise<CallHierarchy["callers"]> {
    const refs = await this.findReferences(symbol);
    return refs.references.slice(0, 20).map((r) => ({
      symbol: symbol,
      file: r.file,
      line: r.line,
      kind: "function",
    }));
  }

  private async findCallees(symbol: string): Promise<CallHierarchy["callees"]> {
    const symbolDb = this.sl.symbolDb;
    const matches = await symbolDb.getByName(symbol, 1);
    if (matches.length === 0) return [];

    const s = matches[0];
    const content = await this.getFileContext(s.filePath, s.line);
    const calledSymbols = this.extractCalledSymbols(content);
    return calledSymbols.map((name) => ({
      symbol: name,
      file: s.filePath,
      line: s.line,
      kind: "function",
    }));
  }

  private extractCalledSymbols(content: string): string[] {
    const calls: string[] = [];
    const callPattern = /(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(content)) !== null) {
      const name = match[1];
      if (name && !["if", "for", "while", "switch", "catch", "return", "throw", "await", "yield", "function", "class", "const", "let", "var"].includes(name)) {
        calls.push(name);
      }
    }
    return [...new Set(calls)];
  }

  private async getFileContext(filePath: string, line: number): Promise<string> {
    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, line - 3);
      const end = Math.min(lines.length, line + 3);
      return lines.slice(start, end).join("\n");
    } catch {
      return "";
    }
  }
}
