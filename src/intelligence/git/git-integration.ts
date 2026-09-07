import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type EventBus } from "../../events/event-bus.js";

export interface GitDiffEntry {
  readonly file: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly additions: number;
  readonly deletions: number;
}

export interface GitCommitInfo {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly message: string;
  readonly files: readonly string[];
}

export interface GitStatus {
  readonly branch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
  readonly clean: boolean;
}

export interface GitBlameLine {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly line: number;
  readonly content: string;
}

/**
 * GitIntegration provides comprehensive git operations for the workspace.
 * All operations are read-only unless explicitly stated (commit, stage).
 */
export class GitIntegration {
  constructor(
    private readonly workspaceRoot: string,
    private readonly eventBus?: EventBus,
  ) {}

  isRepo(): boolean {
    return existsSync(resolve(this.workspaceRoot, ".git"));
  }

  getStatus(): GitStatus {
    this.assertRepo();
    const branch = this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const aheadBehind = this.execGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).trim() || "0\t0";
    const [ahead, behind] = aheadBehind.split("\t").map(Number);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    const statusOutput = this.execGit(["status", "--porcelain"]).trim();
    if (statusOutput) {
      for (const line of statusOutput.split("\n")) {
        const status = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (status === "??") untracked.push(file);
        else if (status[0] !== " ") staged.push(file);
        if (status[1] !== " " && status[1] !== "?") unstaged.push(file);
      }
    }

    return {
      branch,
      ahead: Math.max(0, ahead || 0),
      behind: Math.max(0, behind || 0),
      staged,
      unstaged,
      untracked,
      clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
    };
  }

  getDiff(target = "HEAD"): string {
    this.assertRepo();
    return this.execGit(["diff", target, "--no-color"]).trim();
  }

  getDiffForFile(file: string, staged = false): string {
    this.assertRepo();
    const args = ["diff"];
    if (staged) args.push("--staged");
    args.push("--no-color", "--", file);
    return this.execGit(args).trim();
  }

  getLog(maxCount = 10): GitCommitInfo[] {
    this.assertRepo();
    const format = "--format=%H|%an|%ad|%s";
    const output = this.execGit(["log", `-${maxCount}`, format, "--date=short"]).trim();
    if (!output) return [];

    return output.split("\n").map((line) => {
      const [hash, author, date, ...msgParts] = line.split("|");
      const files = this.execGit(["log", "--name-only", "--oneline", "-1", hash]).trim().split("\n").slice(1);
      return { hash, author, date, message: msgParts.join("|"), files };
    });
  }

  getBlame(file: string, startLine?: number, endLine?: number): GitBlameLine[] {
    this.assertRepo();
    const args = ["blame"];
    if (startLine && endLine) {
      args.push("-L", `${startLine},${endLine}`);
    }
    args.push("--line-porcelain", file);
    const output = this.execGit(args).trim();
    if (!output) return [];

    const blame: GitBlameLine[] = [];
    const lines = output.split("\n");
    let i = 0;

    while (i < lines.length) {
      const header = lines[i].match(/^(\w+)\s+(\d+)\s+(\d+)/);
      if (!header) { i++; continue; }
      const hash = header[1];
      const lineNum = Number(header[2]);

      i++;
      let author = "", date = "", content = "";
      while (i < lines.length) {
        if (lines[i].startsWith("author ")) author = lines[i].slice(7);
        else if (lines[i].startsWith("author-time ")) date = new Date(Number(lines[i].slice(12)) * 1000).toISOString().split("T")[0];
        else if (lines[i].startsWith("\t")) { content = lines[i].slice(1); i++; break; }
        i++;
      }

      blame.push({ hash, author, date, line: lineNum, content });
    }

    return blame;
  }

  getBranch(): string {
    if (!this.isRepo()) return "no-repo";
    const b = this.execGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    return b || "no-branch";
  }

  getCurrentChangesSummary(): string {
    this.assertRepo();
    const status = this.getStatus();
    const parts: string[] = [];

    if (status.staged.length > 0) parts.push(`Staged: ${status.staged.length} files`);
    if (status.unstaged.length > 0) parts.push(`Unstaged: ${status.unstaged.length} files`);
    if (status.untracked.length > 0) parts.push(`Untracked: ${status.untracked.length} files`);

    const diff = this.getDiff();
    if (diff) {
      const added = (diff.match(/^\+/gm)?.length ?? 0) - (diff.match(/^\+\+\+/gm)?.length ?? 0);
      const removed = (diff.match(/^-/gm)?.length ?? 0) - (diff.match(/^---/gm)?.length ?? 0);
      parts.push(`Changes: +${Math.max(0, added)} -${Math.max(0, removed)} lines`);
    }

    return parts.join(" | ") || "Clean working tree";
  }

  stage(files: string[]): void {
    this.assertRepo();
    this.execGit(["add", ...files]);
  }

  unstage(files: string[]): void {
    this.assertRepo();
    this.execGit(["reset", "HEAD", "--", ...files]);
  }

  commit(message: string): string {
    this.assertRepo();
    return this.execGit(["commit", "-m", message]).trim();
  }

  restore(files: string[]): void {
    this.assertRepo();
    this.execGit(["checkout", "--", ...files]);
  }

  getFileHistory(file: string): GitCommitInfo[] {
    this.assertRepo();
    const format = "--format=%H|%an|%ad|%s";
    const output = this.execGit(["log", "--follow", "-20", format, "--date=short", "--", file]).trim();
    if (!output) return [];
    return output.split("\n").map((line) => {
      const [hash, author, date, ...msgParts] = line.split("|");
      return { hash, author, date, message: msgParts.join("|"), files: [file] };
    });
  }

  push(branch?: string): void {
    this.assertRepo();
    const b = branch ?? this.getBranch();
    this.execGit(["push", "origin", b]);
  }

  private execGit(args: string[]): string {
    try {
      return execFileSync("git", args, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).toString();
    } catch {
      return "";
    }
  }

  private assertRepo(): void {
    if (!this.isRepo()) throw new Error("Not a git repository");
  }
}
