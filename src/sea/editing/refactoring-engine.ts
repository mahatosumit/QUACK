import { type Brain } from "../../brain/brain.js";
import { type EventBus } from "../../events/event-bus.js";
import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type EditOperation, type EditingPlan, type EditingResult, type SeaConfig } from "../types.js";
import { IncrementalEditor } from "./incremental-editor.js";
import { EditingWorkflow } from "./editing-workflow.js";

export class RefactoringEngine {
  private incrementalEditor: IncrementalEditor;
  private editingWorkflow: EditingWorkflow;

  constructor(
    private readonly brain: Brain,
    private readonly sl: SemanticLayer,
    private readonly eventBus: EventBus,
    private readonly config: SeaConfig,
  ) {
    this.incrementalEditor = new IncrementalEditor(sl);
    this.editingWorkflow = new EditingWorkflow(brain, sl, eventBus, config);
  }

  async renameSymbol(oldName: string, newName: string, scope?: string): Promise<EditingResult> {
    const symbolDb = this.sl.symbolDb;
    const matches = await symbolDb.getByName(oldName);
    const operations: EditOperation[] = [];
    const processedFiles = new Set<string>();

    for (const sym of matches) {
      if (scope && !sym.filePath.startsWith(scope)) continue;
      if (processedFiles.has(sym.filePath)) continue;
      processedFiles.add(sym.filePath);

      const content = await this.readFile(sym.filePath);
      if (!content) continue;

      const newContent = content.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
      if (newContent !== content) {
        operations.push({
          path: sym.filePath,
          originalContent: content,
          newContent,
          description: `Rename ${oldName} -> ${newName} in ${sym.filePath}`,
        });
      }
    }

    const plan: EditingPlan = {
      goal: `Rename symbol ${oldName} to ${newName}`,
      operations,
      affectedFiles: [...processedFiles],
      riskAssessment: operations.length > 10 ? "high" : "medium",
      requiresReview: operations.length > 5,
      requiredPermissions: ["workspace.read", "workspace.write"],
    };

    return this.editingWorkflow.execute(plan);
  }

  async extractMethod(sourceFile: string, methodName: string, newFile: string): Promise<EditingResult> {
    const content = await this.readFile(sourceFile);
    if (!content) throw new Error(`Cannot read ${sourceFile}`);

    const methodRegex = new RegExp(`(?:async\\s+)?(?:function|def|const)\\s+${methodName}\\s*[=(]`, "m");
    const match = methodRegex.exec(content);
    if (!match) throw new Error(`Method ${methodName} not found in ${sourceFile}`);

    const insertionPoint = content.lastIndexOf("\nimport") >= 0
      ? content.indexOf("\n\n", content.lastIndexOf("\nimport")) + 1
      : content.indexOf("\n") + 1;

    const importLine = `import { ${methodName} } from "./${newFile.replace(/\.(ts|js)$/, "")}";\n`;

    const operations: EditOperation[] = [
      {
        path: newFile,
        originalContent: "",
        newContent: `// Extracted from ${sourceFile}\n${match[0]}\n`,
        description: `Create new file with extracted ${methodName}`,
      },
      {
        path: sourceFile,
        originalContent: content,
        newContent: content.slice(0, insertionPoint) + importLine + content.slice(insertionPoint).replace(match[0], ""),
        description: `Replace ${methodName} with import in ${sourceFile}`,
      },
    ];

    const plan: EditingPlan = {
      goal: `Extract ${methodName} to ${newFile}`,
      operations,
      affectedFiles: [sourceFile, newFile],
      riskAssessment: "medium",
      requiresReview: true,
      requiredPermissions: ["workspace.read", "workspace.write"],
    };

    return this.editingWorkflow.execute(plan);
  }

  private async readFile(path: string): Promise<string | undefined> {
    try {
      const { readFile } = await import("node:fs/promises");
      return await readFile(path, "utf-8");
    } catch {
      return undefined;
    }
  }
}
