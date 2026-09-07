import { type SemanticLayer } from "../../intelligence/semantic-layer.js";

export class DependencyAnalyzer {
  constructor(private readonly sl: SemanticLayer) {}

  async getModuleDependencies(modulePath: string): Promise<{
    module: string;
    dependencies: string[];
    dependents: string[];
    cycles: string[][];
    stats: { totalFiles: number; totalDeps: number; entryPoints: number };
  }> {
    const depGraph = this.sl.depGraph;
    const files = this.sl.getFiles();
    const moduleFiles = files.filter((f) => f.relativePath.startsWith(modulePath));

    const allDeps = new Set<string>();
    const allDependents = new Set<string>();

    for (const f of moduleFiles) {
      for (const dep of depGraph.getDependencies(f.relativePath)) {
        if (!dep.targetFile.startsWith(modulePath)) {
          allDeps.add(dep.targetFile);
        }
      }
      for (const dep of depGraph.getDependents(f.relativePath)) {
        if (!dep.startsWith(modulePath)) {
          allDependents.add(dep);
        }
      }
    }

    const cycles = depGraph.detectCircularDependencies().filter((c) =>
      c.some((f) => f.startsWith(modulePath)),
    );

    const stats = depGraph.getStats();

    return {
      module: modulePath,
      dependencies: [...allDeps].slice(0, 50),
      dependents: [...allDependents].slice(0, 50),
      cycles,
      stats: { totalFiles: stats.totalFiles, totalDeps: stats.totalDeps, entryPoints: stats.entryPoints },
    };
  }

  async findImportPath(fromFile: string, toFile: string): Promise<string[] | undefined> {
    return this.sl.depGraph.findImportPath(fromFile, toFile);
  }

  async getArchitectureViolations(): Promise<Array<{ from: string; to: string; reason: string }>> {
    const depGraph = this.sl.depGraph;
    const files = this.sl.getFiles();

    const violations: Array<{ from: string; to: string; reason: string }> = [];
    const layerMap = this.buildLayerMap(files.map((f) => f.relativePath));

    for (const [file, layer] of layerMap) {
      if (layer === "infrastructure") continue;
      const deps = depGraph.getDependencies(file);
      for (const dep of deps) {
        const depLayer = layerMap.get(dep.targetFile);
        if (depLayer && !this.isValidDependency(layer, depLayer)) {
          violations.push({
            from: file,
            to: dep.targetFile,
            reason: `${layer} layer should not depend on ${depLayer} layer`,
          });
        }
      }
    }

    return violations;
  }

  private buildLayerMap(paths: readonly string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of paths) {
      if (p.startsWith("ui") || p.startsWith("components") || p.startsWith("pages") || p.startsWith("views")) {
        map.set(p, "presentation");
      } else if (p.startsWith("app") || p.startsWith("usecase") || p.startsWith("service") || p.startsWith("controllers")) {
        map.set(p, "application");
      } else if (p.startsWith("domain") || p.startsWith("core") || p.startsWith("model") || p.startsWith("entity")) {
        map.set(p, "domain");
      } else {
        map.set(p, "infrastructure");
      }
    }
    return map;
  }

  private isValidDependency(fromLayer: string, toLayer: string): boolean {
    const rules: Record<string, string[]> = {
      presentation: ["application", "domain"],
      application: ["domain"],
      domain: [],
      infrastructure: ["domain", "application", "presentation"],
    };
    const allowed = rules[fromLayer] ?? [];
    return allowed.includes(toLayer);
  }
}
