# Action Ecosystem Comparison

Research date: 2026-08-15. These decisions prefer protocol adapters over copied
vendor code. Licenses must be rechecked at the version actually integrated.

| Integration | Classification | License / constraint | QUACK decision |
|---|---|---|---|
| [Zapier MCP](https://github.com/zapier/zapier-mcp) | optional external provider | Hosted service/repository terms; verify before distribution | Generic remote MCP adapter. Never enable or execute write actions automatically. |
| [Composio](https://github.com/ComposioHQ/composio) | MCP adapter / optional external provider | MIT repository; hosted service terms separate | Prefer its MCP surface; vendor adapter only for auth/discovery metadata. |
| [Activepieces](https://github.com/activepieces/activepieces) | MCP adapter / optional external provider | Community edition MIT; enterprise features commercial | Consume exposed pieces through MCP or REST. Do not embed the workflow engine. |
| [n8n](https://github.com/n8n-io/n8n) | optional external provider | Sustainable Use License / enterprise license; source-available, not OSI open source | Protocol/API integration only. Do not copy source. Validate deployed versions because MCP-related security fixes continue to ship. |
| [Pipedream](https://github.com/PipedreamHQ/pipedream) | optional external provider | Repository/component and hosted terms require per-artifact review | Remote MCP/API adapter only. |
| [ToolHive](https://github.com/stacklok/toolhive) | optional MCP isolation provider; pattern/reference | Apache-2.0 | Adapt its isolation, permission-profile, proxy middleware, identity, audit, and portable run-config patterns. QUACK must also work without ToolHive. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | MCP browser adapter | Apache-2.0 | Preferred browser automation path, isolated and allowlisted. Disable arbitrary-code tools and treat page/accessibility text as untrusted prompt-injection material. |
| [Browser Use](https://github.com/browser-use/browser-use) | optional external provider | MIT | Higher-level optional adapter after deterministic Playwright behavior is proven. |
| [Daytona](https://github.com/daytonaio/daytona) | optional external execution provider | AGPL-3.0 | API/SDK adapter only; do not incorporate server source into QUACK. |
| [E2B](https://github.com/e2b-dev/E2B) | optional external execution provider | Apache-2.0; hosted service terms separate | Cloud sandbox adapter only; never mandatory for local execution. |
| [MCP reference servers](https://github.com/modelcontextprotocol/servers) | pattern/reference and test fixtures | Apache-2.0 for new contributions, existing code may be MIT | Use the Everything server for conformance and reference only; upstream warns that examples are not production-ready. |

## Security conclusions

Every external action descriptor and result is untrusted. QUACK independently
enforces schema size, output size, permissions, risk, approval, timeout,
cancellation, audit, and evidence. Provider annotations are hints: ambiguous MCP
tools default to `DATA_MODIFICATION`, not read-only. Browser sessions need origin
policy, isolated profiles, download/upload controls, and approval before any
submission, purchase, deletion, or external communication.

The MCP transport boundary follows the official specification rather than a
vendor dialect: stdio and Streamable HTTP are current paths, with version
negotiation for the 2025-11-25 to 2026-07-28 transition. HTTP+SSE is legacy.
