# Claude Code Integration

Route Claude Code CLI requests through 9Router for token savings and automatic fallback.

---

## Configuration

Add the base URL to your shell configuration (`~/.zshrc` or `~/.bashrc`):

```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
```

Reload your shell:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

---

## Model Overrides (Optional)

You can specify specific 9Router models or combos:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-4-7"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-4-6"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

---

## Verification

Run Claude Code as normal:
```bash
claude "Explain the authentication flow in this codebase"
```
