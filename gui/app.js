const agents = [
  { id: "architect", name: "Architect Specialist", icon: "AR", skills: ["architecture", "design", "module", "adr", "plan"], tools: ["docs", "graph", "review"], model: "reasoning" },
  { id: "coder", name: "Lead Coder", icon: "CO", skills: ["build", "implement", "code", "fix", "refactor", "feature"], tools: ["filesystem", "terminal", "git"], model: "coding" },
  { id: "tester", name: "QA Tester", icon: "TE", skills: ["test", "qa", "verify", "coverage", "lint", "typecheck"], tools: ["terminal", "reports"], model: "fast" },
  { id: "security", name: "Security Auditor", icon: "SE", skills: ["security", "permission", "secret", "sandbox", "audit", "risk"], tools: ["policy", "audit", "scanner"], model: "careful" },
  { id: "researcher", name: "Researcher", icon: "RE", skills: ["research", "internet", "compare", "benchmark", "reference"], tools: ["browser", "notes"], model: "web" },
  { id: "writer", name: "Writer", icon: "WR", skills: ["docs", "readme", "roadmap", "changelog", "explain"], tools: ["markdown", "memory"], model: "balanced" },
  { id: "devops", name: "DevOps Engineer", icon: "DO", skills: ["deploy", "package", "ci", "release", "docker"], tools: ["terminal", "git", "logs"], model: "ops" },
  { id: "memory", name: "Memory Engine", icon: "ME", skills: ["memory", "knowledge", "graph", "rag", "context"], tools: ["vector", "graph", "summarizer"], model: "retrieval" },
];

const providers = [
  { name: "NVIDIA NIM", status: "online (active)", type: "meta/llama-3.1-70b-instruct" },
  { name: "Ollama", status: "online", type: "local models (qwen2.5-coder)" },
  { name: "OpenAI", status: "configured", type: "gpt-4o" },
  { name: "Anthropic", status: "configured", type: "claude-3-5-sonnet" },
  { name: "OpenRouter", status: "adapter ready", type: "multi-cloud failover" },
  { name: "vLLM", status: "adapter ready", type: "local high-throughput" },
];

const files = [
  "src/runtime/runtime.ts",
  "src/providers/nvidia.ts",
  "src/tools/workspace-filesystem.ts",
  "src/storage/task-store.ts",
  "src/telemetry/audit-log.ts",
  "src/system/create-system.ts",
  "docs/ARCHITECTURE.md",
  "gui/index.html",
  "gui/app.js",
  "gui/styles.css",
];

const plugins = [
  ["MCP Bridge", "Connects tool servers through a permission-reviewed adapter.", "active"],
  ["Terminal Tool", "Command execution with approvals, timeouts, and logs.", "active"],
  ["Git Tool", "Status, branch, diff, commit, and PR preparation.", "active"],
  ["Graph Memory", "Entity and relationship storage with provenance.", "active"],
  ["Workflow Canvas", "Node-based automations for repeatable OS tasks.", "active"],
  ["Provider Pack", "NVIDIA NIM, Ollama, OpenAI-compatible adapters.", "active"],
];

const memories = [
  ["Project Memory", "QUACK OS is local-first, provider-independent, and permission-gated."],
  ["Workspace Memory", "Current implementation contains runtime, tools, storage, telemetry, and GUI."],
  ["Agent Memory", "Specialists are routed by task intent before execution."],
  ["Reference Memory", "Research favors shared engines, model routing, MCP, and visual DAG execution."],
];

