export const manifest = {
  schemaVersion: 1,
  id: "com.t3code.bob",
  displayName: "Bob",
  version: "0.1.0",
  runtime: { kind: "managed-app", command: ["bob-t3-plugin"], restart: "on-failure" },
  contributes: {
    panels: [
      { id: "bob.workspace", title: "Bob planning", surface: "project" },
      { id: "bob.runs", title: "Bob runs", surface: "thread.sidePanel" },
    ],
    workflows: [{ id: "bob.planning-review", title: "Planning review", surface: "thread.main" }],
    hooks: ["project.opened", "thread.created", "thread.completed"],
  },
  capabilities: [
    { kind: "threads.read", projectIds: [] },
    { kind: "threads.dispatch", projectIds: [] },
    { kind: "secrets.read", names: ["BOB_API_KEY"] },
    { kind: "network.connect", hosts: ["*"] },
    { kind: "ui.embed", surfaces: ["project", "thread.sidePanel"] },
  ],
} as const;
