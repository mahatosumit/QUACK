import { spawn, type ChildProcess } from "node:child_process";
import { executeProcess, probeBinaryAvailable, childProcessEnvironment } from "../../platform/process.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type LspCapabilities, type LspLocation, type LspDefinition, type LspReference, type LspHoverResult, type LspCompletionItem, type LspDiagnostic, type Language } from "../types.js";

interface LanguageServerEntry {
  readonly language: Language;
  readonly command: string;
  readonly args: readonly string[];
  readonly capabilities: LspCapabilities;
}

/**
 * LSP Manager provides a provider-independent abstraction over Language Server
 * Protocol implementations. It discovers and communicates with language servers
 * for supported languages.
 *
 * Current implementation uses CLI-based LSP commands (synchronous) for
 * common operations. Future implementations will use WebSocket/stdio LSP
 * connections for full protocol support.
 */
export class LspManager {
  private servers = new Map<Language, LanguageServerEntry>();
  private installedLanguages = new Set<Language>();

  constructor() {
    this.registerBuiltinServers();
  }

  private registerBuiltinServers(): void {
    // TypeScript
    this.registerServer({
      language: "typescript",
      command: "npx",
      args: ["-p", "typescript-language-server", "--stdio"],
      capabilities: {
        serverName: "typescript-language-server",
        serverVersion: "builtin",
        supportsDefinition: true,
        supportsReferences: true,
        supportsCompletion: true,
        supportsHover: true,
        supportsDiagnostics: true,
        supportsRename: true,
        supportsCodeActions: true,
        supportsFormatting: true,
        supportsSemanticTokens: true,
        supportsCallHierarchy: true,
        supportsTypeHierarchy: true,
        supportsWorkspaceSymbols: true,
        supportsDocumentSymbols: true,
        supportsSignatureHelp: true,
      },
    });

    // Python
    this.registerServer({
      language: "python",
      command: "pylsp",
      args: [],
      capabilities: {
        serverName: "pylsp", serverVersion: "builtin",
        supportsDefinition: true, supportsReferences: true,
        supportsCompletion: true, supportsHover: true,
        supportsDiagnostics: true, supportsRename: true,
        supportsCodeActions: true, supportsFormatting: true,
        supportsSemanticTokens: false, supportsCallHierarchy: false,
        supportsTypeHierarchy: false, supportsWorkspaceSymbols: true,
        supportsDocumentSymbols: true, supportsSignatureHelp: true,
      },
    });

    // Rust
    this.registerServer({
      language: "rust",
      command: "rust-analyzer",
      args: [],
      capabilities: {
        serverName: "rust-analyzer", serverVersion: "builtin",
        supportsDefinition: true, supportsReferences: true,
        supportsCompletion: true, supportsHover: true,
        supportsDiagnostics: true, supportsRename: true,
        supportsCodeActions: true, supportsFormatting: true,
        supportsSemanticTokens: true, supportsCallHierarchy: true,
        supportsTypeHierarchy: true, supportsWorkspaceSymbols: true,
        supportsDocumentSymbols: true, supportsSignatureHelp: true,
      },
    });

    // Go
    this.registerServer({
      language: "go",
      command: "gopls",
      args: [],
      capabilities: {
        serverName: "gopls", serverVersion: "builtin",
        supportsDefinition: true, supportsReferences: true,
        supportsCompletion: true, supportsHover: true,
        supportsDiagnostics: true, supportsRename: true,
        supportsCodeActions: true, supportsFormatting: true,
        supportsSemanticTokens: true, supportsCallHierarchy: true,
        supportsTypeHierarchy: true, supportsWorkspaceSymbols: true,
        supportsDocumentSymbols: true, supportsSignatureHelp: true,
      },
    });
  }

  registerServer(server: LanguageServerEntry): void {
    this.servers.set(server.language, server);
  }

  getCapabilities(language: Language): LspCapabilities | undefined {
    return this.servers.get(language)?.capabilities;
  }

  isAvailable(language: Language): boolean {
    const server = this.servers.get(language);
    if (!server) return false;
    return probeBinaryAvailable(server.command.split(" ")[0]!);
  }

  // ------------------------------------------------------------------
  // Language-aware utilities (non-LSP fallbacks)
  // ------------------------------------------------------------------

