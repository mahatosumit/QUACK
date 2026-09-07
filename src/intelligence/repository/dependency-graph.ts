import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { type Dependency, type DependencyType, type Language, type FileInfo } from "../types.js";
import { detectLanguage } from "../languages/language-detector.js";

const IMPORT_PATTERNS: Record<string, Array<{ regex: RegExp; type: DependencyType; moduleGroup: number }>> = {
  typescript: [
    { regex: /import\s+.*\s+from\s+['"]([^'"]+)['"]/g, type: "import", moduleGroup: 1 },
    { regex: /import\s+['"]([^'"]+)['"]/g, type: "import", moduleGroup: 1 },
    { regex: /import\s+type\s+.*\s+from\s+['"]([^'"]+)['"]/g, type: "type_reference", moduleGroup: 1 },
    { regex: /require\(['"]([^'"]+)['"]\)/g, type: "require", moduleGroup: 1 },
    { regex: /export\s+.*\s+from\s+['"]([^'"]+)['"]/g, type: "re-export", moduleGroup: 1 },
    { regex: /dynamic\s+import\(['"]([^'"]+)['"]\)/g, type: "dynamic_import", moduleGroup: 1 },
  ],
  javascript: [
    { regex: /import\s+.*\s+from\s+['"]([^'"]+)['"]/g, type: "import", moduleGroup: 1 },
    { regex: /import\s+['"]([^'"]+)['"]/g, type: "import", moduleGroup: 1 },
    { regex: /require\(['"]([^'"]+)['"]\)/g, type: "require", moduleGroup: 1 },
  ],
  python: [
    { regex: /^import\s+(\S+)/gm, type: "import", moduleGroup: 1 },
    { regex: /^from\s+(\S+)\s+import/gm, type: "import", moduleGroup: 1 },
  ],
  rust: [
    { regex: /^use\s+(\S+)/gm, type: "import", moduleGroup: 1 },
    { regex: /^extern\s+crate\s+(\S+)/gm, type: "import", moduleGroup: 1 },
  ],
  go: [
    { regex: /"([^"]+)"/g, type: "import", moduleGroup: 1 },
  ],
};

const EXTERNAL_PREFIXES: Record<string, string[]> = {
  typescript: ["@", "node:"],
  javascript: ["@", "node:"],
  python: [],
  rust: ["std::", "tokio::", "serde::", "regex::"],
  go: ["github.com/", "golang.org/", "google.golang.org/"],
};

/**
 * DependencyGraph builds and queries a graph of imports and dependencies
 * across all files in the workspace.
 */
export class DependencyGraph {
  private deps = new Map<string, Dependency[]>();
  private reverseDeps = new Map<string, string[]>(); // target -> sources

  /**
   * Analyze all files and build the dependency graph.
   */
  async build(files: readonly FileInfo[]): Promise<void> {
    this.deps.clear();
    this.reverseDeps.clear();

    for (const file of files) {
      try {
        const content = await readFile(file.path, "utf-8");
        const imports = this.extractImports(file, content);
        this.deps.set(file.relativePath, imports);

        for (const dep of imports) {
          if (dep.isExternal) continue;
          const sources = this.reverseDeps.get(dep.targetFile) ?? [];
          if (!sources.includes(file.relativePath)) {
            sources.push(file.relativePath);
          }
          this.reverseDeps.set(dep.targetFile, sources);
        }
      } catch { continue; }
    }
  }

  /**
   * Get dependencies for a file (what it imports).
   */
  getDependencies(filePath: string): readonly Dependency[] {
    return this.deps.get(filePath) ?? [];
  }

  /**
   * Get reverse dependencies (what imports this file).
   */
  getDependents(filePath: string): readonly string[] {
    return this.reverseDeps.get(filePath) ?? [];
  }

  /**
   * Find the shortest import path between two files.
   */
  findImportPath(fromFile: string, toFile: string): string[] | undefined {
    const visited = new Set<string>();
    const queue: Array<{ file: string; path: string[] }> = [{ file: fromFile, path: [fromFile] }];

    while (queue.length > 0) {
      const { file, path } = queue.shift()!;
      if (file === toFile) return path;
      if (visited.has(file)) continue;
      visited.add(file);

      const deps = this.deps.get(file) ?? [];
      for (const dep of deps) {
        if (!dep.isExternal && !visited.has(dep.targetFile)) {
          queue.push({ file: dep.targetFile, path: [...path, dep.targetFile] });
        }
      }
    }

    return undefined;
  }

