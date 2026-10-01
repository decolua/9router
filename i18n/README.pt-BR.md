<div align="center">
  <img src="../images/9router.png?1" alt="Painel do 9Router" width="800"/>
  
  # 9Router — roteador de IA GRATUITO e economizador de tokens
  
  **Nunca pare de codificar. Economize 20-40% de tokens com RTK + fallback automático para modelos de IA GRATUITOS e baratos.**
  
  **Conecte todas as ferramentas de código de IA (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) a mais de 40 provedores de IA e mais de 100 modelos.**
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
  [![Licença](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🚀 Início rápido](#-início-rápido) • [💡 Recursos](#-principais-recursos) • [📖 Configuração](#-guia-de-configuração) • [🌐 Site](https://9router.com)

[🇺🇸 English](../README.md) • [🇻🇳 Tiếng Việt](./README.vi.md) • [🇨🇳 中文](./README.zh-CN.md) • [🇯🇵 日本語](./README.ja-JP.md) • [🇷🇺 Русский](./README.ru.md) • [🇹🇭 ไทย](./README.th.md) • [🇮🇷 فارسی](./README.fa_IR.md) • [🇮🇩 Indonesia](./README.id-ID.md)

</div>

---

## 🤔 Por que 9Router?

**Pare de desperdiçar dinheiro, tokens e atingir limites:**

- ❌ A cota de assinatura expira sem ser utilizada todos os meses
- ❌ Os limites de requisições interrompem você durante a programação
- ❌ Saídas de ferramentas (`git diff`, `grep`, `ls`...) consomem tokens rapidamente
- ❌ APIs caras ($20–50/mês por provedor)
- ❌ Troca manual entre provedores

**9Router resolve isso:**

- ✅ **RTK Token Saver** - Compactação automática do conteúdo de `tool_result`, economize 20-40% de tokens por solicitação
- ✅ **Maximize as assinaturas** - Rastreie a cota, aproveite toda a cota antes da renovação
- ✅ **Auto fallback** - Assinatura → Econômico → Gratuito, sem tempo de inatividade
- ✅ **Múltiplas contas** - Round-robin entre contas por provedor
- ✅ **Universal** - Funciona com Claude Code, Codex, Cursor, Cline, qualquer ferramenta CLI

---

## 🔄 Como funciona

```
┌─────────────┐
│  Sua CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│   Ferramenta│
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router (Roteador inteligente)            │
│  • RTK Token Saver (reduz tokens de `tool_result`) │
│  • Tradução de formatos (OpenAI ↔ Claude)     │
│  • Acompanhamento de cotas                           │
│  • Renovação automática de token                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [Nível 1: ASSINATURA] Claude Code, Codex, GitHub Copilot
       │   ↓ cota esgotada
       ├─→ [Nível 2: ECONÔMICO] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ limite de orçamento
       └─→ [Nível 3: GRATUITO] Kiro, OpenCode Free, Vertex ($300 em créditos)

Resultado: programe sem interrupções, com custo mínimo e economia de 20% a 40% dos tokens via RTK
```

---

## ⚡ Início rápido

**1. Instale globalmente:**

```bash
npm install -g 9router
9router
```

🎉 O painel abre em `http://localhost:20128`

**2. Conecte um provedor GRATUITO (sem necessidade de inscrição):**

Painel → Provedores → Conecte **Kiro AI** (~50 créditos/mês grátis: Claude 4.5 + GLM-5 + MiniMax) ou **OpenCode Free** (sem autenticação) → Pronto!

**3. Use em sua ferramenta CLI:**

```
Configurações do Claude Code/Codex/OpenClaw/Cursor/Cline:
  Endpoint: http://localhost:20128/v1
  API Key: [copie do painel]
  Model: kr/claude-sonnet-4.5
```

**É isso aí!** Comece a codificar com modelos de IA GRATUITOS.

**Alternativa: executar a partir do código-fonte (este repositório):**

Este pacote de repositório é privado (`9router-app`), portanto, a execução pelo código-fonte/Docker é o caminho de desenvolvimento local esperado.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Modo de produção:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URLs padrão:

- Painel: `http://localhost:20128/dashboard`
- API compatível com OpenAI: `http://localhost:20128/v1`

---

## Guias de vídeo

<div align="center">

<table>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
        <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="Tiết kiệm chi phí LLM với 9Router" width="300"/>
</a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Tiết kiệm chi phí LLM cho OpenClaw no 9Router<br/>por <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://youtu.be/VQAw612S27Y">
        <img src="https://img.youtube.com/vi/VQAw612S27Y/maxresdefault.jpg" alt="9Router + Claude Code FREE Unlimited Setup" width="300"/>
      </a><br/>
      <b>🇵🇰 اردو / हिन्दी</b><br/>
      <sub>9Router + Claude Code Configuração ilimitada GRATUITA<br/>por <a href="https://www.youtube.com/@BuildAIWithHamid">Construir IA com Hamid</a></sub>
    </td>
    <td align="center" width="320">
<a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 Inglês</b><br/>
      <sub>9Router + Claude Code Configuração GRATUITA<br/>por <a href="https://www.youtube.com/@BuildAIWithHamid">Construir IA com Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://youtu.be/3dF5GIYMrcQ?si=bAyfyiHbARJQAHj_">
        <img src="https://img.youtube.com/vi/3dF5GIYMrcQ/hqdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 Inglês</b><br/>
      <sub>9Router + Claude Code Configuração GRATUITA<br/>por <a href="https://www.youtube.com/@BuildAIWithHamid">Construir IA com Hamid</a></sub>
</td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code FREE Forever" width="300"/>
      </a><br/>
      <b>🇺🇸 Inglês</b><br/>
      <sub>Claude Code FREE Forever - Modelos ilimitados<br/>por <a href="https://www.youtube.com/@BuildAIWithHamid">Construa IA com Hamid</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
<img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇺🇸 Inglês</b><br/>
      Configuração gratuita <sub>Claude CLI com 9Router 🚀<br/>por <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="Cài đặt OpenClaw Free A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Cài Đặt OpenClaw Free Từ A-Z + 9Router<br/>por <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
<td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="FREE OpenClaw with Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 Inglês</b><br/>
      <sub>FREE OpenClaw + Claude Opus 4.6<br/>por <a href="https://www.youtube.com/@BuildAIWithHamid">Construir IA com Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=CkVZZUSTXAI">
        <img src="https://img.youtube.com/vi/CkVZZUSTXAI/mqdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonésia</b><br/>
<sub>Koding 24 Jam Anti Rate Limit! Hemat Token AI 65% | Tutorial Configuração Rápida 9Router 🚀<br/>por <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=TXGv4eofe1I">
        <img src="https://img.youtube.com/vi/TXGv4eofe1I/mqdefault.jpg" alt="Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonésia</b><br/>
      <sub>Cara Implante 9Router no Hugging Face GRATUITAMENTE sem parar! | Alternativa VPS RAM 16GB<br/>por <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="320">
<a href="https://www.youtube.com/watch?v=GyX-DLvePW8">
        <img src="https://img.youtube.com/vi/GyX-DLvePW8/hqdefault.jpg" alt="این شکلی از هر API ای استفاده کن برای هوش مصنوعی" width="300"/>
      </a><br/>
      <b>🇮🇷 Persa-فارسی</b><br/>
      <sub dir="rtl">این شکلی از هر API ای استفاده کن برای هوش مصنوعی<br/>por <a href="https://www.youtube.com/@Matin_SenPai">Matin SenPai</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=hPusYX-5Pmw">
        <img src="https://img.youtube.com/vi/hPusYX-5Pmw/maxresdefault.jpg" alt="Hướng Dẫn Setup OpenClaw + 9Router: Tạo Bot Zalo AI Tự Động Từ A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Hướng Dẫn Setup OpenClaw + 9Router: Tạo Bot Zalo AI Tự Động Từ A-Z<br/>por <a href="https://github.com/tuanminhhole">tuanminhhole</a></sub>
</td>
    <td align="center" width="320"></td>
    <td align="center" width="320"></td>
    <td align="center" width="320"></td>
  </tr>
</table>

</div>

> 🎬 **Fez um vídeo sobre o 9Router?** Envie um [Pull Request](https://github.com/decolua/9router/pulls) adicionando seu vídeo a esta seção - nós o mesclaremos!

---

## 🛠️ Ferramentas CLI suportadas

9Router funciona perfeitamente com todas as principais ferramentas de codificação de IA:

<div align="center">
  <table>
<tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Código-Claude</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
</td>
      <td align="center" width="120">
        <img src="../public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>antigravidade</b>
</td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continuar</b>
      </td>
      <td align="center" width="120">
<img src="../public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
<img src="../public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Código Kilo</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/opendesign.png" width="60" alt="OpenDesign"/><br/>
        <b>OpenDesign</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/jcode.png" width="60" alt="jcode"/><br/>
        <b>jcódigo</b>
</td>
      <td align="center" width="120">
        <img src="../public/providers/grok-cli.png" width="60" alt="Grok Build"/><br/>
        <b>Grok Build</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/devin-cli.png" width="60" alt="Devin CLI"/><br/>
        <b>Devin CLI</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/deepseek-tui.png" width="60" alt="DeepSeek TUI"/><br/>
        <b>DeepSeek TUI</b>
</td>
      <td align="center" width="120">
        <img src="../public/providers/qwen.png" width="60" alt="Qwen Code"/><br/>
        Código <b>Qwen</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 Provedores compatíveis

### 🔐 Provedores OAuth

<div align="center">
  <table>
<tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Código-Claude</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>antigravidade</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
</td>
      <td align="center" width="120">
        <img src="../public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/kimchi.png" width="60" alt="Kimchi"/><br/>
        <b>Kimchi</b>
</td>
    </tr>
  </table>
</div>

### 🆓 Provedores gratuitos

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>50 créditos/mês grátis</sub>
</td>
      <td align="center" width="150">
        <img src="../public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode grátis</b><br/>
        <sub>Sem autenticação • Modelos de busca automática<br/>Grátis (a lista de modelos varia)</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>$300 créditos grátis</sub>
      </td>
    </tr>
</table>
</div>

> **Observação:** Os níveis gratuitos iFlow, Qwen Code e Gemini CLI foram descontinuados em 2026. Em vez disso, use Kiro / OpenCode Free / Vertex.
>
> **Kiro AI** mudou para um modelo pago em setembro de 2025 — o nível gratuito agora é limitado a **50 créditos/mês** (mais 500 créditos de avaliação para novas contas nos primeiros 30 dias). Camadas pagas: Pro $20/mo (1.000 créditos), Pro+ $40/mo (2.000), Pro Max $100/mo (5.000), Power $200/mo (10.000).
> A lista de modelos **OpenCode Free** varia com o tempo (alguns modelos são gratuitos apenas para promoções limitadas) — sujeito a alterações sem aviso prévio.
> **Vertex AI**: o crédito gratuito $300 para novas contas do GCP ainda é válido, mas desde março de 2026 o **endpoint da API Gemini não consome mais esses créditos**. Em vez disso, chame o endpoint **Vertex AI Studio**.

### 🔑 Provedores de chaves de API (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
<sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
<sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Antrópico</sub>
      </td>
    </tr>
    <tr>
<td align="center" width="100">
        <img src="../public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
<td align="center" width="100">
        <img src="../public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexidade</sub>
      </td>
</tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Juntos AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fogos de artifício</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
<sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
<sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...e mais de 20 provedores, incluindo Nebius, Chutes, Hyperbolic e endpoints personalizados compatíveis com OpenAI/Anthropic</i></p>
</div>

### 🏠 Provedores auto-hospedados

Para fala e incorporações veiculadas em **sua própria** máquina — whisper.cpp,
faster-whisper, Speaches, Kokoro-FastAPI, openai-speech, llama.cpp/llama-server,
vLLM, Infinity, text-embeddings-inference ou qualquer outro serviço compatível com o formato OpenAI.

| Provedor | Ponto final usado | Servidor típico |
| --- | --- | --- |
| **STT auto-hospedado** | `/v1/audio/transcriptions` | whisper.cpp, faster-whisper |
| **TTS auto-hospedado** | `/v1/audio/speech` | Kokoro-FastAPI, openedai-speech |
| **Incorporação auto-hospedada** | `/v1/embeddings` | llama-server, vLLM, Infinity |

Todos os outros provedores de voz são um serviço de nuvem nomeado com um endpoint fixo. Estes
três leem seus endereços de **cada conexão**, para que um provedor possa apontar para
várias máquinas e balanceamento de carga entre elas como qualquer outra.

Defina-o na conexão como `providerSpecificData.baseUrl`:

| Provedor | Informe | Resultado |
| --- | --- | --- |
| STT auto-hospedado | o URL completo — `http://host:8080/v1/audio/transcriptions` | usado como está |
| TTS auto-hospedado | a raiz do servidor — `http://host:8880` | `+ /v1/audio/speech` |
| Incorporação auto-hospedada | a **base OpenAI**, `/v1` incluída — `http://host:8080/v1` | `+ /embeddings` |

> **Cuidado com `/v1` em embeddings.** O adaptador anexa `/embeddings`, então
> `http://host:8080` resolve para `http://host:8080/embeddings` e perde o
> rota OpenAI – o llama-server responde **501**. Dê a ele o mesmo URL base de um OpenAI
> o cliente usaria. Um `.../v1/embeddings` completo também é aceito, então um valor colado
> de um exemplo `curl` também funciona.

A chave API não é verificada pela maioria dos servidores locais, mas o campo não deve estar vazio:
é o que dá à conexão um registro de credenciais, e `baseUrl` reside lá.
Qualquer espaço reservado funciona.

A incorporação auto-hospedada **não tem fallback na nuvem por design** — uma conexão salva
sem um `baseUrl` é relatado como um erro de configuração, em vez de silenciosamente
voltando para `api.openai.com`, que enviaria seu texto de entrada e chave de API para
terceiros por meio de um provedor chamado "Auto-hospedado".

---

## 💡 Principais recursos

| Recurso | O que faz | Por que é importante |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 🚀 **RTK Token Saver** ([RTK](https://github.com/rtk-ai/rtk) ⭐40K) | Compactar saídas de ferramentas (`git diff`, `grep`, `ls`, `tree`...) antes de enviar para LLM | Economize **20-40% de tokens de entrada** por solicitação |
| 🧠 **Headroom Token Saver** ([Headroom](https://github.com/chopratejas/headroom)) | Proxy `/v1/compress` externo opcional antes do roteamento do provedor | Economize mais tokens de contexto sem alterar clientes |
| 🪨 **Modo Caveman** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K) | Injetar prompt de fala do homem das cavernas → Respostas do LLM concisas, substância técnica preservada | Economize **até 65% de tokens de produção** |
| 🐴 **Ponytail** ([Ponytail](https://github.com/DietrichGebert/ponytail)) | Injetar prompt "lazy senior dev" → LLM escreve código mínimo YAGNI primeiro (Lite/Full/Ultra) | **Menos tokens de saída, menos refatoração** |
| 🎯 **Fallback inteligente de 3 camadas** | Rota automática: Assinatura → Barato → Grátis | Nunca pare de codificar, tempo de inatividade zero |
| 📊 **Acompanhamento de cotas em tempo real** | Contagem de tokens ao vivo + contagem regressiva de redefinição | Maximizar o valor da assinatura |
| 🔄 **Tradução de formato** | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex | Funciona com qualquer ferramenta CLI |
| 👥 **Suporte para múltiplas contas** | Várias contas por provedor | Balanceamento de carga + redundância |
| 🔄 **Atualização automática de token** | Os tokens OAuth são atualizados automaticamente | Não é necessário fazer novo login manual |
| 🎨 **Combos Personalizados** | Crie combinações ilimitadas de modelos | Adapte o fallback às suas necessidades |
| 📝 **Registro de requisições** | Modo de depuração com logs completos de solicitação/resposta | Solucione problemas facilmente |
| 💾 **Sincronização na nuvem** | Sincronizar configuração entre dispositivos | Mesma configuração em todos os lugares |
| 📊 **Análise de uso** | Acompanhe tokens, custos e tendências ao longo do tempo | Otimizar gastos |
| 🌐 **Implante em qualquer lugar** | Localhost, VPS, Docker, Cloudflare Workers | Opções flexíveis de implantação |

Configure `X-9Router-Token-Saver: off` para ignorar todos os economizadores de tokens para uma solicitação de chat.

<details>
<summary><b>📖 Detalhes do recurso</b></summary>

### 🚀 RTK Token Saver

As saídas da ferramenta (`git diff`, `grep`, `find`, `ls`, `tree`, despejos de log...) geralmente consomem de 30 a 50% do seu orçamento de contexto. O RTK os detecta e aplica compactação inteligente e sem perdas **antes** que a solicitação chegue ao LLM:

- **Filtros:** `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`
- **Detecção automática:** Não é necessária configuração — o RTK inspeciona o primeiro 1 KB de cada `tool_result` e escolhe o filtro correto.
- **Seguro por design:** Se um filtro falhar, gerar uma exceção ou aumentar a saída, o RTK mantém silenciosamente o texto original. Erros nunca interrompem sua solicitação.
- **Universal:** Funciona em todos os formatos (OpenAI, Claude, Gemini, Cursor, Kiro, OpenAI Responses) porque é executado **antes** de qualquer tradução de formato.
- **Padrão ATIVADO:** Alterne a qualquer momento em Painel → Configurações de endpoint.

```
Sem RTK: 47 mil tokens enviados ao LLM
Com RTK: 28 mil tokens enviados ao LLM (40% de economia · mesmo contexto · mesma resposta)
```

### 🧠 Headroom Token Saver

O headroom é opcional e funciona separadamente. 9Router chama o endpoint `/v1/compress` local do Headroom e, em seguida, mantém roteamento normal, fallback, autenticação e rastreamento de uso:

```
Cliente → 9Router → Headroom /v1/compress → 9Router → provedor
```

Configuração local:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

Habilite em Painel → Endpoint → Economia de tokens → Headroom. URL padrão: `http://localhost:8787`.

Exemplos de Docker:

```bash
# Serviço Headroom na mesma rede Docker
http://headroom:8787

# Headroom em execução na máquina host
http://host.docker.internal:8787
```

Se o Headroom estiver inativo ou retornar um erro, o o 9Router seguirá em modo aberto e enviará a solicitação original.

### 🐴 Ponytail (desenvolvedor sênior preguiçoso)

O Ponytail injeta um prompt do sistema _"lazy senior dev"_ em cada solicitação, direcionando o LLM para o código mínimo, primeiro YAGNI - preferindo exclusão a adição, stdlib sobre novos deps, one-liners sobre abstrações. Adaptado de [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

- **Lite** — Construa o que for solicitado, nomeie a alternativa mais preguiçosa.
- **Full** — escada YAGNI aplicada: stdlib → nativo → dependências existentes → one-liner → código mínimo.
- **Ultra** — Extremista YAGNI: exclua primeiro, envie a linha única, desafie o restante do requisito na mesma resposta.

```
Sem Ponytail: código verboso, abstrações extras e estrutura "por precaução"
Com Ponytail: menor diff funcional, sem abstrações não solicitadas e menos tokens
```

Nunca negocie: validação de entrada, tratamento de erros que evita perda de dados, segurança, acessibilidade ou qualquer coisa explicitamente solicitada. Ative em Painel → Endpoint → Ponytail. Pode ser combinado com Caveman (concisão de saída) e RTK (compressão de entrada).

### 🎯 Fallback inteligente de 3 camadas

Crie combos com fallback automático:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (sua assinatura)
  2. glm/glm-4.7               (backup econômico, $0,60/1M)
  3. if/kimi-k2-thinking       (fallback gratuito)

→ Alterna automaticamente quando a cota acaba ou ocorre um erro
```

### 📊 Rastreamento de cotas em tempo real

- Consumo de token por provedor
- Redefinir contagem regressiva (5 horas, diariamente, semanalmente)
- Estimativa de custos para níveis pagos
- Relatórios mensais de gastos

### 🔄 Tradução de formato

Tradução perfeita entre formatos:

- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- Sua ferramenta CLI envia formato OpenAI → 9Router traduz → Provedor recebe formato nativo
- Funciona com qualquer ferramenta que suporte endpoints OpenAI personalizados

### 👥 Suporte para múltiplas contas

- Adicione várias contas por provedor
- Round-robin automático ou roteamento baseado em prioridade
- Fallback para a próxima conta quando uma delas atingir a cota

### 🔄 Atualização automática de token

- Os tokens OAuth são atualizados automaticamente antes da expiração
- Não é necessária reautenticação manual
- Experiência perfeita em todos os provedores

### 🎨 Combos Personalizados

- Crie combinações ilimitadas de modelos
- Combine níveis de assinatura, baratos e gratuitos
- Nomeie seus combos para facilitar o acesso
- Compartilhe combos entre dispositivos com Cloud Sync

### 📝 Registro de requisições

- Habilite o modo de depuração para logs completos de solicitação/resposta
- Rastreie chamadas de API, cabeçalhos e payloads
- Solucionar problemas de integração
- Exportar logs para análise

### 💾 Sincronização na nuvem

- Sincronize provedores, combos e configurações entre dispositivos
- Sincronização automática em segundo plano
- Armazenamento criptografado seguro
- Acesse sua configuração de qualquer lugar

#### Notas de tempo de execução na nuvem

- Prefira variáveis de nuvem do lado do servidor na produção:
  - `BASE_URL` (URL interna de callback usado pelo agendador de sincronização)
  - `CLOUD_URL` (base de endpoint de sincronização em nuvem)
- `NEXT_PUBLIC_BASE_URL` e `NEXT_PUBLIC_CLOUD_URL` ainda são suportados para compatibilidade/UI, mas o tempo de execução do servidor agora prioriza `BASE_URL`/`CLOUD_URL`.
- As solicitações de sincronização na nuvem agora usam o comportamento de tempo limite + falha rápida para evitar o travamento da interface do usuário quando o DNS/rede da nuvem estiver indisponível.

### 📊 Análise de uso

- Rastreie o uso de token por provedor e modelo
- Estimativa de custos e tendências de gastos
- Relatórios e insights mensais
- Otimize seus gastos com IA

> **💡 IMPORTANTE - Compreendendo os custos do painel:**
>
> O "custo" exibido no Usage Analytics é **apenas para fins de rastreamento e comparação**.
> O próprio 9Router **nunca cobra** nada. Você paga apenas aos provedores diretamente (se usar serviços pagos).
>
> **Exemplo:** Se o seu painel mostrar "Custo total $290" ao usar modelos gratuitos do Kiro, isso representa
> o que você pagaria usando APIs pagas diretamente. Seu custo real = **$0** (nível gratuito do Kiro: ~50 créditos/mês).
>
> Pense nisso como um "rastreador de economia" que mostra quanto você está economizando usando modelos gratuitos ou
> roteamento através do 9Router!

### 🌐 Implante em qualquer lugar

- 💻 **Localhost** - Padrão, funciona offline
- ☁️ **VPS/Cloud** - Compartilhe entre dispositivos
- 🐳 **Docker** – Implantação com um comando
- 🚀 **Cloudflare Workers** - Rede global de edge

</details>

---

## 💰 Visão geral dos preços

| Nível | Provedor | Custo | Redefinição de cota | Melhor para |
| ------------------- | --------------------- | ------------ | ---------------- | --------------------------------------- |
| **🚀 ECONOMIA DE TOKEN** | **RTK (integrado)** | **GRÁTIS** | Sempre ligado | **Economize 20-40% de tokens em CADA solicitação** |
| **💳 ASSINATURA** | Claude Code (Pro/Max) | $20-200/mo | 5h + semanalmente | Já inscrito |
|                     | Codex (Plus/Pro) | $20-200/mo | 5h + semanalmente | Usuários OpenAI |
|                     | GitHub Copilot | $10-19/mo | Mensalmente | Usuários do GitHub |
|                     | Cursor IDE | $20/mo | Mensalmente | Usuários de cursor |
| **💰 BARATO** | GLM-5.1/GLM-4.7 | $0.6/1M | Diariamente 10h | Backup de orçamento |
|                     | MiniMax M2.7 | $0.2/1M | Rolamento de 5 horas | Opção mais barata |
|                     | Kimi K2.5 | $9/mo plano | 10 milhões de tokens/mês | Custo previsível |
 | **🆓 GRÁTIS** | Kiro AI | $0 | 50 créditos/mês | Claude 4.5 + GLM-5 + MiniMax grátis (níveis pagos acima) |
 |                     | OpenCode Free | $0 | Varia* | Sem autenticação, modelos de busca automática (a lista muda ao longo do tempo) |
|                     | Vertex AI | Créditos $300 | Novas contas do GCP | Gemini 3 Pro + DeepSeek + GLM-5 (use o endpoint Vertex AI Studio para obter créditos gratuitos) |

**💡 Dica profissional:** combinação RTK + Kiro AI + OpenCode grátis = **custo $0 + economia de token de 20-40%**!

---

### 📊 Compreendendo os custos e faturamento do 9Router

**Como funciona o faturamento do 9Router:**

✅ **Software 9Router = GRATUITO para sempre** (código aberto, nunca cobra)  
✅ **Painel "custos" = Somente exibição/rastreamento** (não são cobranças reais)  
✅ **Você paga diretamente aos provedores** (assinaturas ou taxas de API)  
✅ **Provedores GRATUITOS permanecem GRATUITOS** (Kiro ~50 créditos/mês, OpenCode Free, créditos do Vertex $300 = $0 dentro dos limites do nível gratuito) — observe que os níveis gratuitos do iFlow/Qwen/Gemini CLI foram descontinuados em 2026
❌ **9Router nunca envia faturas** ou cobra seu cartão

**Como funciona a exibição de custos:**

O painel mostra **custos estimados** como se você estivesse usando APIs pagas diretamente. Isto **não é cobrança** - é uma ferramenta de comparação para mostrar suas economias.

**Cenário de exemplo:**

```
Exibição no painel:
• Total de requisições: 1,662
• Total de tokens: 47M
• Custo exibido: $290

Custo real:
• Provedor: Kiro (nível gratuito: ~50 créditos/mês)
• Pagamento real: $0.00
• O que $290 significa: valor ECONOMIZADO ao usar modelos gratuitos!
```

**Regras de pagamento:**

- **Provedores de assinatura** (Claude Code, Codex): pague diretamente por meio de seus sites
- **Provedores baratos** (GLM, MiniMax): pague diretamente, 9Router apenas roteia
- **Provedores GRATUITOS** (iFlow, Kiro, Qwen): Genuinamente grátis para sempre, sem taxas ocultas
- **9Router**: Nunca cobra nada

---

## 🎯 Casos de uso

### Caso 1: "Tenho assinatura do Claude Pro"

**Problema:** A cota expira sem ser utilizada, limites de taxa durante codificação pesada

**Solução:**

```
Combo: "maximize-claude"
  1. cc/claude-opus-4-7        (use toda a assinatura)
  2. glm/glm-5.1               (backup econômico quando a cota acabar)
  3. kr/claude-sonnet-4.5      (fallback gratuito de emergência)

Custo mensal: $20 (assinatura) + ~$5 (backup) = $25 total
versus $20 + atingir limites = frustração
```

### Caso 2: "Quero custo zero"

**Problema:** Não posso pagar assinaturas, preciso de codificação de IA confiável

**Solução:**

```
Combo: "free-forever"
  1. kr/claude-sonnet-4.5      (Claude 4.5 gratuito via Kiro, ~50 créditos/mês)
  2. kr/glm-5                  (GLM-5 gratuito via Kiro)
  3. oc/<auto>                 (OpenCode Free, sem autenticação)

Custo mensal: $0
Qualidade: modelos prontos para produção + economia de 20–40% com RTK
```

### Caso 3: "Preciso de codificação 24 horas por dia, 7 dias por semana, sem interrupções"

**Problema:** Prazos, não podemos arcar com o tempo de inatividade

**Solução:**

```
Combo: "always-on"
  1. cc/claude-opus-4-7        (melhor qualidade)
  2. cx/gpt-5.5                (segunda assinatura)
  3. glm/glm-5.1               (econômico, renova diariamente)
  4. minimax/MiniMax-M2.7      (mais econômico, renovação em 5h)
  5. kr/claude-sonnet-4.5      (gratuito via Kiro, ~50 créditos/mês)

Resultado: 5 camadas de fallback = nenhuma interrupção
Custo mensal: $20-200 (subscriptions) + $10-20 (backup)
```

### Caso 4: "Quero IA GRATUITA no OpenClaw"

**Problema:** Precisa de assistente de IA em aplicativos de mensagens (WhatsApp, Telegram, Slack...), totalmente gratuito

**Solução:**

```
Combo: "openclaw-free"
  1. kr/claude-sonnet-4.5      (Claude 4.5 gratuito)
  2. kr/glm-5                  (GLM-5 gratuito)
  3. kr/MiniMax-M2.5           (MiniMax gratuito)

Custo mensal: $0
Acesso por: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Perguntas frequentes

<details>
<summary><b>📊 Por que meu painel mostra custos altos?</b></summary>

O painel rastreia o uso do token e exibe **custos estimados** como se você estivesse usando APIs pagas diretamente. Este **não é faturamento real** - é uma referência para mostrar quanto você está economizando usando modelos gratuitos ou assinaturas existentes através do 9Router.

**Exemplo:**

- **O painel mostra:** "Custo total $290"
- **Realidade:** Você está usando modelos gratuitos do Kiro (~50 créditos/mês)
- **Seu custo real:** **$0.00**
- **O que significa $290:** Valor que você **economizou** usando modelos gratuitos em vez de APIs pagas!

A exibição de custos é um "rastreador de economia" para ajudá-lo a entender seus padrões de uso e oportunidades de otimização.

</details>

<details>
<summary><b>💳 Serei cobrado pelo 9Router?</b></summary>

**Não.** 9Router é um software gratuito e de código aberto que roda em seu próprio computador. Nunca cobra nada.

**Você só paga:**

- ✅ **Provedores de assinatura** (Claude Code $20/mo, Codex $20-200/mo) → Pague-os diretamente em seus sites
- ✅ **Provedores baratos** (GLM, MiniMax) → Pague diretamente, 9Router apenas encaminha suas solicitações
- ❌ **9Router em si** → **Nunca carrega nada, nunca**

9Router é um proxy/roteador local. Não possui cartão de crédito, não pode enviar faturas e não possui sistema de cobrança. É um software totalmente gratuito.

</details>

<details>
<summary><b>🆓 Os provedores GRATUITOS são realmente ilimitados?</b></summary>

**Principalmente!** Os provedores GRATUITOS atuais (Kiro, OpenCode Free, Vertex) são genuinamente gratuitos, mas os níveis gratuitos têm limites:

Estes são serviços gratuitos oferecidos pelas respectivas empresas:

- **Kiro AI**: ~50 créditos/mês grátis (mais 500 créditos de avaliação para novas contas nos primeiros 30 dias) via AWS Builder ID / Google / GitHub OAuth. Níveis pagos disponíveis acima disso.
- **OpenCode Free**: proxy de passagem sem autenticação, modelos buscados automaticamente em `opencode.ai/zen/v1/models`. A lista de modelos gratuitos varia com o tempo (alguns modelos são gratuitos apenas para promoções limitadas) — sujeita a alterações sem aviso prévio.
- **Vertex AI**: créditos gratuitos $300 para novas contas do Google Cloud (90 dias). Desde março de 2026, o endpoint da API Gemini não consome mais esses créditos. Em vez disso, use o endpoint **Vertex AI Studio**.

O 9Router apenas encaminha suas solicitações para eles - não há pegadinhas ou cobrança futura do próprio 9Router. Eles são serviços verdadeiramente gratuitos e o 9Router os torna fáceis de usar com suporte alternativo.

**Níveis gratuitos descontinuados (não mais recomendados):**

- ❌ **iFlow**: era gratuito e ilimitado, agora alterado para pago (2026)
- ❌ **Qwen Code**: nível OAuth gratuito totalmente descontinuado pelo Alibaba em 15/04/2026
- ❌ **Gemini CLI**: Serviço totalmente encerrado pelo Google em 18/06/2026 (substituído pelo Antigravity CLI de código fechado). Descontinuado – não use.

</details>

<details>
<summary><b>💰 Como posso minimizar meus custos reais de IA?</b></summary>

**Estratégia Grátis primeiro:**

1. **Comece com um combo 100% grátis:**

   ```
   1. kr/glm-5 (GLM-5 gratuito via Kiro, ~50 créditos/mês)
   2. Modelos do OpenCode Free (sem autenticação, obtidos automaticamente)
   3. Vertex AI Gemini 3 Pro (usando o endpoint do Vertex AI Studio com $300 em créditos)
   ```

   **Custo: $0/mês** (dentro do limite de crédito gratuito do Kiro; OpenCode/Vertex sujeito aos limites de nível gratuito)

2. **Adicione backup barato** apenas se precisar:

   ```
   4. glm/glm-4.7 ($0,60/1M tokens)
   ```

   **Custo adicional: pague apenas pelo que você realmente usa**

3. **Use os provedores de assinatura por último:**
   - Somente se você já os tiver
- 9Router ajuda a maximizar seu valor por meio do rastreamento de cotas

**Resultado:** A maioria dos usuários pode operar em $0/mês usando apenas níveis gratuitos!

</details>

<details>
<summary><b>📈 E se meu uso aumentar repentinamente?</b></summary>

O fallback inteligente do 9Router evita cobranças surpresa:

**Cenário:** você está em um sprint de codificação e ultrapassa suas cotas

**Sem 9Router:**

- ❌ Limite de requisições atingido → Paradas de trabalho → Frustração
- ❌ Ou: acidentalmente acumular enormes contas de API

**Com 9Router:**

- ✅ Assinatura atinge o limite → Retorno automático para nível barato
- ✅ O nível barato fica caro → Retorno automático para o nível gratuito
- ✅ Nunca pare de codificar → Custos previsíveis

**Você está no controle:** Defina limites de gastos por provedor no painel e o 9Router os respeita.

</details>

---

## 📖 Guia de configuração

<details>
<summary><b>🔐 Provedores de assinatura (maximizar valor)</b></summary>

### Claude Code (Pro/Max)

```bash
Painel → Provedores → Conectar Claude Code
→ OAuth login → Renovação automática de token
→ Acompanhamento de cota de 5 horas + semanal

Modelos:
  cc/claude-opus-4-7
  cc/claude-opus-4-6
  cc/claude-sonnet-4-6
  cc/claude-haiku-4-5-20251001
```

**Dica profissional:** Use o Opus para tarefas complexas e o Sonnet para velocidade. 9Router rastreia cota por modelo!

### OpenAI Codex (Plus/Pro)

```bash
Painel → Provedores → Conectar Codex
→ OAuth login (port 1455)
→ Renovação de 5 horas + semanal

Modelos:
  cx/gpt-5.5
  cx/gpt-5.4
  cx/gpt-5.3-codex
  cx/gpt-5.2-codex
```

### GitHub Copilot

```bash
Painel → Provedores → Conectar GitHub
→ OAuth via GitHub
→ Renovação mensal (dia 1º)

Modelos:
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
Painel → Provedores → Conectar Cursor
→ OAuth login
→ Assinatura mensal

Modelos:
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 Provedores baratos (backup) </b></summary>

### GLM-5.1 / GLM-4.7 (redefinição diária, $0.6/1M)

1. Inscreva-se: [Zhipu AI](https://open.bigmodel.cn/)
2. Obtenha a chave API do plano de codificação
3. Painel → Adicionar chave API:
   - Provedor: `glm`
   - Chave API: `your-key`

**Usar:** `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`

**Dica profissional:** O plano de codificação oferece cota 3× com custo de 1/7! Redefinir diariamente às 10h.

### MiniMax M2.7 (redefinição de 5h, $0.20/1M)

1. Cadastre-se: [MiniMax](https://www.minimax.io/)
2. Obtenha a chave API
3. Painel → Adicionar chave API

**Usar:** `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`

**Dica profissional:** Opção mais barata para contexto longo (1 milhão de tokens)!

### Kimi K2.5 ($9/mês plano)

1. Inscreva-se: [Moonshot AI](https://platform.moonshot.ai/)
2. Obtenha a chave API
3. Painel → Adicionar chave API

**Usar:** `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`

**Dica profissional:** $9/mês corrigido para 10 milhões de tokens = custo efetivo de $0.90/1M!

</details>

<details>
<summary><b>🆓 Provedores GRATUITOS (recomendado)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax GRATUITO)

```bash
Painel → Conectar Kiro
→ AWS Builder ID, AWS IAM Identity Center, Google ou GitHub
→ Uso conforme a cota do plano

Modelos:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**Dica profissional:** Melhor opção gratuita para Claude. Sem chave API, sem pagamento, totalmente ilimitado.

### OpenCode Free (sem autenticação, modelos de busca automática)

```bash
Painel → Conectar OpenCode Free
→ Login não necessário (proxy de passagem)
→ Modelos obtidos automaticamente de opencode.ai/zen/v1/models
```

**Dica profissional:** Configuração mais rápida. Basta conectar e começar a codificar.

### Vertex AI (créditos gratuitos $300 para novas contas do GCP)

```bash
Painel → Conectar Vertex AI
→ Envie o JSON da conta de serviço do Google Cloud
→ Ative a API Vertex AI no projeto GCP

Modelos:
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Parceiros do Vertex (Anthropic / DeepSeek / GLM / Qwen via Vertex):
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

**Dica profissional:** novas contas do Google Cloud recebem créditos $300 gratuitamente por 90 dias. Bastante para codificação diária.

</details>

<details>
<summary><b>🎨 Criar Combos</b></summary>

### Exemplo 1: Maximize a assinatura → Backup barato

```
Painel → Combos → Criar novo

Nome: premium-coding
Modelos:
  1. cc/claude-opus-4-7 (assinatura principal)
  2. glm/glm-5.1 (backup econômico, $0,60/1M)
  3. minimax/MiniMax-M2.7 (fallback mais econômico, $0,20/1M)

Use na CLI: premium-coding

Exemplo de custo mensal (100M de tokens):
  80M via Claude (assinatura): $0 extra
  15M via GLM: $9
  5M via MiniMax: $1
  Total: $10 + sua assinatura
```

### Exemplo 2: somente gratuito (custo zero)

```
Nome: free-combo
Modelos:
  1. kr/claude-sonnet-4.5 (Claude 4.5 gratuito via Kiro, ~50 créditos/mês)
  2. kr/glm-5 (GLM-5 gratuito via Kiro)
  3. vertex/gemini-3.1-pro-preview ($300 free credits)

Custo: $0 (+ economia de 20–40% de tokens com RTK)!
```

</details>

<details>
<summary><b>🔧 Integração CLI</b></summary>

### Cursor IDE

```
Configurações → Modelos → Avançado:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [copie do painel do 9Router]
  Model: cc/claude-opus-4-7
```

Ou use o combo: `premium-coding`

### Claude Code

Editar `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### CLI do Codex

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "seu prompt"
```

### OpenClaw

**Opção 1 — Painel (recomendado):**

```
Painel → Ferramentas CLI → OpenClaw → Selecionar modelo → Aplicar
```

**Opção 2 — Manual:** Editar `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/kr/claude-sonnet-4.5"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "kr/claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5 (Kiro Free)"
          }
        ]
      }
    }
  }
}
```

> **Nota:** OpenClaw só funciona com 9Router local. Use `127.0.0.1` em vez de `localhost` para evitar problemas de resolução IPv6.

### Cline / Continue / RooCode

```
Provedor: compatível com OpenAI
Base URL: http://localhost:20128/v1
API Key: [copie do painel]
Model: cc/claude-opus-4-7
```

</details>

<details>
<summary><b>🚀 Implantação</b></summary>

### Implantação VPS

```bash
# Clonar e instalar
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Configurar
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Iniciar
npm run start

# Ou usar PM2
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Docker

Imagens publicadas (multiplataforma `linux/amd64` + `linux/arm64`):

- Hub Docker: [`decolua/9router`](https://hub.docker.com/r/decolua/9router)
- GHCR: [`ghcr.io/decolua/9router`](https://github.com/decolua/9router/pkgs/container/9router)

**Início rápido (use imagem publicada):**

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

→ Abra http://localhost:20128

**Compilar a partir do código-fonte (desenvolvedor):**

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
docker build -t 9router .
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data 9router
```

**Padrões do contêiner:**

- `PORT=20128`
- `HOSTNAME=0.0.0.0`

**Comandos úteis:**

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
docker pull decolua/9router:latest   # atualizar para a versão mais recente
```

**Persistência de dados:** `$HOME/.9router/db/data.sqlite` no host ↔ `/app/data/db/data.sqlite` no contêiner.

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `JWT_SECRET` | Gerado automaticamente (`~/.9router/jwt-secret`) | Segredo de assinatura JWT para cookie de autenticação do painel (substituir para compartilhar entre instâncias) |
| `INITIAL_PASSWORD` | `123456` | Primeira senha de login quando não existe hash salvo |
| `DATA_DIR` | `~/.9router` | Localização principal dos dados do aplicativo (SQLite em `$DATA_DIR/db/data.sqlite`) |
| `PORT` | padrão da estrutura | Porta de serviço (`20128` nos exemplos) |
| `HOSTNAME` | padrão da estrutura | Host de vinculação (o padrão do Docker é `0.0.0.0`) |
| `NODE_ENV` | padrão de tempo de execução | Definir `production` para implantação |
| `BASE_URL` | `http://localhost:20128` | URL base interna do lado do servidor usada por trabalhos de sincronização na nuvem |
| `CLOUD_URL` | `https://9router.com` | URL base do endpoint de sincronização na nuvem do lado do servidor |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | URL de base pública/compatível com versões anteriores (prefira `BASE_URL` para tempo de execução do servidor) |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | URL de nuvem pública/compatível com versões anteriores (prefira `CLOUD_URL` para tempo de execução do servidor) |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | Segredo HMAC para chaves de API geradas |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt para hashing estável de ID de máquina |
| `ENABLE_REQUEST_LOGS` | `false` | Habilita logs de solicitação/resposta em `logs/` |
| `AUTH_COOKIE_SECURE` | `false` | Forçar cookie de autenticação `Secure` (definir `true` atrás do proxy reverso HTTPS) |
| `REQUIRE_API_KEY` | `false` | Aplicar chave de API Bearer em rotas `/v1/*` (recomendado para implantações expostas à Internet) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | vazio | Proxy de saída opcional para chamadas de provedor upstream |
| `SEARXNG_URL` | `http://localhost:8888/search` | Endpoint para o provedor de pesquisa na web SearXNG não autenticado integrado |

Notas:

- Variáveis de proxy em letras minúsculas também são suportadas: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` não está incluído na imagem Docker (`.dockerignore`); injete configuração de tempo de execução com `--env-file` ou `-e`.
- No Windows, `APPDATA` pode ser usado para resolução de caminho de armazenamento local.
- `INSTANCE_NAME` aparece em modelos de documentos/env mais antigos, mas atualmente não é usado em tempo de execução.

### Arquivos e armazenamento em tempo de execução

- Estado principal do aplicativo: `${DATA_DIR}/db/data.sqlite` (SQLite — provedores, combos, aliases, chaves, configurações, histórico de uso)
- Backups automáticos: `${DATA_DIR}/db/backups/`
- Logs opcionais de solicitação/tradutor: `<repo>/logs/...` quando `ENABLE_REQUEST_LOGS=true`
- `${DATA_DIR}` e `~/.9router` resolvem para o mesmo local em um contêiner Docker — o link simbólico `/root/.9router -> /app/data` é criado no momento da construção.

</details>

---

## 📊 Modelos Disponíveis

<details>
<summary><b>Ver todos os modelos disponíveis</b></summary>

**Claude Code (`cc/`)** - Pro/Máx:

-`cc/claude-opus-4-7`
-`cc/claude-opus-4-6`
-`cc/claude-sonnet-4-6`
-`cc/claude-sonnet-4-5-20250929`
-`cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:

-`cx/gpt-5.5`
-`cx/gpt-5.4`
-`cx/gpt-5.3-codex`
-`cx/gpt-5.2-codex`
-`cx/gpt-5.1-codex-max`

**GitHub Copilot (`gh/`)**:

-`gh/gpt-5.4`
-`gh/claude-opus-4.7`
-`gh/claude-sonnet-4.6`
-`gh/gemini-3.1-pro-preview`
-`gh/grok-code-fast-1`

**Cursor (`cu/`)** - Assinatura:

-`cu/claude-4.6-opus-max`
-`cu/claude-4.5-sonnet-thinking`
-`cu/gpt-5.3-codex`
-`cu/kimi-k2.5`

**GLM (`glm/`)** - $0.6/1M:

-`glm/glm-5.1`
-`glm/glm-5`
-`glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:

-`minimax/MiniMax-M2.7`
-`minimax/MiniMax-M2.5`

**Kimi (`kimi/`)** - $9/mo plana:

-`kimi/kimi-k2.5`
-`kimi/kimi-k2.5-thinking`

**Kiro (`kr/`)** - Gratuito (~50 créditos/mês, níveis pagos acima):

-`kr/claude-sonnet-4.5`
-`kr/claude-haiku-4.5`
-`kr/glm-5`
-`kr/MiniMax-M2.5`
-`kr/qwen3-coder-next`
-`kr/deepseek-3.2`

**OpenCode grátis (`oc/`)** - GRATUITO sem autenticação:

- Obtido automaticamente de `opencode.ai/zen/v1/models`

**Vertex AI (`vertex/`)** - Créditos gratuitos $300:

-`vertex/gemini-3.1-pro-preview`
-`vertex/gemini-3-flash-preview`
-`vertex/gemini-2.5-flash`
-`vertex-partner/glm-5-maas`
-`vertex-partner/deepseek-v3.2-maas`

</details>

---

## 🐛 Solução de problemas

**"O modelo de linguagem não forneceu mensagens"**

- Cota do provedor esgotada → Verifique o rastreador de cota do painel
- Solução: use o combo substituto ou mude para um nível mais barato

**Limitação de requisições**

- Cota de assinatura esgotada → Fallback para GLM/MiniMax
- Adicionar combo: `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**O token OAuth expirou**

- Atualizado automaticamente pelo 9Router
- Se os problemas persistirem: Painel → Provedor → Reconectar

**Custos elevados**

- Habilite RTK no Dashboard → Configurações de endpoint (padrão LIGADO, economiza 20-40% de tokens)
- Verifique as estatísticas de uso no Dashboard
- Mude o modelo primário para GLM/MiniMax
- Use o nível gratuito (Kiro, OpenCode Free, Vertex) para tarefas não críticas

**Painel abre na porta errada**

- Definir `PORT=20128` e `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**Primeiro login não funciona**

- Verifique `INITIAL_PASSWORD` em `.env`
- Se não definida, a senha substituta é `123456`

**Nenhum registro de solicitação em `logs/`**

- Definir `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Pilha de tecnologia

- **Tempo de execução**: Node.js 20+
- **Estrutura**: Next.js 16
- **IU**: React 19 + Tailwind CSS 4
- **Banco de dados**: SQLite (better-sqlite3 / node:sqlite / fallback para sql.js)
- **Streaming**: eventos enviados pelo servidor (SSE)
- **Autenticação**: OAuth 2.0 (PKCE) + JWT + chaves de API

---

## 📝 Referência da API

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Escreva uma função para..."}
  ],
  "stream": true
}
```

### Listar modelos

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ Retorna todos os modelos e combos no formato OpenAI
```

## 📧 Suporte

- **Site**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Colaboradores

Obrigado a todos os colaboradores que ajudaram a tornar o 9Router melhor!

[![Contribuidores](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Gráfico de estrelas

[![Gráfico de estrelas](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

## 🔀 Forks

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — Um fork TypeScript completo do 9Router. Adiciona mais de 36 provedores, fallback automático de 4 camadas, APIs multimodais (imagens, incorporações, áudio, TTS), disjuntor, cache semântico, avaliações LLM e um painel sofisticado. Mais de 368 testes de unidade. Disponível via npm e Docker.

---

## 🙏 Agradecimentos

Construído sobre ombros de gigantes:

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — implementação Go original que inspirou esta versão JavaScript.
- **[RTK](https://github.com/rtk-ai/rtk)** ![Stars](https://img.shields.io/github/stars/rtk-ai/rtk?style=flat&color=yellow) — Economizador de tokens em Rust. O 9Router porta seu pipeline de compactação para JS → **−20-40% de tokens de entrada** em cada solicitação.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** ![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow) por **[@JuliusBrussee](https://github.com/JuliusBrussee)** — viral _"por que usar muitos tokens quando poucos tokens resolvem"_. 9Router adapta seu prompt → **−65% tokens de saída**.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** ![Estrelas](https://img.shields.io/github/stars/DietrichGebert/ponytail?style=flat&color=yellow) por **[@DietrichGebert](https://github.com/DietrichGebert)** — _"desenvolvedor sênior preguiçoso"_ habilidade. 9Router injeta sua abordagem YAGNI-first → **menos tokens, menos código, diferenças mais curtas**.

Um grande agradecimento a esses autores – sem o trabalho deles, os recursos de economia de tokens do 9Router não existiriam. Dê uma ⭐ a eles no GitHub!

---

## 📄 Licença

Licença MIT - consulte [LICENSE](../LICENSE) para obter detalhes.

---

<div align="center">
  <sub>Construído com ❤️ para desenvolvedores que codificam 24/7</sub>
</div>

