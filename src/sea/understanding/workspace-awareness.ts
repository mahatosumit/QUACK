import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type WorkspaceHealth } from "../types.js";

export class WorkspaceAwareness {
  constructor(private readonly sl: SemanticLayer) {}

  async assess(): Promise<WorkspaceHealth> {
    const metadata = this.sl.getMetadata();
    const files = this.sl.getFiles();
    const isIndexed = this.sl.isIndexed();
    const indexer = this.sl["indexer"];

    const staleIndex = isIndexed && indexer ? indexer.isStale(120_000) : false;
    const symbolDb = this.sl.symbolDb;
    const symbolStats = await symbolDb.stats();

    const buildErrors: string[] = [];
    const lintErrors: string[] = [];
    const recommendations: string[] = [];

    if (metadata) {
      const hasTsConfig = files.some((f) => f.relativePath === "tsconfig.json");
      if (hasTsConfig) {
        const tsc = await this.sl.validator.typeCheck();
        buildErrors.push(...tsc);
        if (tsc.length > 0) recommendations.push("Fix TypeScript errors");
      }

      const hasEslint = files.some((f) => f.relativePath.includes(".eslintrc"));
      if (hasEslint) {
        const lint = await this.sl.validator.lint();
        lintErrors.push(...lint);
        if (lint.length > 0) recommendations.push("Fix lint errors");
      }
    }

    if (staleIndex) recommendations.push("Re-index workspace");

    if (symbolStats.totalSymbols === 0) recommendations.push("Index symbols for navigation");

    const score = this.computeScore(isIndexed, staleIndex, buildErrors.length, lintErrors.length);

    return {
      score,
      totalFiles: files.length,
      totalSymbols: symbolStats.totalSymbols,
      indexed: isIndexed,
      staleIndex,
      buildErrors,
      lintErrors,
      testFailures: 0,
      uncoveredFiles: [],
      recommendations,
    };
  }

  private computeScore(indexed: boolean, stale: boolean, buildErrCount: number, lintErrCount: number): number {
    let score = 10;
    if (!indexed) score -= 3;
    if (stale) score -= 1;
    if (buildErrCount > 0) score -= Math.min(buildErrCount, 4);
    if (lintErrCount > 0) score -= Math.min(lintErrCount, 2);
    return Math.max(0, score);
  }
}
