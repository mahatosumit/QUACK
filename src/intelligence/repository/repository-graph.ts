import { createId } from "../../core/types.js";
import {
  type Dependency, type DependencyType, type FileInfo,
  type Language, type ModuleInfo, type ModuleRef,
  type BuildSystem, type PackageInfo, type PackageDependency,
  type SymbolInfo, type WorkspaceMetadata,
} from "../types.js";
import { detectLanguage, shouldIgnore } from "../languages/language-detector.js";

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, dirname, basename, extname, sep } from "node:path";

// ------------------------------------------------------------------
// Workspace Scanner
// ------------------------------------------------------------------

export async function scanFiles(root: string, maxDepth = 50): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch { return; }

    for (const name of entries) {
      if (shouldIgnore(dir, name)) continue;
      const fullPath = resolve(dir, name);
      let entryStat;
      try { entryStat = await stat(fullPath); } catch { continue; }

      if (entryStat.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entryStat.isFile() && entryStat.size > 0) {
        const language = detectLanguage(fullPath);
        if (language === "unknown") continue;
        const content = await readFile(fullPath, "utf-8").catch(() => "");
        files.push({
          path: fullPath,
          relativePath: sep === "\\" ? relative(root, fullPath).replace(/\\/g, "/") : relative(root, fullPath),
          language,
          size: entryStat.size,
          lines: content ? content.split("\n").length : 0,
          modifiedAt: entryStat.mtime.toISOString(),
          isDirectory: false,
        });
      }
    }
  }

  await walk(root, 0);
  return files;
}

// ------------------------------------------------------------------
// Language detection for project
// ------------------------------------------------------------------

export function detectLanguages(files: readonly FileInfo[]): Language[] {
  const set = new Set<Language>();
  for (const f of files) set.add(f.language);
  return [...set];
}

// ------------------------------------------------------------------
// Build system detection
// ------------------------------------------------------------------

export async function detectBuildSystems(root: string): Promise<BuildSystem[]> {
  const systems: BuildSystem[] = [];
  const checks: [string, BuildSystem][] = [
    ["tsconfig.json", "tsc"],
    ["vite.config.ts", "vite"], ["vite.config.js", "vite"],
    ["webpack.config.js", "webpack"], ["webpack.config.ts", "webpack"],
    ["esbuild.config.js", "esbuild"],
    ["rollup.config.js", "rollup"],
    ["Cargo.toml", "cargo"],
    ["go.mod", "go"],
    ["pom.xml", "maven"], ["build.gradle", "gradle"],
    ["Makefile", "make"], ["CMakeLists.txt", "cmake"],
    ["setup.py", "pip"], ["pyproject.toml", "poetry"],
    ["package.json", "npm"],
  ];
  for (const [file, system] of checks) {
    try {
      await stat(resolve(root, file));
      systems.push(system);
    } catch { /* continue */ }
  }
  // deduplicate npm/yarn/pnpm/bun
  if (systems.includes("npm")) {
    const pkgPath = resolve(root, "package.json");
    try {
      const content = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(content);
      if (pkg.packageManager?.startsWith("yarn")) {
        systems[systems.indexOf("npm")] = "yarn";
      } else if (pkg.packageManager?.startsWith("pnpm")) {
        systems[systems.indexOf("npm")] = "pnpm";
      } else if (pkg.packageManager?.startsWith("bun")) {
        systems[systems.indexOf("npm")] = "bun";
      }
    } catch { /* use npm */ }
  }
  return [...new Set(systems)];
}

// ------------------------------------------------------------------
// Dependency extraction from files
// ------------------------------------------------------------------

const IMPORT_PATTERNS: Readonly<Record<string, RegExp[]>> = {
  typescript: [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
    /import\s+type\s+.*\s+from\s+['"]([^'"]+)['"]/g,
  ],
  javascript: [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
  ],
  python: [
    /^import\s+(\S+)/gm,
    /^from\s+(\S+)\s+import/gm,
  ],
  rust: [
    /^use\s+(\S+)/gm,
    /^extern\s+crate\s+(\S+)/gm,
  ],
  go: [
    /"([^"]+)"/g,
  ],
};

export function extractImports(content: string, language: Language): string[] {
  const imports: string[] = [];
  const patterns = IMPORT_PATTERNS[language];
  if (!patterns) return imports;

  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const m of matches) {
      const spec = m[1]?.trim();
      if (spec && !imports.includes(spec)) imports.push(spec);
    }
  }
  return imports;
}

