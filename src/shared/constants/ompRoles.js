// Built-in Oh My Pi model roles from @oh-my-pi/pi-coding-agent
// src/config/model-roles.ts (omp 17.2.15). Custom cycleOrder roles are
// not invented here — only these official keys are written to config.yml.
export const OMP_MODEL_ROLES = [
  { id: "default", name: "Default", hint: "Interactive and -p when --model is omitted" },
  { id: "smol", name: "Fast", hint: "Cheap / prewalk / lightweight tasks" },
  { id: "slow", name: "Thinking", hint: "Thorough reasoning" },
  { id: "vision", name: "Vision", hint: "Image understanding" },
  { id: "plan", name: "Architect", hint: "Plan mode" },
  { id: "designer", name: "Designer", hint: "UI / design work" },
  { id: "commit", name: "Commit", hint: "Commit messages" },
  { id: "tiny", name: "Tiny", hint: "Titles and classifiers" },
  { id: "task", name: "Subtask", hint: "Spawned subagents" },
  { id: "advisor", name: "Advisor", hint: "Passive review model" },
];

export const OMP_ROLE_IDS = OMP_MODEL_ROLES.map((role) => role.id);

export const emptyOmpRoleAssignments = () =>
  Object.fromEntries(OMP_ROLE_IDS.map((id) => [id, ""]));
