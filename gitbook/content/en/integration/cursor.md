# Cursor IDE Integration

Route AI requests from Cursor IDE through 9Router.

---

## Configuration

1. In Cursor, open **Settings** (`Cmd + ,` or `Ctrl + ,`).
2. Navigate to **Models** → **OpenAI API Key / Base URL**.
3. Set the **Base URL** to:
   ```
   http://localhost:20128/v1
   ```
4. Set the **API Key** to `sk_9router` (or your 9Router API key if `REQUIRE_API_KEY=true`).
5. Add target models (e.g. `cc/claude-opus-4-7`, `kr/claude-sonnet-4.5`, or combo names).
