# RTK Token Saver

Deep dive into the RTK (Request Token Kompressor) system.

---

## Overview

RTK automatically compresses `tool_result` content before sending requests to LLMs, saving 20-40% input tokens per request.

Tool outputs (`git diff`, `grep`, `find`, `ls`, `tree`, log dumps) often consume 30-50% of prompt budget. RTK detects these patterns and applies smart, lossless compression.

**Safe by design:** If a filter fails, throws, or makes output bigger, RTK silently keeps the original text. Errors never break requests.

---

## How It Works

```
Request arrives at /v1/chat/completions
  → Parse messages
  → For each tool_result content:
    → Autodetect type (first 1KB)
    → Select matching filter
    → Apply compression
    → Compare: compressed vs original size
    → If compressed is bigger → keep original
    → If error → keep original
  → Continue with compressed content
  → Translate format → Execute provider
```

---

## Filters

| Filter | Detects | Compression Strategy |
|--------|---------|---------------------|
| `git-diff` | Git diff output | Remove context lines, keep +/- only |
| `git-status` | Git status output | Compact format, remove redundant info |
| `grep` | Grep search results | Deduplicate, remove line numbers if excessive |
| `find` | File find results | Compact path format |
| `ls` | Directory listings | Single-line format |
| `tree` | Tree output | Compact tree structure |
| `dedup-log` | Repeated log lines | Remove consecutive duplicates |
| `smart-truncate` | Large outputs | Truncate middle, keep head + tail |
| `read-numbered` | Numbered file content | Strip line numbers |
| `search-list` | Search result lists | Compact format |

---

## Auto-Detection

RTK peeks at the first 1KB of each `tool_result` and picks the right filter:

```
open-sse/rtk/autodetect.js
  → Pattern matching on content headers
  → Heuristic detection (file paths, diff markers, etc.)
  → Returns best matching filter
```

No configuration needed — works automatically.

---

## Caveman Mode

Separate from RTK filters, Caveman Mode injects a system prompt that makes LLMs reply in terse, technical language while preserving substance.

**Savings:** Up to 65% output tokens.

```
open-sse/rtk/caveman.js
  → Injects caveman prompt prefix
  → LLM responds tersely
  → Context preserved
```

Enable in Dashboard → Endpoint settings → Caveman Mode.

---

## RTK Architecture

```
open-sse/rtk/
├── index.js           # Entry: compressMessage(message)
├── autodetect.js      # Detect tool_result type
├── applyFilter.js     # Run filter on content
├── constants.js       # Size thresholds, constants
├── registry.js        # Filter registry
├── filters/           # Individual filters
│   ├── gitDiff.js
│   ├── gitStatus.js
│   ├── grep.js
│   ├── find.js
│   ├── ls.js
│   ├── tree.js
│   ├── dedupLog.js
│   ├── smartTruncate.js
│   ├── readNumbered.js
│   └── searchList.js
└── caveman/           # Caveman mode
    ├── caveman.js
    └── cavemanPrompts.js
```

---

## Safety Guarantees

1. **No data loss:** If compression fails, original content is used
2. **No size increase:** If compressed > original, original is used
3. **No request breakage:** Filter errors are caught silently
4. **Universal:** Runs before format translation → works with all formats

---

## Enabling/Disabling

Default: **ON**

Toggle in Dashboard → Endpoint settings → RTK Token Saver.

Or via API:

```javascript
// Settings endpoint
PATCH /api/settings
{ rtkEnabled: false }
```

---

## Measuring Savings

Dashboard → Usage → Token Savings

Shows:

- Original token count
- Compressed token count
- Savings percentage
- Cumulative savings over time

---

## When RTK Helps Most

| Scenario | Typical Savings |
|----------|----------------|
| `git diff` on large changes | 30-50% |
| `grep` with many results | 20-40% |
| `ls` on large directories | 40-60% |
| `find` deep trees | 30-50% |
| Log files with repetition | 50-70% (dedup) |
| Combined tool outputs | 20-40% overall |

---

## Troubleshooting

### RTK not compressing

- Check if RTK is enabled in settings
- Verify tool_result content matches a known filter
- Check logs: `ENABLE_REQUEST_LOGS=true`

### RTK breaking content

- Should not happen — RTK falls back to original on error
- If context is lost, report with request logs

### Want to add a custom filter

1. Create filter in `open-sse/rtk/filters/myFilter.js`
2. Export `{ name, detect(content), compress(content) }`
3. Register in `open-sse/rtk/registry.js`
4. Add detection pattern in `open-sse/rtk/autodetect.js`
