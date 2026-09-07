import { now } from "../../core/types.js";
import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type EngineeringReport, type ReportSection, type ReportType } from "../types.js";

export class EngineeringReporter {
  constructor(private readonly sl: SemanticLayer) {}

  async generate(type: ReportType): Promise<EngineeringReport> {
    switch (type) {
      case "architecture": return this.architectureReport();
      case "dependencies": return this.dependencyReport();
      case "workspace-health": return this.healthReport();
      case "technical-debt": return this.debtReport();
      case "test": return this.testReport();
      default: return this.architectureReport();
    }
  }

  private async architectureReport(): Promise<EngineeringReport> {
    const depGraph = this.sl.depGraph;
    const stats = depGraph.getStats();
    const cycles = depGraph.detectCircularDependencies();
    const moduleGraph = depGraph.getModuleGraph();

    const sections: ReportSection[] = [
      {
        title: "Overview",
        content: `Total files: ${stats.totalFiles}, Dependencies: ${stats.totalDeps}, Entry points: ${stats.entryPoints}`,
        metrics: { files: stats.totalFiles, deps: stats.totalDeps, entryPoints: stats.entryPoints },
      },
      {
        title: "Module Dependencies",
        content: Object.entries(moduleGraph).map(([mod, deps]) => `${mod} → ${deps.join(", ") || "(none)"}`).join("\n"),
      },
      {
        title: "Circular Dependencies",
        content: cycles.length > 0 ? cycles.map((c) => c.join(" → ")).join("\n") : "None detected.",
        severity: cycles.length > 0 ? "warning" : "info",
        metrics: { cycles: cycles.length },
      },
    ];

    return {
      type: "architecture",
      title: "Architecture Report",
      generatedAt: now(),
      workspaceRoot: this.sl["config"]?.workspaceRoot ?? "",
      sections,
      summary: `${stats.totalFiles} files, ${stats.totalDeps} dependencies, ${cycles.length} circular dependencies.`,
      recommendations: cycles.length > 0 ? ["Resolve circular dependencies by extracting shared interfaces."] : [],
    };
  }

  private async dependencyReport(): Promise<EngineeringReport> {
    const depGraph = this.sl.depGraph;
    const stats = depGraph.getStats();
    const cycles = depGraph.detectCircularDependencies();
    const moduleGraph = depGraph.getModuleGraph();
    const entryPoints = depGraph.getEntryPoints();

    const sections: ReportSection[] = [
      {
        title: "Dependency Statistics",
        content: `Total files: ${stats.totalFiles}, Average deps/file: ${(stats.totalDeps / Math.max(1, stats.totalFiles)).toFixed(2)}`,
        metrics: { totalFiles: stats.totalFiles, totalDeps: stats.totalDeps, avgDepsPerFile: stats.totalDeps / Math.max(1, stats.totalFiles) },
      },
      {
        title: "Entry Points",
        content: entryPoints.join("\n") || "None detected.",
      },
      {
        title: "Circular Dependencies",
        content: cycles.length > 0 ? cycles.map((c) => c.join(" → ")).join("\n\n") : "None detected.",
        severity: cycles.length > 0 ? "error" : "info",
      },
    ];

    return {
      type: "dependencies",
      title: "Dependency Analysis Report",
      generatedAt: now(),
      workspaceRoot: this.sl["config"]?.workspaceRoot ?? "",
      sections,
      summary: `Analyzed ${stats.totalFiles} files with ${stats.totalDeps} dependency edges.`,
      recommendations: cycles.length > 0 ? ["Break circular dependencies with dependency inversion."] : [],
    };
  }

  private async healthReport(): Promise<EngineeringReport> {
    const files = this.sl.getFiles();
    const symbolStats = await this.sl.symbolDb.stats();
    const metadata = this.sl.getMetadata();
    const indexed = this.sl.isIndexed();

    const sections: ReportSection[] = [
      {
        title: "Workspace Overview",
        content: `Indexed: ${indexed ? "Yes" : "No"}\nFiles: ${files.length}\nSymbols: ${symbolStats.totalSymbols}\nLanguages: ${(metadata?.languages ?? []).join(", ")}`,
        metrics: { indexed: indexed ? 1 : 0, files: files.length, symbols: symbolStats.totalSymbols },
      },
      {
        title: "Symbols by Kind",
        content: Object.entries(symbolStats.byKind).map(([kind, count]) => `${kind}: ${count}`).join("\n"),
      },
      {
        title: "Top Files by Symbol Count",
        content: symbolStats.topFiles.map((f) => `${f.path}: ${f.count} symbols`).join("\n"),
        severity: "info",
      },
    ];

    return {
      type: "workspace-health",
      title: "Workspace Health Report",
      generatedAt: now(),
      workspaceRoot: this.sl["config"]?.workspaceRoot ?? "",
      sections,
      summary: `Workspace has ${files.length} files with ${symbolStats.totalSymbols} symbols.`,
      recommendations: indexed ? [] : ["Run workspace indexing to enable full navigation."],
    };
  }

  private async debtReport(): Promise<EngineeringReport> {
    const files = this.sl.getFiles();
    const contributors: ReportSection[] = [];

    const largeFiles = files.filter((f) => f.lines > 500).slice(0, 10);
    if (largeFiles.length > 0) {
      contributors.push({
        title: "Large Files (>500 lines)",
        content: largeFiles.map((f) => `${f.relativePath}: ${f.lines} lines`).join("\n"),
        severity: "warning",
      });
    }

    return {
      type: "technical-debt",
      title: "Technical Debt Report",
      generatedAt: now(),
      workspaceRoot: this.sl["config"]?.workspaceRoot ?? "",
      sections: contributors,
      summary: `${largeFiles.length} large files identified as potential refactoring targets.`,
      recommendations: largeFiles.length > 0 ? [`Refactor ${largeFiles[0].relativePath} (${largeFiles[0].lines} lines) into smaller modules.`] : [],
    };
  }

  private async testReport(): Promise<EngineeringReport> {
    const testRunner = this.sl.testRunner;
    const files = this.sl.getFiles();
    const testFiles = await testRunner.discoverTests(files);

    const totalTests = testFiles.reduce((sum, tf) => sum + tf.tests.length, 0);

    const sections: ReportSection[] = [
      {
        title: "Test Overview",
        content: `Test files: ${testFiles.length}\nTest cases: ${totalTests}`,
        metrics: { testFiles: testFiles.length, testCases: totalTests },
      },
    ];

    for (const tf of testFiles.slice(0, 10)) {
      sections.push({
        title: tf.path,
        content: tf.tests.map((tc) => `  ✓ ${tc.name} (line ${tc.line})`).join("\n"),
        severity: "info",
      });
    }

    return {
      type: "test",
      title: "Test Report",
      generatedAt: now(),
      workspaceRoot: this.sl["config"]?.workspaceRoot ?? "",
      sections,
      summary: `Discovered ${testFiles.length} test files with ${totalTests} test cases.`,
      recommendations: totalTests === 0 ? ["Add unit tests for core modules."] : [],
    };
  }
}
