import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMessage } from "../../src/i18n/useTranslation.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("publishes the initial locale only when its dictionary is ready", async () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { cookie: "locale=ru", body: {}, createTreeWalker: () => ({ nextNode: () => null }) });
  vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
  vi.stubGlobal("MutationObserver", class { observe() {} });
  let resolveDictionary;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { resolveDictionary = resolve; })));
  const runtime = await import("../../src/i18n/runtime.js");
  const snapshots = [];
  const unsubscribe = runtime.onLocaleChange(() => snapshots.push([runtime.getCurrentLocale(), runtime.translate("Save models")]));
  const initialization = runtime.initRuntimeI18n();
  expect(runtime.getCurrentLocale()).toBe("en");
  expect(snapshots).toEqual([]);
  resolveDictionary({ json: async () => ({ "Save models": "Сохранить модели" }) });
  await initialization;
  expect(snapshots).toEqual([["ru", "Сохранить модели"]]);
  document.cookie = "locale=en";
  await runtime.reloadTranslations();
  expect(snapshots.at(-1)).toEqual(["en", "Save models"]);
  unsubscribe();
});

it("interpolates zero, keeps unknown placeholders and does not recursively replace values", () => {
  expect(formatMessage("{size}k / {missing} / {model}", { size: 0, model: "{size}<unsafe>" }))
    .toBe("0k / {missing} / {size}<unsafe>");
});

it("reorders rich links and code while React escapes literal text", () => {
  const formatted = formatMessage("{code} <script> {link}", {
    link: createElement("a", { key: "link", href: "/dashboard/endpoint" }, "API"),
    code: createElement("code", { key: "code" }, "ROUTER9_API_KEY"),
  });
  expect(renderToStaticMarkup(createElement("p", null, formatted)))
    .toBe('<p><code>ROUTER9_API_KEY</code> &lt;script&gt; <a href="/dashboard/endpoint">API</a></p>');
});
