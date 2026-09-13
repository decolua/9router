const API_TYPE_OPTIONS = Object.freeze([
  { value: "auto", label: "Match Client API" },
  { value: "chat", label: "Chat Completions" },
  { value: "responses", label: "Responses API" },
]);

const DEFAULT_API_TYPE = "auto";

module.exports = { API_TYPE_OPTIONS, DEFAULT_API_TYPE };
