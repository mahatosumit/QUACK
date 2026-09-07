import { type Language } from "../types.js";

const EXTENSION_MAP: Readonly<Record<string, Language>> = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".rs": "rust", ".go": "go", ".java": "java",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp", ".cxx": "cpp",
  ".cs": "csharp", ".rb": "ruby", ".php": "php", ".swift": "swift",
  ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".md": "markdown", ".mdx": "markdown",
  ".json": "json", ".jsonc": "json", ".yaml": "yaml", ".yml": "yaml",
  ".html": "html", ".htm": "html", ".css": "css", ".scss": "css",
  ".sql": "sql", ".proto": "proto",
};

const SHEBANG_MAP: Readonly<Record<string, Language>> = {
  "python": "python", "python3": "python",
  "node": "javascript", "deno": "javascript", "bun": "javascript",
  "bash": "shell", "sh": "shell", "zsh": "shell",
  "rustc": "rust", "go": "go",
};

export const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", "target", ".next",
  ".quack", "coverage", ".nyc_output", "__pycache__", ".cache",
  ".venv", "venv", ".env", "env", "vendor", ".bundle",
  ".gradle", ".idea", ".vscode", ".DS_Store", "out",
]);

export const IGNORED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".mp3", ".avi", ".mov", ".wav", ".flac",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".wasm",
  ".map", ".min.js", ".min.css",
]);

export function detectLanguage(filePath: string, content?: string): Language {
  const lower = filePath.toLowerCase();
  for (const [ext, lang] of Object.entries(EXTENSION_MAP)) {
    if (lower.endsWith(ext)) return lang;
  }
  if (content) {
    const firstLine = content.split("\n")[0]?.trim();
    if (firstLine?.startsWith("#!")) {
      const interpreter = firstLine.slice(2).trim().split(/[/ ]/).pop() || "";
      return SHEBANG_MAP[interpreter] ?? "unknown";
    }
  }
  return "unknown";
}

export function shouldIgnore(path: string, fileName: string): boolean {
  if (IGNORED_DIRECTORIES.has(fileName)) return true;
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = fileName.slice(dotIdx).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return true;
  }
  return false;
}
