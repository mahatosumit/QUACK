import { readdir, stat, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { createId, now, type JsonObject } from "../types.js";
import { type ProjectState, type ContextProvider } from "./types.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  "coverage", ".cache", ".turbo", ".vercel",
  "__pycache__", ".pytest_cache", ".venv", "venv",
]);

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java",
  ".c": "C", ".cpp": "C++", ".cs": "C#", ".rb": "Ruby",
  ".php": "PHP", ".swift": "Swift", ".kt": "Kotlin",
  ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".md": "Markdown", ".toml": "TOML",
};

/**
 * Loads the current project state from the workspace root. Read-only: never
 * mutates the project. Works as additional context provider.
 */
export class ProjectLoader {
  constructor(private readonly workspaceRoot?: string, private readonly projectFilePath?: string) {}

  async load(): Promise<ProjectState | undefined> {
    const root = this.workspaceRoot ?? process.cwd();
    try {
      const statResult = await stat(root);
      if (!statResult.isDirectory()) return undefined;
    } catch {
      return undefined;
    }

    let gitBranch: string | undefined;
    let gitCommit: string | undefined;
    try {
      const head = await readFile(join(root, ".git", "HEAD"), "utf8");
      const ref = head.trim().match(/^ref:\s+(.+)$/);
      if (ref) {
        gitBranch = ref[1].replace("refs/heads/", "");
        try {
          gitCommit = (await readFile(join(root, ".git", ref[1]), "utf8")).trim();
        } catch {
          void 0;
        }
      }
    } catch {
      void 0;
    }

    const files = await this.collectFiles(root, root, 2000);
    const languages = this.detectLanguages(files);
    const dependencies = await this.collectDependencies(root);

    return {
      id: createId("proj"),
      name: basename(root),
      rootPath: root,
      description: await this.readDescription(root),
      files,
      gitBranch,
      gitCommit,
      dependencies,
      languages,
      lastOpenedAt: now(),
    };
  }

  /** ContextProvider interface. */
  readonly id = "project";
  async loadContext(): Promise<JsonObject> {
    const project = await this.load();
    if (!project) return {};
    return project as unknown as JsonObject;
  }

  async save(state: ProjectState): Promise<ProjectState> {
    return { ...state, rootPath: this.workspaceRoot ?? state.rootPath, lastOpenedAt: now() };
  }

  private async collectFiles(root: string, current: string, limit: number, depth = 0): Promise<string[]> {
    if (depth > 8 || limit <= 0) return [];
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
      if (limit <= 0) break;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        const nested = await this.collectFiles(root, full, limit - out.length, depth + 1);
        out.push(...nested);
        limit -= nested.length;
      } else if (entry.isFile()) {
        const rel = relative(root, full).replace(/\\/g, "/");
        out.push(rel);
        limit--;
      }
    }
    return out;
  }

  private detectLanguages(files: string[]): string[] {
    const counts = new Map<string, number>();
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      const lang = LANG_BY_EXT[ext];
      if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
  }

  private async collectDependencies(root: string): Promise<string[]> {
    try {
      const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
      };
      return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    } catch {
      return [];
    }
  }

  private async readDescription(root: string): Promise<string> {
    try {
      const md = await readFile(join(root, "README.md"), "utf8");
      const lines = md.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        if (trimmed.length > 0) return trimmed.slice(0, 200);
      }
    } catch {
      void 0;
    }
    return basename(root);
  }
}

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  return norm.split("/").filter(Boolean).pop() ?? path;
}
