# Goals and Projects

Every company plan carries a minimal durable ancestry:

```text
Company -> Goal -> Project -> Mission -> Task
```

Each node has a stable ID and objective. A mission also carries explicit success
criteria. Agents receive the mission objective, their bounded role objective,
their parent relationship, their task dependencies, and the success criteria;
they do not require the owner's entire conversation history.

The single-user release defaults to `company-default`. This is not multi-tenant
storage. The versioned IDs leave room for future multiple-company support
without putting tenant logic into provider, action, or tool runtimes.
