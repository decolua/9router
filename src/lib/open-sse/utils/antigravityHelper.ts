/**
 * Antigravity helper functions
 */

export function cloakTools(body: any) {
  if (!body?.request?.tools?.[0]?.functionDeclarations) {
    return { cloakedBody: body, toolNameMap: null };
  }

  const toolNameMap = new Map<string, string>();
  const nextBody = structuredClone(body);
  const declarations = nextBody.request.tools[0].functionDeclarations;

  for (const decl of declarations) {
    const originalName = decl.name;
    // Real Antigravity uses simple lowercase names for its internal tools
    const cloakedName = originalName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (cloakedName !== originalName) {
      decl.name = cloakedName;
      toolNameMap.set(cloakedName, originalName);
    }
  }

  // Also update any tool calls in history if present (rare for input)
  if (nextBody.request.contents) {
    for (const content of nextBody.request.contents) {
      if (!content.parts) continue;
      for (const part of content.parts) {
        if (part.functionCall) {
          const originalName = part.functionCall.name;
          const cloakedName = originalName.toLowerCase().replace(/[^a-z0-9]/g, "_");
          if (cloakedName !== originalName) {
            part.functionCall.name = cloakedName;
          }
        }
      }
    }
  }

  return { cloakedBody: nextBody, toolNameMap };
}
