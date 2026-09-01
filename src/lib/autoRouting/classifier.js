export const AUTO_ROUTING_CLASSES = Object.freeze([
  "normal",
  "thinking",
  "code",
  "vision",
  "image",
  "video",
]);

export const AUTO_ROUTING_GENERIC_TOKEN =
  "auto::auto";

const EXPLICIT_TOKENS =
  new Map(
    AUTO_ROUTING_CLASSES.map(
      (capabilityClass) => [
        `auto::${capabilityClass}`,
        capabilityClass,
      ],
    ),
  );

const ALL_TOKENS =
  new Set([
    AUTO_ROUTING_GENERIC_TOKEN,
    ...EXPLICIT_TOKENS.keys(),
  ]);

function cleanToken(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeRequiredCapabilities(
  value,
) {
  if (value instanceof Set) {
    return new Set(value);
  }

  if (Array.isArray(value)) {
    return new Set(
      value
        .filter(Boolean)
        .map(String),
    );
  }

  return new Set();
}

function textFromContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (
        !block ||
        typeof block !== "object"
      ) {
        return "";
      }

      return (
        block.text ||
        block.input_text ||
        block.content ||
        ""
      );
    })
    .filter(
      (value) =>
        typeof value === "string",
    )
    .join("\n");
}

function currentUserText(body) {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return "";
  }

  const rows = [];

  const pushLastUserLike = (
    items,
    contentKey = "content",
  ) => {
    if (!Array.isArray(items)) {
      return;
    }

    for (
      let i = items.length - 1;
      i >= 0;
      i -= 1
    ) {
      const item = items[i];

      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const role =
        String(
          item.role || "",
        ).toLowerCase();

      if (
        role === "assistant" ||
        role === "model"
      ) {
        break;
      }

      const value =
        textFromContent(
          item[contentKey],
        );

      if (value) {
        rows.unshift(value);
      }
    }
  };

  pushLastUserLike(
    body.messages,
  );

  if (
    typeof body.input === "string"
  ) {
    rows.push(body.input);
  } else {
    pushLastUserLike(
      body.input,
    );
  }

  const contents =
    body.contents ||
    body.request?.contents;

  if (Array.isArray(contents)) {
    for (
      let i = contents.length - 1;
      i >= 0;
      i -= 1
    ) {
      const item =
        contents[i];

      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const role =
        String(
          item.role || "",
        ).toLowerCase();

      if (
        role === "model" ||
        role === "assistant"
      ) {
        break;
      }

      const value =
        textFromContent(
          item.parts,
        );

      if (value) {
        rows.unshift(value);
      }
    }
  }

  if (
    typeof body.prompt ===
    "string"
  ) {
    rows.push(body.prompt);
  }

  if (
    typeof body.query ===
    "string"
  ) {
    rows.push(body.query);
  }

  return rows
    .join("\n")
    .slice(
      0,
      20000,
    );
}

function explicitThinkingSignal(
  body,
) {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return false;
  }

  const values = [
    body.reasoning,
    body.thinking,
    body.reasoning_effort,
    body.reasoningEffort,
    body.thinking_level,
    body.thinkingLevel,
    body.generationConfig
      ?.thinkingConfig,
    body.request
      ?.generationConfig
      ?.thinkingConfig,
  ];

  return values.some(
    (value) => {
      if (value === true) {
        return true;
      }

      if (
        typeof value ===
        "number"
      ) {
        return value > 0;
      }

      if (
        typeof value ===
        "string"
      ) {
        const normalized =
          value
            .trim()
            .toLowerCase();

        return (
          Boolean(normalized) &&
          ![
            "none",
            "off",
            "false",
            "disabled",
            "0",
          ].includes(
            normalized,
          )
        );
      }

      if (
        value &&
        typeof value ===
        "object"
      ) {
        if (
          value.enabled === false
        ) {
          return false;
        }

        if (
          Number(
            value.budgetTokens ||
            value.budget_tokens ||
            value.thinkingBudget ||
            0,
          ) > 0
        ) {
          return true;
        }

        return (
          value.enabled === true
        );
      }

      return false;
    },
  );
}

