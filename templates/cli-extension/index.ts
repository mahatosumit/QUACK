import { Command } from "commander";
import { QuackRuntime, ExecutiveBrain } from "@quack/os";

const program = new Command();

program
  .name("quack-custom")
  .description("A custom CLI extension for QUACK OS")
  .version("1.0.0");

program
  .command("analyze")
  .argument("<path>", "Path to analyze")
  .action(async (path) => {
    // 1. Boot OS Kernel
    const runtime = await QuackRuntime.create({ workspaceRoot: path, dataDir: "./.quack" });
    const brain = new ExecutiveBrain(runtime);
    
    // 2. Execute Goal
    console.log(`Analyzing workspace at ${path}...`);
    await brain.executeGoal("Analyze the workspace and generate an architecture report.");
    
    console.log("Analysis complete.");
  });

program.parse();
