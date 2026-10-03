import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import EditConnectionModal from "@/shared/components/EditConnectionModal.js";

const noop = () => {};
const label = "Require Zero Data Retention (ZDR)";

function renderAdd(provider) {
  return renderToStaticMarkup(createElement(AddApiKeyModal, {
    isOpen: true,
    provider,
    providerName: provider,
    isCompatible: false,
    isAnthropic: false,
    authType: "apikey",
    proxyPools: [],
    existingNames: [],
    onSave: noop,
    onClose: noop,
  }));
}

function renderEdit(provider, zdrEnabled = false) {
  return renderToStaticMarkup(createElement(EditConnectionModal, {
    isOpen: true,
    connection: {
      id: "connection-1",
      provider,
      authType: "apikey",
      name: "Test connection",
      priority: 1,
      providerSpecificData: { zdrEnabled },
    },
    proxyPools: [],
    onSave: noop,
    onClose: noop,
  }));
}

describe("Command Code ZDR UI", () => {
  it("renders the add toggle only for Command Code", () => {
    expect(renderAdd("commandcode")).toContain(label);
    expect(renderAdd("openai")).not.toContain(label);
  });

  it("renders the edit toggle only for Command Code", () => {
    expect(renderEdit("commandcode", true)).toContain(label);
    expect(renderEdit("openai")).not.toContain(label);
  });
});
