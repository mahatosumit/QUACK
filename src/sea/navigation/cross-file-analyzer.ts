import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type CrossFileImpact } from "../types.js";

export class CrossFileAnalyzer {
  constructor(private readonly sl: SemanticLayer) {}

  async analyzeImpact(symbol: string, file: string): Promise<CrossFileImpact> {
    const depGraph = this.sl.depGraph;
    const search = this.sl.search;

    const refResults = await search.referenceSearch({ query: symbol, mode: "reference" });
    const refFiles = [...new Set(refResults.map((r) => r.file))];

    const directDependents = depGraph.getDependents(file).slice(0, 30);
    const transitiveSet = new Set<string>();

    const queue = [...directDependents];
    const visited = new Set<string>([file]);
    while (queue.length > 0 && transitiveSet.size < 200) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      transitiveSet.add(current);
      const nextDeps = depGraph.getDependents(current);
      for (const d of nextDeps) {
        if (!visited.has(d)) queue.push(d);
      }
    }

    const totalImpact = refFiles.length + transitiveSet.size;
    let riskLevel: CrossFileImpact["riskLevel"] = "low";
    if (totalImpact > 50) riskLevel = "critical";
    else if (totalImpact > 20) riskLevel = "high";
    else if (totalImpact > 5) riskLevel = "medium";

    return {
      symbol,
      file,
      directDependents,
      transitiveDependents: [...transitiveSet],
      totalImpact,
      riskLevel,
    };
  }

  async findRelatedFiles(filePath: string): Promise<string[]> {
    const depGraph = this.sl.depGraph;
    const deps = depGraph.getDependencies(filePath).map((d) => d.targetFile);
    const dependents = depGraph.getDependents(filePath);
    return [...new Set([...deps, ...dependents])];
  }
}
