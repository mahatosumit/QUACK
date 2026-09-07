# Reference Implementation Research

Last checked: 2026-07-04

This file records the current reference-system patterns that should inform QUACK without making QUACK dependent on any one product.

## Key Findings

### Agentic coding systems

- Claude Code presents a shared engine across terminal, IDE, desktop, and browser. Its docs emphasize codebase understanding, file edits, command execution, visual diff review, MCP, instructions, memories, skills, hooks, agent teams, background agents, recurring tasks, and remote handoff.
- OpenHands separates its agent technology into Agent Canvas, Cloud, CLI, Local GUI, and a composable Software Agent SDK. Its docs emphasize browser UI plus backend server, local and cloud execution, integrations, multi-user controls, RBAC, budgeting, plugins, MCP, automations, repository customization, and SDK-driven scale-out.
- Continue remains useful as a reference for open-source coding-agent configuration, CLI/TUI/headless modes, VS Code and JetBrains surfaces, and explicit tool permissions.
- Aider is a terminal-first pair programmer with Git integration, chat modes, repository maps, lint/test loops, multiple model providers, voice-to-code, images/web pages, browser mode, IDE watching, notifications, and coding-convention files.
- Codex, Cursor, Windsurf/Devin, Cline, Roo Code, Gemini CLI, and similar tools converge on repository context, agent sessions, command execution, diffs, model switching, rules/memory, and task queues.

### Local and self-hosted AI platforms

- Open WebUI is a self-hosted, offline-capable AI platform with Ollama and OpenAI-compatible provider support, plugins, tool calling, task models, context management, RAG, terminal/computer integrations, knowledge-base sync, and agent connectors.
- AnythingLLM emphasizes workspaces, AI agents, chat logs, event logs, embedding/model/transcription providers, vector databases, model routing, MCP, agent flows, scheduled jobs, built-in skills, custom skills, browser/meeting/desktop assistants, and document workflows.
- Ollama and LM Studio are important local provider references: QUACK should treat local model runtimes as provider adapters, not as the operating system itself.
- Jan and Pinokio reinforce the need for simple local app management, model management, and one-click workflow installation without forcing users into terminal-only operation.

### Workflow and graph systems

- Langflow, Flowise, and n8n show why visual workflows matter: users need a node canvas for agents, tools, triggers, memory, and integrations.
- Security reports around low-code AI workflow systems show that custom code nodes and tool execution need sandboxing, permission gates, audit logs, and isolation.
- Graphiti, Graphify, and current graph-memory research show that QUACK memory should not be a flat transcript store. It should support entities, relationships, temporal changes, provenance, and graph navigation.

### MCP ecosystem

- MCP is an open standard for connecting AI applications to external systems: files, databases, tools, prompts, and workflows.
- MCP support should be native in QUACK, but QUACK should also keep its own plugin API so internal tools, agents, and UI surfaces can work without MCP when local integration is simpler.

## QUACK GUI Requirements Derived From Research

- One workspace that unifies chat, agent sessions, terminal, files, Git, memory, knowledge graph, plugins, providers, logs, settings, and task queues.
- A skill-agent router that maps a user task to the correct agent mix before execution.
- Agent command center with status, permissions, model choice, tools, cost, latency, and worktree/session isolation.
- Visual workflow canvas for automations and multi-agent chains.
- Local-first provider manager for Ollama, LM Studio, OpenAI-compatible endpoints, and future cloud adapters.
- MCP and plugin manager with permission review and audit events.
- Memory explorer with searchable session, project, workspace, and graph memory.
- Diff/review center for code changes.
- Offline mode and safety mode controls.
- Command palette that works across every surface.

## Sources

- Claude Code docs: https://code.claude.com/docs/en/overview
- OpenHands docs: https://docs.openhands.dev/overview/introduction
- Continue docs: https://docs.continue.dev/
- Aider docs: https://aider.chat/docs/
- Devin/Windsurf docs: https://docs.devin.ai/desktop/getting-started
- MCP docs: https://modelcontextprotocol.io/docs/getting-started/intro
- Open WebUI docs: https://docs.openwebui.com/
- AnythingLLM docs: https://docs.anythingllm.com/
- Ollama reference: https://ollama.com/
- n8n reference: https://n8n.io/
- Langflow reference: https://www.langflow.org/
- Flowise reference: https://flowiseai.com/

