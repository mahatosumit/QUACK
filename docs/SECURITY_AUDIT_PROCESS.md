# Security Audit Process

QUACK OS treats execution security as a tier-0 priority because we orchestrate non-deterministic AI models.

## Routine Audit Checklist
Prior to every MINOR and MAJOR release, the following components must be audited:

1. **The Sandbox (`PluginSandbox`)**: Verify that `eval()` and `new Function()` equivalents are disabled. Test escape vectors using malicious plugins.
2. **The Command Executor**: Ensure AST parameter verification successfully blocks payload injections (e.g., `&& rm -rf /`).
3. **Approval Policies**: Verify `RiskAwareApprovalPolicy` accurately halts execution for unauthorized file mutations and network accesses.
4. **Secret Redaction**: Ensure the `AuditLog` redacts known token formats (e.g., `sk-ant-`, `sk-proj-`).

## Supply Chain
- `npm audit` is run continuously in CI.
- Third-party dependencies are strictly minimized in the Kernel layer.

*To report a security vulnerability, please see `SECURITY.md`.*
