import { createId, type JsonObject } from "../../core/types.js";
import { type SymbolInfo, type SymbolKind, type Language } from "../types.js";

/**
 * SymbolDatabase stores and queries code symbols extracted from the workspace.
 * Supports fast lookup by name, kind, file, language, and parent.
 */
export class SymbolDatabase {
  private symbols = new Map<string, SymbolInfo>();
  private byFile = new Map<string, Set<string>>();
  private byName = new Map<string, Set<string>>();
  private byKind = new Map<SymbolKind, Set<string>>();
  private byLanguage = new Map<Language, Set<string>>();
  private byParent = new Map<string, Set<string>>();

  async insert(symbol: Omit<SymbolInfo, "id">): Promise<SymbolInfo> {
    const info: SymbolInfo = { ...symbol, id: createId("sym") };
    this.symbols.set(info.id, info);

    const fileSet = this.byFile.get(info.filePath) ?? new Set();
    fileSet.add(info.id);
    this.byFile.set(info.filePath, fileSet);

    const nameSet = this.byName.get(info.name.toLowerCase()) ?? new Set();
    nameSet.add(info.id);
    this.byName.set(info.name.toLowerCase(), nameSet);

    const kindSet = this.byKind.get(info.kind) ?? new Set();
    kindSet.add(info.id);
    this.byKind.set(info.kind, kindSet);

    const langSet = this.byLanguage.get(info.language) ?? new Set();
    langSet.add(info.id);
    this.byLanguage.set(info.language, langSet);

    if (info.parentName) {
      const parentSet = this.byParent.get(info.parentName.toLowerCase()) ?? new Set();
      parentSet.add(info.id);
      this.byParent.set(info.parentName.toLowerCase(), parentSet);
    }

    return info;
  }

  async bulkInsert(symbols: Omit<SymbolInfo, "id">[]): Promise<SymbolInfo[]> {
    return Promise.all(symbols.map((s) => this.insert(s)));
  }

  async getById(id: string): Promise<SymbolInfo | undefined> {
    return this.symbols.get(id);
  }

  async getByName(name: string, limit = 50): Promise<SymbolInfo[]> {
    const ids = this.byName.get(name.toLowerCase());
    if (!ids) return [];
    return [...ids]
      .map((id) => this.symbols.get(id)!)
      .slice(0, limit);
  }