function codeIntent(body) {
  const text =
    currentUserText(body);

  if (!text) {
    return false;
  }

  return /(?:```|\b(?:write|implement|debug|refactor|compile|fix|review|explain)\b[^\n]{0,80}\b(?:code|function|class|script|regex|sql|typescript|javascript|python|java|golang|rust|php|css|html|react|node)\b|\b(?:typescript|javascript|python|java|golang|rust|php|sql|jsx|tsx)\b[^\n]{0,80}\b(?:error|code|function|class|script|query)\b)/i
    .test(text);
}

function mediaGenerationClass({
  endpoint,
  routeKind,
  body,
}) {
  const route =
    String(
      routeKind || "",
    ).toLowerCase();

  const path =
    String(
      endpoint || "",
    ).toLowerCase();

  const type =
    String(
      body?.type ||
      body?.task ||
      body?.mode ||
      body?.operation ||
      "",
    ).toLowerCase();

  if (
    route === "video" ||
    /(?:^|\/)(?:videos?|video-generations?)(?:\/|$)/
      .test(path) ||
    /(?:video).*(?:generat|create|render)|(?:generat|create|render).*video/
      .test(type)
  ) {
    return "video";
  }

  if (
    route === "image" ||
    /(?:^|\/)(?:images?|image-generations?)(?:\/|$)/
      .test(path) ||
    /(?:image).*(?:generat|create|render)|(?:generat|create|render).*image/
      .test(type)
  ) {
    return "image";
  }

  return null;
}

export function isAutoRoutingToken(
  value,
) {
  return ALL_TOKENS.has(
    cleanToken(value),
  );
}

export function parseAutoRoutingToken(
  value,
) {
  const routingToken =
    cleanToken(value);

  if (
    !ALL_TOKENS.has(
      routingToken,
    )
  ) {
    return null;
  }

  if (
    routingToken ===
    AUTO_ROUTING_GENERIC_TOKEN
  ) {
    return Object.freeze({
      routingToken,
      generic: true,
      requestedClass: "auto",
      explicitClass: null,
    });
  }

  return Object.freeze({
    routingToken,
    generic: false,
    requestedClass:
      EXPLICIT_TOKENS.get(
        routingToken,
      ),
    explicitClass:
      EXPLICIT_TOKENS.get(
        routingToken,
      ),
  });
}

export function classifyAutoRoutingRequest({
  routingToken,
  body = {},
  endpoint = "",
  routeKind = "chat",
  requiredCapabilities =
    new Set(),
} = {}) {
  const parsed =
    parseAutoRoutingToken(
      routingToken,
    );

  if (!parsed) {
    return Object.freeze({
      matched: false,
      routingToken:
        cleanToken(
          routingToken,
        ) || null,
      requestedClass: null,
      resolvedClass: null,
      classificationReason:
        "not_auto_routing_token",
    });
  }

  if (!parsed.generic) {
    return Object.freeze({
      matched: true,
      routingToken:
        parsed.routingToken,
      requestedClass:
        parsed.requestedClass,
      resolvedClass:
        parsed.explicitClass,
      classificationReason:
        "explicit_auto_class",
    });
  }

  const mediaClass =
    mediaGenerationClass({
      endpoint,
      routeKind,
      body,
    });

  if (mediaClass) {
    return Object.freeze({
      matched: true,
      routingToken:
        parsed.routingToken,
      requestedClass: "auto",
      resolvedClass:
        mediaClass,
      classificationReason:
        `${mediaClass}_generation_request`,
    });
  }

  const required =
    normalizeRequiredCapabilities(
      requiredCapabilities,
    );

  if (
    [
      "vision",
      "pdf",
      "audioInput",
      "videoInput",
    ].some(
      (capability) =>
        required.has(
          capability,
        ),
    )
  ) {
    return Object.freeze({
      matched: true,
      routingToken:
        parsed.routingToken,
      requestedClass: "auto",
      resolvedClass: "vision",
      classificationReason:
        "hard_input_capability",
    });
  }

  if (codeIntent(body)) {
    return Object.freeze({
      matched: true,
      routingToken:
        parsed.routingToken,
      requestedClass: "auto",
      resolvedClass: "code",
      classificationReason:
        "deterministic_code_intent",
    });
  }

  if (
    explicitThinkingSignal(
      body,
    )
  ) {
    return Object.freeze({
      matched: true,
      routingToken:
        parsed.routingToken,
      requestedClass: "auto",
      resolvedClass: "thinking",
      classificationReason:
        "explicit_thinking_signal",
    });
  }

  return Object.freeze({
    matched: true,
    routingToken:
      parsed.routingToken,
    requestedClass: "auto",
    resolvedClass: "normal",
    classificationReason:
      "default_normal",
  });
}
