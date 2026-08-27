# OpenAI Codex Integration

Connect OpenAI Codex CLI to 9Router.

---

## Configuration

Add the following environment variables to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="sk_9router"
```

Reload your profile:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

---

## Usage

```bash
codex --model cx/gpt-5.5 "Implement a LRU cache in Python"
```
