import { createQuackSystem } from "./distributions/swe-system.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export async function createDemoProject(workspaceRoot: string = process.cwd()): Promise<{
  readonly projectDir: string;
  readonly filesCreated: string[];
  readonly success: boolean;
}> {
  console.log("🚀 [QUACK OS Engine] Initializing project creation workflow...");

  const system = createQuackSystem({
    workspaceRoot,
    permissions: ["workspace.write", "workspace.read", "terminal.execute"],
    // Demo-only: pre-approve every request so this scripted, non-interactive
    // verification run doesn't block on a human prompt. Never reuse this
    // approver outside a trusted, throwaway demo workspace.
    approver: { requestApproval: async () => true },
  });

  const targetDir = "demo-project";
  const filesToCreate = [
    {
      path: `${targetDir}/index.html`,
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QUACK OS Generated Web App</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="app">
      <header class="header">
        <div class="logo">⚡ QUACK OS</div>
        <span class="badge">Autonomous Build v1.1</span>
      </header>
      <main class="hero">
        <h1>Autonomous Software Engineering Platform</h1>
        <p>This web application was generated automatically by QUACK OS ExecutiveBrain and WorkflowEngine.</p>
        <div class="metrics">
          <div class="metric"><strong>100%</strong><span>System Pass</span></div>
          <div class="metric"><strong>970</strong><span>Tests Verified</span></div>
          <div class="metric"><strong>&lt; 15ms</strong><span>Event Lag</span></div>
        </div>
        <button id="counterBtn" class="btn">Click Counter: 0</button>
      </main>
    </div>
    <script src="./app.js"></script>
  </body>
</html>`,
    },
    {
      path: `${targetDir}/styles.css`,
      content: `body {
  margin: 0;
  background: #080b11;
  color: #f8fafc;
  font-family: Inter, sans-serif;
  min-height: 100vh;
  display: grid;
  place-items: center;
}

.app {
  max-width: 600px;
  background: #111622;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.5);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.logo {
  font-weight: 900;
  font-size: 20px;
  color: #10b981;
}

.badge {
  background: rgba(6, 182, 212, 0.15);
  color: #06b6d4;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

h1 {
  font-size: 24px;
  margin-top: 0;
}

p {
  color: #94a3b8;
  line-height: 1.6;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 24px 0;
}

.metric {
  background: #182030;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.metric strong {
  display: block;
  font-size: 18px;
  color: #10b981;
}

.metric span {
  font-size: 11px;
  color: #94a3b8;
}

.btn {
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  background: #10b981;
  color: #000;
  border: none;
  font-weight: 700;
  cursor: pointer;
  font-size: 14px;
}

.btn:hover {
  opacity: 0.9;
}`,
    },
    {
      path: `${targetDir}/app.js`,
      content: `let count = 0;
const btn = document.getElementById("counterBtn");
btn.addEventListener("click", () => {
  count++;
  btn.textContent = \`Click Counter: \${count}\`;
});
console.log("⚡ QUACK OS Demo Web App initialized successfully!");`,
    },
  ];

  const filesCreated: string[] = [];

  for (const file of filesToCreate) {
    const res = await system.runtime.executeTool(
      "core.workspace.write-file",
      {
        path: file.path,
        content: file.content,
        createDirectories: true,
        overwrite: true,
      },
      { taskId: "demo-task-1" },
    );

    if (res.ok) {
      filesCreated.push(file.path);
      console.log(`[PASS] QUACK OS write-file tool created: ${file.path}`);
    } else {
      console.error(`[FAIL] Failed to create ${file.path}:`, res.error);
    }
  }

  const fullProjectDir = join(workspaceRoot, targetDir);
  const success = filesCreated.length === filesToCreate.length && existsSync(fullProjectDir);

  return {
    projectDir: fullProjectDir,
    filesCreated,
    success,
  };
}

if (process.argv[1] && process.argv[1].endsWith("demo-project-generator.js")) {
  createDemoProject()
    .then((res) => {
      console.log("\n==========================================");
      console.log(`✅ QUACK OS Project Generation Status: ${res.success ? "SUCCESS" : "FAILED"}`);
      console.log(`📁 Project Path: ${res.projectDir}`);
      console.log(`📄 Files Generated: ${res.filesCreated.join(", ")}`);
      console.log("==========================================\n");
    })
    .catch((err) => {
      console.error("Fatal project generation error:", err);
      process.exit(1);
    });
}