  /**
   * Detect circular dependencies.
   */
  detectCircularDependencies(): Array<string[]> {
    const cycles: Array<string[]> = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (file: string, path: string[]) => {
      if (inStack.has(file)) {
        const cycleStart = path.indexOf(file);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), file]);
        }
        return;
      }
      if (visited.has(file)) return;
      visited.add(file);
      inStack.add(file);

      const deps = this.deps.get(file) ?? [];
      for (const dep of deps) {
        if (!dep.isExternal) {
          dfs(dep.targetFile, [...path, file]);
        }
      }

      inStack.delete(file);
    };

    for (const file of this.deps.keys()) {
      dfs(file, []);
    }

    return cycles;
  }

  /**
   * Get module-level dependency graph (file → module groupings).
   */
  getModuleGraph(): Record<string, string[]> {
    const moduleDeps: Record<string, Set<string>> = {};

    for (const [file, deps] of this.deps) {
      const moduleName = this.moduleName(file);
      if (!moduleDeps[moduleName]) moduleDeps[moduleName] = new Set();

      for (const dep of deps) {
        if (!dep.isExternal) {
          const depModule = this.moduleName(dep.targetFile);
          if (depModule !== moduleName) {
            moduleDeps[moduleName].add(depModule);
          }
        }
      }
    }

    const result: Record<string, string[]> = {};
    for (const [mod, deps] of Object.entries(moduleDeps)) {
      result[mod] = [...deps];
    }
    return result;
  }

  /**
   * Get all entry points (files with no dependents).
   */
  getEntryPoints(): string[] {
    const allFiles = new Set(this.deps.keys());
    for (const deps of this.deps.values()) {
      for (const dep of deps) {
        allFiles.delete(dep.targetFile);
      }
    }
    return [...allFiles].filter((f) => !f.includes("node_modules"));
  }

  getStats(): { totalFiles: number; totalDeps: number; avgDepsPerFile: number; entryPoints: number } {
    let totalDeps = 0;
    for (const deps of this.deps.values()) totalDeps += deps.filter((d) => !d.isExternal).length;
    return {
      totalFiles: this.deps.size,
      totalDeps,
      avgDepsPerFile: this.deps.size > 0 ? totalDeps / this.deps.size : 0,
      entryPoints: this.getEntryPoints().length,
    };
  }

  private extractImports(file: FileInfo, content: string): Dependency[] {
    const imports: Dependency[] = [];
    const patterns = IMPORT_PATTERNS[file.language] ?? [];

    for (const { regex, type, moduleGroup } of patterns) {
      const normalized = new RegExp(regex.source, regex.flags.includes("g") ? "g" : regex.flags + "g");
      let match: RegExpExecArray | null;
      while ((match = normalized.exec(content)) !== null) {
        const spec = match[moduleGroup]?.trim();
        if (!spec || imports.some((i) => i.moduleSpecifier === spec)) continue;

        const isExternal = this.isExternalDependency(spec, file.language);
        const lineNum = content.slice(0, match.index).split("\n").length;

        let targetFile = spec;
        if (!isExternal && !spec.startsWith("node:")) {
          targetFile = this.resolveModulePath(spec, file.path);
        }

        imports.push({
          sourceFile: file.relativePath,
          targetFile,
          type,
          line: lineNum,
          isExternal,
          moduleSpecifier: spec,
        });
      }
    }

    return imports;
  }

  private isExternalDependency(specifier: string, language: Language): boolean {
    const prefixes = EXTERNAL_PREFIXES[language] ?? [];
    if (prefixes.some((p) => specifier.startsWith(p))) return true;
    if (["node:"].some((p) => specifier.startsWith(p))) return true;
    return !specifier.startsWith(".") && !specifier.startsWith("/");
  }

  private resolveModulePath(specifier: string, sourcePath: string): string {
    // Relative import
    if (specifier.startsWith(".")) {
      const dir = dirname(sourcePath);
      const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js"];

      for (const ext of extensions) {
        const candidate = resolve(dir, `${specifier}${ext}`);
        if (existsSync(candidate)) {
          const rel = relative(this.getWorkspaceRoot(sourcePath), candidate).replace(/\\/g, "/");
          return rel;
        }
      }
      // Without extension
      const candidate = resolve(dir, specifier);
      if (existsSync(candidate)) {
        const rel = relative(this.getWorkspaceRoot(sourcePath), candidate).replace(/\\/g, "/");
        return rel;
      }
    }

    return specifier;
  }

  private moduleName(filePath: string): string {
    const parts = filePath.split("/");
    return parts.length > 1 ? parts[0] : filePath;
  }

  private workspaceRoot = process.cwd();

  private getWorkspaceRoot(_filePath: string): string {
    return this.workspaceRoot;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }
}