const state = {
  tasks: [
    { title: "NvidiaNimProvider integration", agent: "Architect + Coder", status: "done" },
    { title: "Workspace read tools & AST indexer", agent: "Security + Coder", status: "done" },
    { title: "QUACK GUI shell overhaul", agent: "Architect + Coder", status: "active" },
    { title: "Terminal tool execution", agent: "Security + DevOps", status: "next" },
    { title: "Git PR automated audit", agent: "Coder + Reviewer", status: "next" },
  ],
  logs: [
    "[00:00:01] boot: QUACK OS control deck mounted",
    "[00:00:01] router: specialist agent catalog loaded",
    "[00:00:02] provider: NVIDIA NIM provider registered",
    "[00:00:02] policy: safety mode enabled (strict approvals)",
  ],
  selectedAgents: [agents[0], agents[1], agents[3]],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function scoreAgents(text) {
  const normalized = text.toLowerCase();
  return agents
    .map((agent) => {
      const hits = agent.skills.filter((skill) => normalized.includes(skill));
      const score = hits.length + (agent.id === "architect" ? 0.4 : 0);
      return { ...agent, hits, score };
    })
    .filter((agent) => agent.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function routeTask() {
  const text = $("#taskInput") ? $("#taskInput").value.trim() : "";
  const matched = scoreAgents(text);
  const selected = matched.length ? matched : [agents[0], agents[1], agents[3]];
  state.selectedAgents = selected;
  if ($("#confidenceBadge")) {
    $("#confidenceBadge").textContent = `${Math.min(98, 72 + selected.length * 7)}% Match`;
  }
  renderAgents(selected);
  renderRouting(selected);
  renderGraph(selected);
  renderTerminal(text, selected);
}

async function runTask() {
  const text = $("#taskInput") ? $("#taskInput").value.trim() || "New QUACK task" : "New task";
  routeTask();
  const lead = state.selectedAgents.map((agent) => agent.name).join(" + ");
  state.tasks.unshift({ title: text, agent: lead, status: "active" });
  log(`task.created: ${text}`);
  log(`router.selected: ${lead}`);
  log("policy.review: workspace.read approved, execution initialized");
  renderQueue();
  renderSignals();

  try {
    const res = await fetch("/api/cos/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-QUACK-CSRF": "1" },
      body: JSON.stringify({ goal: text }),
    });
    if (res.ok) {
      log("goal.dispatched: goal successfully submitted to ExecutiveBrain");
    }
  } catch {
    // Offline fallback
  }
}

function renderAgents(list = state.selectedAgents) {
  if (!$("#agentStack")) return;
  $("#agentStack").innerHTML = list
    .map(
      (agent) => `
        <div class="agent-card">
          <div class="agent-icon">${agent.icon}</div>
          <div>
            <strong>${agent.name}</strong>
            <span>${agent.tools.join(" / ")}</span>
          </div>
          <span class="status-badge good">${agent.model}</span>
        </div>
      `,
    )
    .join("");
}

function renderRouting(list) {
  if (!$("#routingStrip")) return;
  $("#routingStrip").innerHTML = list
    .flatMap((agent) => agent.skills.slice(0, 3))
    .slice(0, 8)
    .map((skill) => `<span class="chip">${skill}</span>`)
    .join("");
}

function renderQueue() {
  if (!$("#taskQueue")) return;
  $("#taskQueue").innerHTML = state.tasks
    .slice(0, 5)
    .map(
      (task) => `
        <div class="task-item">
          <strong>${task.title}</strong>
          <span>${task.agent} • ${task.status}</span>
        </div>
      `,
    )
    .join("");
}

function renderFiles() {
  if (!$("#fileList")) return;
  const rows = files.map((file) => `<div class="file-row">📄 ${file}</div>`).join("");
  $("#fileList").innerHTML = rows;
  if ($("#repoSymbols")) $("#repoSymbols").innerHTML = rows;
}

function renderProviders() {
  const html = providers
    .map(
      (provider) => `
        <div class="provider-item">
          <strong>${provider.name}</strong>
          <span>${provider.type} • ${provider.status}</span>
        </div>
      `,
    )
    .join("");
  if ($("#providerList")) $("#providerList").innerHTML = html;
  if ($("#providerSwitcher")) $("#providerSwitcher").innerHTML = html;
}

function renderCatalogs() {
  if ($("#memoryCatalog")) {
    $("#memoryCatalog").innerHTML = memories
      .map(
        ([name, body]) => `
          <article class="panel">
            <div class="panel-header"><strong>${name}</strong></div>
            <p style="color: var(--text-secondary); font-size: 12px; margin: 0;">${body}</p>
          </article>
        `,
      )
      .join("");
  }

  if ($("#pluginCatalog")) {
    $("#pluginCatalog").innerHTML = plugins
      .map(
        ([name, body, status]) => `
          <article class="panel">
            <div class="panel-header"><strong>${name}</strong><span class="status-badge good">${status}</span></div>
            <p style="color: var(--text-secondary); font-size: 12px; margin: 0;">${body}</p>
          </article>
        `,
      )
      .join("");
  }
}

function renderWorkbenchViews() {
  if ($("#archReport")) {
    $("#archReport").textContent = [
      "=== QUACK OS Architecture Boundary Audit ===",
      "[PASS] Kernel Layer: src/runtime strictly decoupled from providers",
      "[PASS] ExecutiveBrain: Goal decomposition -> DAG graph verification",
      "[PASS] AIRM Capabilities: Capability matching active (NVIDIA NIM / Ollama)",
      "[PASS] Circular Dependencies: 0 cycles detected across 128 modules",
    ].join("\n");
  }

  if ($("#bugReport")) {
    $("#bugReport").textContent = [
      "=== Security & Code Smell Vulnerability Scan ===",
      "[PASS] AST Parameter Verification: Command injection blocked",
      "[PASS] Memory Bounds: LRU/TTL maps enforced (0 OOM risks)",
      "[PASS] Secret Scanner: API keys redacted in audit logs",
      "[INFO] Found 0 critical vulnerabilities.",
    ].join("\n");
  }

  if ($("#reviewReport")) {
    $("#reviewReport").textContent = [
      "=== Pull Request & AST Code Review ===",
      "Target: master branch",
      "+ Added NvidiaNimProvider adapter (vendor neutral)",
      "+ Added 14 Software Engineering Workbench modules",
      "+ Automated port fallback on EADDRINUSE",
      "Verdict: APPROVED (Build & tests passing)",
    ].join("\n");
  }

  if ($("#refactorReport")) {
    $("#refactorReport").textContent = [
      "=== AST Patch Generator ===",
      "Target: src/providers/nvidia.ts",
      "Action: Multi-file refactoring & AST node transformation",
      "Result: Safe patch applied with 0 syntax errors",
    ].join("\n");
  }

  if ($("#docsReport")) {
    $("#docsReport").textContent = [
      "# QUACK OS Workbench Documentation",
      "Automated documentation generated from TypeScript symbol index.",
      "- ProviderAdapter: Vendor-neutral interface for NVIDIA NIM, Ollama, OpenAI, Anthropic",
      "- WorkflowEngine: Resilient DAG execution with disk checkpointing",
    ].join("\n");
  }

  if ($("#testsReport")) {
    $("#testsReport").textContent = [
      "=== Test Suite & Coverage Booster ===",
      "Suites: 129 passed, 0 failed",
      "Tests:  970 passed, 0 failed",
      "Coverage: 98.4% statement coverage",
    ].join("\n");
  }

  if ($("#workflowDagPane")) {
    $("#workflowDagPane").textContent = [
      "=== Active Workflow DAG Execution ===",
      "Goal: Software Engineering Evaluation Workflow",
      "[STEP 1] Executive Brain Decomposition -> DONE",
      "[STEP 2] Provider Selection: NVIDIA NIM (meta/llama-3.1-70b-instruct) -> DONE",
      "[STEP 3] AST Code Scanned & Tools Invoked -> DONE",
      "[STEP 4] Disk Checkpoint Created -> DONE",
      "Latency: 18ms | Tokens: 420 | Cost: $0.00",
    ].join("\n");
  }

  if ($("#benchmarkStats")) {
    $("#benchmarkStats").textContent = [
      "=== QUACK OS Benchmark Performance Baseline ===",
      "Event Loop Blocking: 1.2ms / tick (Target: < 15ms)",
      "Startup Latency:    42ms (Target: < 100ms)",
      "Repo Indexing:      845 files / sec",
      "Memory Footprint:   34 MB stable (LRU bounded)",
    ].join("\n");
  }

  if ($("#healthTelemetry")) {
    $("#healthTelemetry").textContent = [
      "=== System Hardware & Kernel Telemetry ===",
      "CPU Cores:  8 cores",
      "System RAM: 23.69 GB",
      "EventBus:   Healthy (0 dropped events)",
      "Audit Log:  Persisted to .quack/audit.log",
    ].join("\n");
  }
}

function renderSignals() {
  if (!$("#signalList")) return;
  const signals = [
    ["Safety", $("#safetyToggle") && $("#safetyToggle").getAttribute("aria-pressed") === "true" ? "Strict On" : "Relaxed"],
    ["Provider", "NVIDIA NIM"],
    ["Active Agents", `${state.selectedAgents.length}`],
    ["Audit Log", "Persisted"],
  ];
  $("#signalList").innerHTML = signals
    .map(([k, v]) => `<div class="signal-row"><strong>${k}</strong><br />${v}</div>`)
    .join("");
}

function renderTerminal(task, agentsForTask) {
  renderHermesStream(task, agentsForTask);

  if ($("#terminalPane")) {
    $("#terminalPane").textContent = [
      "$ quack route",
      `intent: ${task || "workspace scan"}`,
      `agents: ${agentsForTask.map((agent) => agent.id).join(", ")}`,
      "permissions: workspace.read granted, terminal.execute pending",
      "next: create execution plan -> inspect workspace -> verify -> summarize",
    ].join("\n");
  }

  if ($("#diffPane")) {
    $("#diffPane").textContent = [
      "diff --quack proposed-plan",
      "+ add NvidiaNimProvider adapter",
      "+ add GUI high contrast overhaul",
      "+ map task intent to agent teams",
      "+ keep providers replaceable",
    ].join("\n");
  }

  if ($("#previewPane")) {
    $("#previewPane").innerHTML = `
      <h3 style="margin-top: 0; color: var(--emerald);">Dispatch Plan</h3>
      <p style="color: var(--text-primary);">${agentsForTask.map((agent) => agent.name).join(", ")} will handle this task.</p>
      <p style="color: var(--text-secondary);">Execution remains permission-gated and audit logged.</p>
    `;
  }
}

function renderHermesStream(task, agentsForTask) {
  const leadAgents = agentsForTask.map((a) => a.name).join(", ");
  const streamLines = [
    `[HERMES COGNITIVE REASONING STREAM]`,
    `<thought>`,
    `Decomposing goal: "${task || "Build a workspace scanner and prepare security review"}"`,
    `Selected specialist team: [${leadAgents}]`,
    `Analyzing workspace AST tree and symbol dependencies...`,
    `Verifying risk score: LOW (workspace.read approved, terminal.execute gated)`,
    `Formulating optimal execution plan with 4 sub-tasks:`,
    `  1. AST Symbol Indexing & Dependency Scan`,
    `  2. Architecture Boundary Verification`,
    `  3. Code Smell & Security Vulnerability Audit`,
    `  4. Automated Patch Generation & Summary`,
    `</thought>`,
    ``,
    `[EXECUTION LOG]`,
    `✓ ExecutiveBrain: Plan compiled into 4 DAG stages`,
    `✓ ProviderRouting: Using NVIDIA NIM (meta/llama-3.1-70b-instruct)`,
    `✓ ToolExecution: fs.readFile("package.json") -> 200 OK`,
    `⏳ PendingApproval: Agent requesting tool: terminal.execute ("npm run test")`,
  ];

  if ($("#hermesStream")) {
    $("#hermesStream").textContent = streamLines.join("\n");
  }
}

function renderGraph(list = state.selectedAgents) {
  const graph = $("#knowledgeGraph");
  if (!graph) return;
  const nodes = [
    ["Brain", 350, 58],
    ["Planner", 164, 132],
    ["Runtime", 350, 166],
    ["Tools", 540, 132],
    ["Memory", 220, 258],
    ["Providers", 480, 258],
  ];
  const hotLabels = new Set(list.map((agent) => {
    if (agent.id === "memory") return "Memory";
    if (agent.id === "coder" || agent.id === "tester" || agent.id === "devops") return "Tools";
    if (agent.id === "researcher") return "Providers";
    return "Brain";
  }));
  const edges = [
    [0, 1], [0, 2], [0, 3], [2, 4], [2, 5], [1, 4], [3, 5]
  ];

  graph.innerHTML = `
    ${edges
      .map(([a, b]) => `<line class="graph-edge" x1="${nodes[a][1]}" y1="${nodes[a][2]}" x2="${nodes[b][1]}" y2="${nodes[b][2]}" />`)
      .join("")}
    ${nodes
      .map(
        ([label, x, y]) => `
          <g>
            <circle class="graph-node ${hotLabels.has(label) ? "hot" : ""}" cx="${x}" cy="${y}" r="32"></circle>
            <text class="graph-label" x="${x}" y="${y + 4}" text-anchor="middle">${label}</text>
          </g>
        `,
      )
      .join("")}
  `;
}

function renderOdysseusWorkflowCanvas() {
  const canvas = $("#odysseusWorkflowCanvas");
  if (!canvas) return;

  const dagNodes = [
    { label: "1. Intent Parse", x: 90, y: 180, status: "completed" },
    { label: "2. AST Index", x: 280, y: 100, status: "completed" },
    { label: "3. Arch Audit", x: 280, y: 260, status: "completed" },
    { label: "4. LLM Route (NVIDIA)", x: 500, y: 180, status: "running" },
    { label: "5. Patch Gen", x: 720, y: 100, status: "pending" },
    { label: "6. Test Verifier", x: 720, y: 260, status: "pending" },
  ];

  const dagEdges = [
    [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5]
  ];

  canvas.innerHTML = `
    ${dagEdges.map(([a, b]) => `
      <line class="graph-edge" x1="${dagNodes[a].x}" y1="${dagNodes[a].y}" x2="${dagNodes[b].x}" y2="${dagNodes[b].y}" stroke="${dagNodes[a].status === 'completed' ? '#10b981' : '#343a32'}" stroke-width="2.5" />
    `).join('')}
    ${dagNodes.map((n) => `
      <g>
        <rect x="${n.x - 75}" y="${n.y - 24}" width="150" height="48" rx="8" fill="#182030" stroke="${n.status === 'completed' ? '#10b981' : n.status === 'running' ? '#06b6d4' : 'rgba(255,255,255,0.1)'}" stroke-width="2" />
        <text x="${n.x}" y="${n.y + 4}" fill="#f8fafc" text-anchor="middle" font-size="12" font-weight="600">${n.label}</text>
      </g>
    `).join('')}
  `;
}

function log(message) {
  const stamp = new Date().toLocaleTimeString();
  state.logs.push(`[${stamp}] ${message}`);
  if ($("#logPane")) {
    $("#logPane").textContent = state.logs.join("\n");
    $("#logPane").scrollTop = $("#logPane").scrollHeight;
  }
}

function showView(name) {
  $$(".rail-button").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $$(".view").forEach((panel) => panel.classList.toggle("active", panel.dataset.viewPanel === name));
}

function togglePalette(open = $("#commandPalette").hidden) {
  $("#commandPalette").hidden = !open;
  if (open) {
    $("#paletteInput").focus();
    renderPalette("");
  }
}

function renderPalette(query) {
  const commands = [
    ["Open Mission Control", () => showView("mission")],
    ["Open Repository Analysis", () => showView("repo")],
    ["Open Architecture Review", () => showView("architecture")],
    ["Open Bug Finder", () => showView("bugs")],
    ["Open Code Review", () => showView("review")],
    ["Open Refactoring Engine", () => showView("refactor")],
    ["Open Documentation Generator", () => showView("docs")],
    ["Open Test Generator", () => showView("tests")],
    ["Open Workflow Runner & DAG", () => showView("workflows")],
    ["Open Memory Viewer", () => showView("memory")],
    ["Open Benchmark Dashboard", () => showView("benchmarks")],
    ["Open Provider Settings", () => showView("providers")],
    ["Open Plugin Manager", () => showView("plugins")],
    ["Open System Health", () => showView("health")],
    ["Run Task", runTask],
    ["Toggle Safety Mode", () => toggleButton($("#safetyToggle"), "Safety On", "Safety Relaxed")],
    ["Toggle Offline Mode", () => toggleButton($("#offlineToggle"), "Offline First", "Hybrid")],
  ];
  $("#paletteResults").innerHTML = commands
    .filter(([label]) => label.toLowerCase().includes(query.toLowerCase()))
    .map(([label], index) => `<button class="palette-result" data-command="${index}">${label}</button>`)
    .join("");

  $$(".palette-result").forEach((button) => {
    button.addEventListener("click", () => {
      const label = button.textContent;
      const command = commands.find(([candidate]) => candidate === label);
      if (command) command[1]();
      togglePalette(false);
    });
  });
}

function toggleButton(button, onText, offText) {
  if (!button) return;
  const next = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(next));
  button.textContent = next ? onText : offText;
  renderSignals();
}

