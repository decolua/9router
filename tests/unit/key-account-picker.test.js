import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import KeyAccountPicker from "@/app/(dashboard)/dashboard/endpoint/components/KeyAccountPicker";
import { createKeyRequest } from "@/app/(dashboard)/dashboard/endpoint/components/createKeyRequest";
import { toggleAccount } from "@/shared/utils/keyConnections";
import { MAX_KEY_CONNECTIONS } from "@/shared/constants/keyConnections";

const switches = vi.hoisted(() => new Map());
const buttons = vi.hoisted(() => new Map());
vi.mock("@/shared/components", () => ({
  Badge: ({ children }) => children,
  Tooltip: ({ children }) => children,
  Toggle(props) {
    switches.set(props["aria-label"], props);
    return createElement("button", { type: "button", role: "switch", "aria-checked": props.checked });
  },
  Button(props) {
    buttons.set(props["aria-label"] || props.children, props);
    return createElement("button", { type: props.type }, props.children);
  },
}));

afterEach(() => {
  switches.clear();
  buttons.clear();
  vi.unstubAllGlobals();
});

const connections = [
  { id: "a", provider: "openai", name: "Work", email: "work@example.org" },
  { id: "b", provider: "node-1", displayName: "Research", providerSpecificData: { nodeName: "Lab" } },
  { id: "c", provider: "openai", email: "other@example.org" },
];

it("opens restricted groups, labels accounts, and never submits the surrounding form", () => {
  const onChange = vi.fn();
  const selected = ["a", "removed"];
  const html = renderToStaticMarkup(createElement(KeyAccountPicker, { connections, selected, onChange }));
  expect(html.match(/>OpenAI<\/strong>/g)).toHaveLength(1);
  expect(html).toContain(">Lab</strong>");
  expect(html).toMatch(/aria-expanded="true"[^]*?OpenAI/);
  expect(html).toMatch(/aria-expanded="false"[^]*?Lab/);
  expect(html.match(/<button(?![^>]*type="button")/g)).toBeNull();
  expect(switches.get("Work · work@example.org")).toMatchObject({ checked: true, disabled: true });
  expect(switches.get("Research")).toMatchObject({ checked: true, disabled: true });
  const other = switches.get("other@example.org");
  expect(other).toMatchObject({ checked: false, disabled: false });
  other.onChange(true);
  expect(onChange).toHaveBeenLastCalledWith(["removed"]);
  buttons.get("Remove: removed").onClick();
  expect(onChange).toHaveBeenLastCalledWith(["a"]);
  buttons.get("Enable all").onClick();
  expect(onChange).toHaveBeenLastCalledWith(["removed"]);
});

it("rejects policies above the cap while still allowing a restriction to be cleared", () => {
  const selected = ["a", ...Array.from({ length: MAX_KEY_CONNECTIONS - 1 }, (_, i) => String(i))];
  const accounts = [...connections, { id: "d", provider: "node-1" }];
  renderToStaticMarkup(createElement(KeyAccountPicker, { connections: accounts, selected, onChange: vi.fn() }));
  expect(switches.get("Research").disabled).toBe(true);
  expect(switches.get("other@example.org").disabled).toBe(false);
});

it("turns unrestricted access into the remaining IDs, then clears a fully enabled group", () => {
  const selected = ["b", "deleted"];
  const next = toggleAccount(selected, connections, "a", false);
  expect(next).toEqual(["b", "deleted", "c"]);
  expect(toggleAccount(next, connections, "c", false)).toEqual(next);
  expect(toggleAccount(next, connections, "a", true)).toEqual(selected);
  expect(toggleAccount([], connections, "b", false)).toEqual([]);
});

it.each([
  { selected: ["b", "c"], expected: { name: "Build", allowedConnections: ["b", "c"] } },
  { selected: [], expected: { name: "Build" } },
])("sends one create request with the selected policy: $selected", async ({ selected, expected }) => {
  const send = vi.fn().mockResolvedValue(Response.json({ key: "created" }, { status: 201 }));
  vi.stubGlobal("fetch", send);
  await createKeyRequest({ name: "Build" }, selected);
  expect(send).toHaveBeenCalledTimes(1);
  const [path, options] = send.mock.calls[0];
  expect(path).toBe("/api/keys");
  expect(options.method).toBe("POST");
  expect(JSON.parse(options.body)).toEqual(expected);
});