// ------------------------------------------------------------------
// Package detection
// ------------------------------------------------------------------

export async function detectPackage(root: string): Promise<PackageInfo | undefined> {
  const checks: Array<{ file: string; parser: (content: string, filePath: string) => PackageInfo }> = [
    { file: "package.json", parser: parsePackageJson },
    { file: "Cargo.toml", parser: parseCargoToml },
    { file: "go.mod", parser: parseGoMod },
    { file: "pyproject.toml", parser: parsePyprojectToml },
  ];

  for (const { file, parser } of checks) {
    try {
      const content = await readFile(resolve(root, file), "utf-8");
      return parser(content, file);
    } catch { continue; }
  }
  return undefined;
}

function parsePackageJson(content: string, _filePath: string): PackageInfo {
  const pkg = JSON.parse(content);
  const deps: PackageDependency[] = [];
  for (const [name, ver] of Object.entries(pkg.dependencies ?? {})) {
    deps.push({ name, version: String(ver), isDev: false });
  }
  for (const [name, ver] of Object.entries(pkg.devDependencies ?? {})) {
    deps.push({ name, version: String(ver), isDev: true });
  }
  return {
    type: "npm",
    name: pkg.name ?? "unknown",
    version: pkg.version ?? "0.0.0",
    dependencies: deps,
    entryPoints: pkg.main ? [pkg.main] : [],
    scripts: pkg.scripts ?? {},
  };
}

function parseCargoToml(content: string, _filePath: string): PackageInfo {
  const name = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "unknown";
  const version = content.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.0.0";
  const deps: PackageDependency[] = [];
  const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|\z)/)?.[1];
  if (depSection) {
    for (const line of depSection.split("\n")) {
      const m = line.trim().match(/^(\S+)\s*=/);
      if (m) deps.push({ name: m[1], version: "", isDev: false });
    }
  }
  return { type: "cargo", name, version, dependencies: deps, entryPoints: [], scripts: {} };
}

function parseGoMod(content: string, _filePath: string): PackageInfo {
  const name = content.match(/^module\s+(\S+)/m)?.[1] ?? "unknown";
  const deps: PackageDependency[] = [];
  for (const line of content.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+v?([\d.]+)/);
    if (m) deps.push({ name: m[1], version: m[2], isDev: false });
  }
  return { type: "go", name, version: "0.0.0", dependencies: deps, entryPoints: [], scripts: {} };
}

function parsePyprojectToml(content: string, _filePath: string): PackageInfo {
  const name = content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "unknown";
  return { type: "pip", name, version: "0.0.0", dependencies: [], entryPoints: [], scripts: {} };
}

// ------------------------------------------------------------------
// Test framework detection
// ------------------------------------------------------------------

export function detectTestFramework(files: readonly FileInfo[]): string {
  const patterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /vitest\.config/, name: "vitest" },
    { pattern: /jest\.config/, name: "jest" },
    { pattern: /\.mocha/, name: "mocha" },
    { pattern: /\.test\./, name: "node:test" },
    { pattern: /conftest\.py/, name: "pytest" },
    { pattern: /Cargo\.toml/, name: "cargo-test" },
  ];

  for (const f of files) {
    for (const { pattern, name } of patterns) {
      if (pattern.test(f.relativePath)) return name;
    }
  }
  return "unknown";
}

// ------------------------------------------------------------------
// Workspace metadata
// ------------------------------------------------------------------

export async function buildWorkspaceMetadata(root: string, files: readonly FileInfo[], symbols: readonly SymbolInfo[]): Promise<WorkspaceMetadata> {
  const languages = detectLanguages(files);
  const buildSystems = await detectBuildSystems(root);
  const pkg = await detectPackage(root);
  const hasGit = await stat(resolve(root, ".git")).then(() => true).catch(() => false);

  let totalLines = 0;
  for (const f of files) totalLines += f.lines;

  return {
    root,
    name: basename(root),
    languages,
    buildSystems,
    testFrameworks: [],
    fileCount: files.length,
    totalLines,
    directoryCount: new Set(files.map((f) => dirname(f.relativePath))).size,
    packageJson: pkg,
    hasGit,
    gitBranch: undefined,
    lastIndexed: new Date().toISOString(),
    indexedFileCount: files.length,
    totalSymbols: symbols.length,
    totalDependencies: 0,
  };
}