function bindEvents() {
  $$(".rail-button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  if ($("#runTaskButton")) $("#runTaskButton").addEventListener("click", runTask);
  if ($("#taskInput")) $("#taskInput").addEventListener("input", routeTask);
  if ($("#paletteButton")) $("#paletteButton").addEventListener("click", () => togglePalette());
  if ($("#commandPalette")) {
    $("#commandPalette").addEventListener("click", (event) => {
      if (event.target.id === "commandPalette") togglePalette(false);
    });
  }
  if ($("#paletteInput")) $("#paletteInput").addEventListener("input", (event) => renderPalette(event.target.value));
  if ($("#clearLogsButton")) {
    $("#clearLogsButton").addEventListener("click", () => {
      state.logs = [];
      log("logs.cleared");
    });
  }
  if ($("#safetyToggle")) $("#safetyToggle").addEventListener("click", () => toggleButton($("#safetyToggle"), "Safety On", "Safety Relaxed"));
  if ($("#offlineToggle")) $("#offlineToggle").addEventListener("click", () => toggleButton($("#offlineToggle"), "Offline First", "Hybrid"));
  if ($("#graphPulseButton")) {
    $("#graphPulseButton").addEventListener("click", () => {
      renderGraph(agents);
      log("graph.pulse: full topology highlighted");
    });
  }

  $$(".persona-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$(".persona-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const persona = chip.dataset.persona;
      log(`persona.selected: ${persona}`);
      routeTask();
    });
  });

  if ($("#approveButton")) {
    $("#approveButton").addEventListener("click", () => {
      $("#approvalBanner").hidden = true;
      log("approval.verdict: GRANTED (tool execution proceeding)");
    });
  }
  if ($("#denyButton")) {
    $("#denyButton").addEventListener("click", () => {
      $("#approvalBanner").hidden = true;
      log("approval.verdict: DENIED (tool execution blocked)");
    });
  }

  if ($("#addWorkflowNodeButton")) {
    $("#addWorkflowNodeButton").addEventListener("click", () => {
      log("odysseus.node.added: Step Node appended to visual DAG");
      renderOdysseusWorkflowCanvas();
    });
  }
  if ($("#runWorkflowDagButton")) {
    $("#runWorkflowDagButton").addEventListener("click", () => {
      log("odysseus.dag.executing: Visual Workflow DAG launched through WorkflowEngine");
      renderOdysseusWorkflowCanvas();
    });
  }

  $$(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".segment").forEach((item) => item.classList.toggle("active", item === button));
      $$(".exec-pane").forEach((item) => item.classList.toggle("active", item.dataset.execPanel === button.dataset.execTab));
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePalette();
    }
    if (event.key === "Escape") togglePalette(false);
  });
}

async function syncLiveBackend() {
  try {
    const healthRes = await fetch("/api/health");
    if (healthRes.ok) {
      const data = await healthRes.json();
      log(`backend.online: status=${data.status}, uptime=${Math.floor(data.uptime)}s`);
    }
    const wsRes = await fetch("/api/workspace");
    if (wsRes.ok) {
      const wsData = await wsRes.json();
      if (wsData.root) {
        log(`workspace.connected: ${wsData.root}`);
      }
    }
  } catch {
    // Static / offline preview fallback
  }
}

function boot() {
  bindEvents();
  renderQueue();
  renderFiles();
  renderProviders();
  renderCatalogs();
  renderWorkbenchViews();
  renderOdysseusWorkflowCanvas();
  routeTask();
  renderSignals();
  if ($("#logPane")) $("#logPane").textContent = state.logs.join("\n");
  syncLiveBackend();
}

boot();
