import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type RepositorySummary, type ArchitectureLayer } from "../types.js";

export class ArchitectureAnalyzer {
  constructor(private readonly sl: SemanticLayer) {}

  async analyze(): Promise<RepositorySummary> {
    const files = this.sl.getFiles();
    const depGraph = this.sl.depGraph;
    const stats = depGraph.getStats();
    const moduleGraph = depGraph.getModuleGraph();
    const languages = new Set<string>();
    let lineCount = 0;

    for (const f of files) {
      languages.add(f.language);
      lineCount += f.lines;
    }

    const layers = this.detectLayers(files.map((f) => f.relativePath), moduleGraph);

    return {
      root: this.sl["config"]?.workspaceRoot ?? "",
      name: this.sl["config"]?.workspaceRoot?.split(/[/\\]/).pop() ?? "unknown",
      languages: [...languages],
      fileCount: files.length,
      lineCount,
      packages: [],
      buildSystems: ["unknown"],
      testFrameworks: ["node:test"],
      entryPoints: depGraph.getEntryPoints(),
      architectureLayers: layers,
      modules: Object.keys(moduleGraph),
    };
  }

  private detectLayers(paths: readonly string[], moduleGraph: Record<string, string[]>): ArchitectureLayer[] {
    const layers: ArchitectureLayer[] = [];
    const patterns: Record<string, { name: string; layer: ArchitectureLayer["layer"]; keywords: string[] }> = {
      presentation: { name: "Presentation", layer: "presentation", keywords: ["ui", "components", "pages", "views", "screens"] },
      application: { name: "Application", layer: "application", keywords: ["app", "usecase", "service", "controller", "handler"] },
      domain: { name: "Domain", layer: "domain", keywords: ["domain", "model", "entity", "core", "business"] },
      infrastructure: { name: "Infrastructure", layer: "infrastructure", keywords: ["infra", "db", "database", "repository", "cache", "storage"] },
    };

    for (const [key, info] of Object.entries(patterns)) {
      const matched = paths.filter((p) => info.keywords.some((k) => p.includes(k)));
      if (matched.length === 0) continue;
      layers.push({
        name: info.name,
        path: matched[0]?.split("/")[0] ?? "",
        description: `${info.name} layer with ${matched.length} files`,
        dependencies: Object.keys(moduleGraph).filter((m) => matched.some((p) => p.startsWith(m))),
        files: matched.slice(0, 20),
        layer: info.layer,
      });
    }

    if (layers.length === 0) {
      layers.push({
        name: "Default",
        path: "/",
        description: "No layered architecture detected",
        dependencies: [],
        files: paths.slice(0, 20),
        layer: "unknown",
      });
    }

    return layers;
  }
}
