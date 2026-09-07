import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type RepositorySummary } from "../types.js";

export class RepositoryUnderstanding {
  constructor(private readonly sl: SemanticLayer) {}

  async summarize(): Promise<RepositorySummary> {
    const files = this.sl.getFiles();
    const metadata = this.sl.getMetadata();
    const symbols: any[] = [];
    const depGraph = this.sl.depGraph;

    const languages = new Set<string>();
    let lineCount = 0;
    for (const f of files) {
      languages.add(f.language);
      lineCount += f.lines;
    }

    const buildSystems = metadata
      ? metadata.buildSystems.map((b) => String(b))
      : ["unknown"];

    const entryPoints = depGraph.getEntryPoints();
    const stats = depGraph.getStats();
    const moduleGraph = depGraph.getModuleGraph();

    return {
      root: this.sl["config"]?.workspaceRoot ?? "",
      name: this.sl["config"]?.workspaceRoot?.split(/[/\\]/).pop() ?? "unknown",
      languages: [...languages],
      fileCount: files.length,
      lineCount,
      packages: metadata?.name ? [metadata.name] : ["unknown"],
      buildSystems,
      testFrameworks: ["node:test"],
      entryPoints,
      architectureLayers: [],
      modules: Object.keys(moduleGraph),
    };
  }
}