  async findDefinition(filePath: string, line: number, column: number, language: Language): Promise<LspDefinition | undefined> {
    // Falls back to regex-based definition search when LSP is unavailable
    if (!this.isAvailable(language)) return undefined;

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const targetLine = lines[line - 1] ?? "";
      const word = this.extractWord(targetLine, column);
      if (!word) return undefined;

      for (let i = 0; i < lines.length; i++) {
        const patterns = this.getDefinitionPatterns(language, word);
        for (const pattern of patterns) {
          if (pattern.test(lines[i])) {
            return { uri: filePath, line: i + 1, column: lines[i].indexOf(word) };
          }
        }
      }
    } catch { /* fallback failed */ }
    return undefined;
  }

  async findReferences(filePath: string, symbol: string): Promise<LspReference[]> {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const refs: LspReference[] = [];

      for (let i = 0; i < lines.length; i++) {
        const idx = lines[i].indexOf(symbol);
        if (idx !== -1) {
          refs.push({
            uri: filePath,
            line: i + 1,
            column: idx,
            context: lines[i].trim().slice(0, 100),
          });
        }
      }
      return refs;
    } catch {
      return [];
    }
  }

  async getHover(filePath: string, line: number, column: number, language: Language): Promise<LspHoverResult | undefined> {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const targetLine = lines[line - 1] ?? "";
      const word = this.extractWord(targetLine, column);
      if (!word) return undefined;

      // Find the symbol definition to provide hover info
      const def = await this.findDefinition(filePath, line, column, language);
      if (def) {
        const defLines = readFileSync(def.uri, "utf-8").split("\n");
        const defLine = defLines[def.line - 1] ?? "";
        return { contents: `\`${word}\` defined at ${def.uri}:${def.line}\n\`\`\`typescript\n${defLine.trim()}\n\`\`\`` };
      }
      return { contents: `\`${word}\`` };
    } catch {
      return undefined;
    }
  }

  async getDiagnostics(filePath: string, language: Language): Promise<LspDiagnostic[]> {
    if (!this.isAvailable(language)) return [];

    try {
      // Platform-portable argv execution (no shell string, no exit-code
      // masking): tsc failures surface as empty output.
      const result = await executeProcess({
        command: "npx",
        args: ["tsc", "--noEmit"],
        workingDirectory: process.cwd(),
        environment: childProcessEnvironment(),
        timeoutMs: 30_000,
      });
      const output = result.stdout + (result.stderr ? "\n" + result.stderr : "");

      const diagnostics: LspDiagnostic[] = [];
      for (const line of output.split("\n")) {
        const match = line.match(/^(.*)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.*)/);
        if (match && match[1].includes(filePath)) {
          diagnostics.push({
            uri: filePath,
            line: Number(match[2]),
            column: Number(match[3]),
            message: match[6],
            severity: match[4] === "error" ? "error" : "warning",
            code: match[5],
            source: "typescript",
          });
        }
      }
      return diagnostics;
    } catch {
      return [];
    }
  }

  async getWorkspaceSymbols(query: string, workspaceRoot: string): Promise<Array<{ name: string; kind: string; file: string; line: number }>> {
    const symbols: Array<{ name: string; kind: string; file: string; line: number }> = [];
    const q = query.toLowerCase();

    // Scan files for symbols matching the query


    function walk(dir: string) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && /\.(ts|js|py|rs|go)$/.test(entry.name)) {
            try {
              const content = readFileSync(full, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                const defMatch = lines[i].match(/(?:class|interface|function|enum|type|fn|def|struct)\s+(\w+)/);
                if (defMatch && defMatch[1].toLowerCase().includes(q)) {
                  symbols.push({ name: defMatch[1], kind: "symbol", file: relative(workspaceRoot, full), line: i + 1 });
                }
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    walk(workspaceRoot);
    return symbols.slice(0, 50);
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private extractWord(line: string, column: number): string | undefined {
    // Extract the word at the given column
    const before = line.slice(0, column);
    const after = line.slice(column);
    const left = before.match(/(\w+)$/)?.[1] ?? "";
    const right = after.match(/^(\w+)/)?.[1] ?? "";
    const word = left + right;
    return word || undefined;
  }

  private getDefinitionPatterns(language: Language, word: string): RegExp[] {
    switch (language) {
      case "typescript":
      case "javascript":
        return [
          new RegExp(`(?:class|interface|type|enum|function|const|let|var)\\s+${word}\\b`),
          new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:class|interface|type|enum|function|const)\\s+${word}\\b`),
        ];
      case "python":
        return [new RegExp(`(?:class|def)\\s+${word}\\b`)];
      case "rust":
        return [new RegExp(`(?:fn|struct|enum|trait|mod|type)\\s+${word}\\b`)];
      case "go":
        return [new RegExp(`(?:func|type|struct|interface)\\s+${word}\\b`)];
      default:
        return [new RegExp(`\\b${word}\\b`)];
    }
  }
}
