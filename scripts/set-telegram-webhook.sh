#!/usr/bin/env bash
# One-shot: register the bot's webhook with Telegram + register the slash-command
# menu so users see auto-complete suggestions when they type "/".
#
# Required env vars (read from your shell, not from .env):
#   TELEGRAM_BOT_TOKEN       - from @BotFather
#   TELEGRAM_WEBHOOK_SECRET  - same value you set in Fly secrets
#   PUBLIC_BASE_URL          - https://airouter-kh.fly.dev (or your custom domain)
#
# Idempotent. Safe to re-run after each deploy that adds new commands.
set -euo pipefail

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN required}"
: "${TELEGRAM_WEBHOOK_SECRET:?TELEGRAM_WEBHOOK_SECRET required}"
: "${PUBLIC_BASE_URL:?PUBLIC_BASE_URL required (e.g. https://airouter-kh.fly.dev)}"

URL="${PUBLIC_BASE_URL%/}/api/telegram"
TG="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"

echo "Registering webhook: ${URL}"
curl -fsS -X POST "${TG}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "url": "${URL}",
  "secret_token": "${TELEGRAM_WEBHOOK_SECRET}",
  "allowed_updates": ["message"],
  "drop_pending_updates": true
}
JSON
)"
echo

echo "Registering slash-command menu..."
curl -fsS -X POST "${TG}/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{
  "commands": [
    {"command":"translate",  "description":"Translate text to another language"},
    {"command":"summarize",  "description":"Summarize text or a URL"},
    {"command":"post",       "description":"Generate social-media post (twitter/linkedin/fb/ig/tiktok/thread)"},
    {"command":"script",     "description":"Write a video script (hook/30s/60s/3min)"},
    {"command":"idea",       "description":"Generate 5 content ideas"},
    {"command":"song",       "description":"Write a song (--genre pop --mood happy topic)"},
    {"command":"setlang",    "description":"Set default output language"},
    {"command":"img",        "description":"Generate an image from a prompt"},
    {"command":"say",        "description":"Read text aloud (TTS)"},
    {"command":"find",       "description":"Search the web"},
    {"command":"get",        "description":"Fetch and extract a URL"},
    {"command":"usage",      "description":"Show usage chart"},
    {"command":"model",      "description":"Set the default chat model"},
    {"command":"models",     "description":"List LLM models"},
    {"command":"listmodels", "description":"List models by kind (image/tts/stt/...)"},
    {"command":"status",     "description":"Gateway health + provider count"},
    {"command":"quota",      "description":"Connected providers + today usage"},
    {"command":"reset",      "description":"Clear conversation memory"},
    {"command":"history",    "description":"Show last 10 turns"},
    {"command":"myid",       "description":"Show your chat id"},
    {"command":"help",       "description":"Show full help"}
  ]
}'
echo

echo "Verifying webhook info:"
curl -fsS "${TG}/getWebhookInfo"
echo
