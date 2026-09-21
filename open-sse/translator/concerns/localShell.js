// Bridge the Responses local_shell tool through function-only providers.
export const LOCAL_SHELL = "local_shell";
export const LOCAL_SHELL_CALL = "local_shell_call";
export const LOCAL_SHELL_OUTPUT = "local_shell_call_output";

export function hasLocalShell(body) {
  return body?.tools?.some(tool => tool.type === LOCAL_SHELL) || false;
}

export const localShellFunction = {
  type: "function",
  function: {
    name: LOCAL_SHELL,
    description: "Execute a command on the client's machine. Return the executable and arguments as a string array. The client runs it and returns the output.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "array", items: { type: "string" }, minItems: 1 },
        env: { type: "object", additionalProperties: { type: "string" } },
        timeout_ms: { type: "integer" },
        working_directory: { type: "string" },
        user: { type: "string" },
      },
      required: ["command", "env"],
      additionalProperties: false,
    },
  },
};

export function toLocalShellCall(item) {
  if (item.type !== "function_call" || item.name !== LOCAL_SHELL) return item;
  const args = typeof item.arguments === "string" ? JSON.parse(item.arguments) : item.arguments;
  if (!Array.isArray(args?.command) || !args.command.length || args.command.some(arg => typeof arg !== "string")) {
    throw new Error("local_shell command must be a non-empty array of strings");
  }
  return {
    id: item.id,
    type: LOCAL_SHELL_CALL,
    call_id: item.call_id,
    status: "completed",
    action: { ...args, type: "exec", env: args.env || {} },
  };
}

export function restoreLocalShellResponse(response, body) {
  if (hasLocalShell(body) && Array.isArray(response?.output)) {
    response.output = response.output.map(toLocalShellCall);
  }
  return response;
}