  async getByKind(kind: SymbolKind, limit = 100): Promise<SymbolInfo[]> {
    const ids = this.byKind.get(kind);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.symbols.get(id)!)
      .slice(0, limit);
  }

  async getByFile(filePath: string): Promise<SymbolInfo[]> {
    const ids = this.byFile.get(filePath);
    if (!ids) return [];
    return [...ids].map((id) => this.symbols.get(id)!);
  }

  async getByLanguage(language: Language): Promise<SymbolInfo[]> {
    const ids = this.byLanguage.get(language);
    if (!ids) return [];
    return [...ids].map((id) => this.symbols.get(id)!);
  }

  async getByParent(parentName: string): Promise<SymbolInfo[]> {
    const ids = this.byParent.get(parentName.toLowerCase());
    if (!ids) return [];
    return [...ids].map((id) => this.symbols.get(id)!);
  }

  async searchByName(query: string, limit = 50): Promise<SymbolInfo[]> {
    const q = query.toLowerCase();
    const results: SymbolInfo[] = [];
    for (const [, ids] of this.byName) {
      for (const id of ids) {
        if (results.length >= limit) break;
        const sym = this.symbols.get(id)!;
        if (sym.name.toLowerCase().includes(q)) {
          results.push(sym);
        }
      }
      if (results.length >= limit) break;
    }
    return results;
  }

  async fuzzySearch(query: string, limit = 30): Promise<Array<SymbolInfo & { score: number }>> {
    const q = query.toLowerCase();
    const scored: Array<SymbolInfo & { score: number }> = [];

    for (const sym of this.symbols.values()) {
      const lower = sym.name.toLowerCase();
      let score = 0;
      if (lower === q) score = 1.0;
      else if (lower.startsWith(q)) score = 0.9;
      else if (lower.includes(q)) score = 0.6;
      else if (this.fuzzyMatch(q, lower)) score = 0.3;
      if (score > 0) scored.push({ ...sym, score });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async removeFile(filePath: string): Promise<void> {
    const ids = this.byFile.get(filePath);
    if (!ids) return;
    for (const id of ids) {
      const sym = this.symbols.get(id);
      if (!sym) continue;
      this.symbols.delete(id);
      this.byName.get(sym.name.toLowerCase())?.delete(id);
      this.byKind.get(sym.kind)?.delete(id);
      this.byLanguage.get(sym.language)?.delete(id);
      if (sym.parentName) this.byParent.get(sym.parentName.toLowerCase())?.delete(id);
    }
    this.byFile.delete(filePath);
  }

  async stats(): Promise<{
    totalSymbols: number;
    byKind: Record<string, number>;
    byLanguage: Record<string, number>;
    topFiles: { path: string; count: number }[];
  }> {
    const byKind: Record<string, number> = {};
    const byLanguage: Record<string, number> = {};

    for (const sym of this.symbols.values()) {
      byKind[sym.kind] = (byKind[sym.kind] ?? 0) + 1;
      byLanguage[sym.language] = (byLanguage[sym.language] ?? 0) + 1;
    }

    const topFiles = [...this.byFile.entries()]
      .map(([path, ids]) => ({ path, count: ids.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { totalSymbols: this.symbols.size, byKind, byLanguage, topFiles };
  }

  async clear(): Promise<void> {
    this.symbols.clear();
    this.byFile.clear();
    this.byName.clear();
    this.byKind.clear();
    this.byLanguage.clear();
  }

  private fuzzyMatch(query: string, target: string): boolean {
    let qi = 0;
    for (let ti = 0; ti < target.length && qi < query.length; ti++) {
      if (query[qi].toLowerCase() === target[ti].toLowerCase()) qi++;
    }
    return qi === query.length;
  }
}

// ------------------------------------------------------------------
// Basic symbol extraction from source code
// ------------------------------------------------------------------

const SYMBOL_PATTERNS: Readonly<Record<string, Array<{ kind: SymbolKind; pattern: RegExp; nameGroup: number; exportGroup?: number }>>> = {
  typescript: [
    { kind: "class", pattern: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, nameGroup: 1 },
    { kind: "interface", pattern: /(?:export\s+)?interface\s+(\w+)/g, nameGroup: 1 },
    { kind: "enum", pattern: /(?:export\s+)?enum\s+(\w+)/g, nameGroup: 1 },
    { kind: "function", pattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, nameGroup: 1 },
    { kind: "function", pattern: /(?:export\s+)?(?:async\s+)?function\s*\*\s*(\w+)/g, nameGroup: 1 },
    { kind: "type", pattern: /(?:export\s+)?type\s+(\w+)/g, nameGroup: 1 },
    { kind: "variable", pattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)/g, nameGroup: 1 },
    { kind: "method", pattern: /(?:public|protected|private|static|async)?\s*(\w+)\s*\([^)]*\)\s*{/g, nameGroup: 1 },
    { kind: "module", pattern: /(?:export\s+)?module\s+(\w+)/g, nameGroup: 1 },
    { kind: "namespace", pattern: /(?:export\s+)?namespace\s+(\w+)/g, nameGroup: 1 },
  ],
  python: [
    { kind: "class", pattern: /^class\s+(\w+)/gm, nameGroup: 1 },
    { kind: "function", pattern: /^(?:async\s+)?def\s+(\w+)/gm, nameGroup: 1 },
    { kind: "variable", pattern: /^(\w+)\s*=\s*.+/gm, nameGroup: 1 },
  ],
  rust: [
    { kind: "struct", pattern: /^struct\s+(\w+)/gm, nameGroup: 1 },
    { kind: "enum", pattern: /^enum\s+(\w+)/gm, nameGroup: 1 },
    { kind: "function", pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, nameGroup: 1 },
    { kind: "trait", pattern: /^trait\s+(\w+)/gm, nameGroup: 1 },
    { kind: "module", pattern: /^mod\s+(\w+)/gm, nameGroup: 1 },
  ],
};

export function extractSymbolsFromFile(filePath: string, content: string, language: Language): Omit<SymbolInfo, "id">[] {
  const symbols: Omit<SymbolInfo, "id">[] = [];
  const patterns = SYMBOL_PATTERNS[language] ?? SYMBOL_PATTERNS["typescript"] ?? [];

  const lines = content.split("\n");
  for (const { kind, pattern, nameGroup } of patterns) {
    const normalizedPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? "g" : pattern.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = normalizedPattern.exec(content)) !== null) {
      const name = match[nameGroup];
      if (!name) continue;
      const lineNum = content.slice(0, match.index).split("\n").length;
      const colNum = match.index - content.lastIndexOf("\n", match.index) - 1;
      const endLine = Math.min(lineNum + 1, lines.length);
      symbols.push({
        name,
        kind: kind as SymbolKind,
        language,
        filePath,
        line: lineNum,
        column: Math.max(0, colNum),
        endLine,
        endColumn: colNum + name.length,
        isExported: match[0]?.startsWith("export") ?? false,
        isAsync: match[0]?.includes("async") ?? false,
        modifiers: [],
        metadata: {},
      });
    }
  }

  return symbols;
}
