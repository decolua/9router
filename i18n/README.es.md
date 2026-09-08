<div align="center">
  <img src="../images/9router.png?1" alt="Panel de control de 9Router" width="800"/>
  
  # 9Router - Enrutador de IA GRATUITO y ahorrador de tokens
  
  **Nunca dejes de programar. Ahorra entre 20-40% de tokens con RTK + reserva automática hacia modelos de IA GRATUITOS y económicos.**
  
  **Conecta todas tus herramientas de código con IA (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) a más de 40 proveedores de IA y más de 100 modelos.**
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🚀 Inicio rápido](#-inicio-rápido) • [💡 Características](#-características-principales) • [📖 Configuración](#-guía-de-instalación) • [🌐 Sitio web](https://9router.com)

[🇻🇳 Tiếng Việt](./README.vi.md) • [🇨🇳 中文](./README.zh-CN.md) • [🇯🇵 日本語](./README.ja-JP.md) • [🇷🇺 Русский](./README.ru.md) • [🇹🇭 ไทย](./README.th.md) • [🇮🇷 فارسی](./README.fa_IR.md) • [🇮🇩 Indonesia](./README.id-ID.md) • [🇪🇸 Español](./README.es.md) • [🇫🇷 Français](./README.fr.md)

</div>

---

## 🤔 ¿Por qué 9Router?

**Deja de perder dinero, tokens y de chocar contra los límites:**

- ❌ La cuota de la suscripción caduca sin usar cada mes
- ❌ Los límites de velocidad te interrumpen a mitad de la programación
- ❌ Las salidas de las herramientas (git diff, grep, ls...) consumen tokens rápidamente
- ❌ APIs caras ($20-50/mes por proveedor)
- ❌ Cambio manual entre proveedores

**9Router resuelve esto:**

- ✅ **Ahorrador de tokens RTK** - Comprime automáticamente el contenido de tool_result y ahorra entre 20-40% de tokens por solicitud
- ✅ **Maximiza las suscripciones** - Realiza el seguimiento de la cuota y usa cada bit antes del restablecimiento
- ✅ **Reserva automática** - Suscripción → Económico → Gratuito, sin tiempos de inactividad
- ✅ **Multi-cuenta** - Round-robin entre cuentas de cada proveedor
- ✅ **Universal** - Funciona con Claude Code, Codex, Cursor, Cline y cualquier herramienta CLI

---

## 🔄 Cómo funciona

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router (Smart Router)            │
│  • RTK Token Saver (cut tool_result tokens) │
│  • Format translation (OpenAI ↔ Claude)     │
│  • Quota tracking                           │
│  • Auto token refresh                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, GitHub Copilot
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ budget limit
       └─→ [Tier 3: FREE] Kiro, OpenCode Free, Vertex ($300 credits)

Result: Never stop coding, minimal cost + 20-40% token savings via RTK
```

---

## ⚡ Inicio rápido

**1. Instálalo globalmente:**

```bash
npm install -g 9router
9router
```

🎉 El panel de control se abre en `http://localhost:20128`

**2. Conecta un proveedor GRATUITO (no requiere registro):**

Panel de control → Providers → Conecta **Kiro AI** (Claude gratuito e ilimitado) o **OpenCode Free** (sin autenticación) → ¡Listo!

**3. Úsalo en tu herramienta CLI:**

```
Ajustes de Claude Code/Codex/OpenClaw/Cursor/Cline:
  Endpoint: http://localhost:20128/v1
  API Key: [copia desde el panel de control]
  Model: kr/claude-sonnet-4.5
```

**¡Eso es todo!** Empieza a programar con modelos de IA GRATUITOS.

**Alternativa: ejecutar desde el código fuente (este repositorio):**

El paquete de este repositorio es privado (`9router-app`), por lo que ejecutar desde el código fuente/Docker es la ruta de desarrollo local prevista.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Modo de producción:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URLs por defecto:

- Panel de control: `http://localhost:20128/dashboard`
- API compatible con OpenAI: `http://localhost:20128/v1`

---

## 🎥 Guías en video

<div align="center">

<table>
  <tr>
  <td align="center" width="320">
  <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
    <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="Tiết kiệm chi phí LLM với 9Router" width="300"/>
  </a><br/>
  <b>🇻🇳 Tiếng Việt</b><br/>
  <sub>Tiết kiệm chi phí LLM cho OpenClaw với 9Router<br/>by <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
</td>
<td align="center" width="320">
      <a href="https://youtu.be/VQAw612S27Y">
        <img src="https://img.youtube.com/vi/VQAw612S27Y/maxresdefault.jpg" alt="9Router + Claude Code FREE Unlimited Setup" width="300"/>
      </a><br/>
      <b>🇵🇰 اردو / हिन्दी</b><br/>
      <sub>9Router + Claude Code FREE Unlimited Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    
  </tr>
  <tr>
  <td align="center" width="320">
      <a href="https://youtu.be/3dF5GIYMrcQ?si=bAyfyiHbARJQAHj_">
        <img src="https://img.youtube.com/vi/3dF5GIYMrcQ/hqdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code FREE Forever" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude Code FREE Forever — Unlimited Models<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
        <img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude CLI Free Setup with 9Router 🚀<br/>by <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    
  </tr>
  <tr>
  <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="Cài đặt OpenClaw Free A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Cài Đặt OpenClaw Free Từ A-Z + 9Router<br/>by <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="FREE OpenClaw with Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>FREE OpenClaw + Claude Opus 4.6<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=CkVZZUSTXAI">
        <img src="https://img.youtube.com/vi/CkVZZUSTXAI/mqdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Koding 24 Jam Anti Rate Limit! Hemat Token AI 65% | Tutorial Quick Setup 9Router 🚀<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
    
  </tr>
  
  <tr>
  <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=TXGv4eofe1I">
        <img src="https://img.youtube.com/vi/TXGv4eofe1I/mqdefault.jpg" alt="Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
  </tr>

</table>

</div>

> 🎬 **¿Has hecho un video sobre 9Router?** Envía una [Pull Request](https://github.com/decolua/9router/pulls) añadiendo tu video a esta sección — ¡lo fusionaremos!

---

## 🛠️ Herramientas CLI compatibles

9Router funciona a la perfección con todas las principales herramientas de código con IA:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
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
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
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
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 Proveedores compatibles

### 🔐 Proveedores OAuth

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
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

### 🆓 Proveedores gratuitos

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>GRATUITO e ilimitado</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>Sin autenticación • Modelos automáticos<br/>GRATUITO e ilimitado</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>$300 de crédito gratuito</sub>
      </td>
    </tr>
  </table>
</div>

> **Nota:** Los niveles gratuitos de iFlow, Qwen y Gemini CLI se suspendieron en 2026. Usa Kiro / OpenCode Free / Vertex en su lugar.

### 🔑 Proveedores con clave API (más de 40)

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
        <sub>Anthropic</sub>
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
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
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
  <p><i>...y más de 20 proveedores adicionales, incluyendo Nebius, Chutes, Hyperbolic y endpoints personalizados compatibles con OpenAI/Anthropic</i></p>
</div>

---

## 💡 Características principales

| Característica                                                                           | Qué hace                                                                                       | Por qué importa                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 🚀 **Ahorrador de tokens RTK** ([RTK](https://github.com/rtk-ai/rtk) ⭐40K)                | Comprime las salidas de las herramientas (`git diff`, `grep`, `ls`, `tree`...) antes de enviarlas al LLM | Ahorra **20-40% de tokens de entrada** por solicitud    |
| 🧠 **Ahorrador de tokens Headroom** ([Headroom](https://github.com/chopratejas/headroom)) | Proxy externo opcional `/v1/compress` antes del enrutamiento al proveedor                      | Ahorra más tokens de contexto sin cambiar los clientes  |
| 🪨 **Modo cavernícola** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K)        | Inyecta un prompt de lenguaje cavernícola → el LLM responde de forma concisa, se conserva el contenido técnico | Ahorra **hasta un 65% de tokens de salida**  |
| 🐴 **Ponytail** ([Ponytail](https://github.com/DietrichGebert/ponytail))                  | Inyecta un prompt de "dev sénior perezoso" → el LLM escribe código mínimo, primero YAGNI (Lite/Full/Ultra) | **Menos tokens de salida, menos refactorización**        |
| 🎯 **Reserva inteligente de 3 niveles**                                                  | Enrutado automático: Suscripción → Económico → Gratuito                                        | Nunca dejes de programar, cero tiempos de inactividad   |
| 📊 **Seguimiento de cuota en tiempo real**                                               | Recuento de tokens en vivo + cuenta atrás de restablecimiento                                  | Maximiza el valor de tu suscripción                     |
| 🔄 **Traducción de formatos**                                                            | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex                                             | Funciona con cualquier herramienta CLI                  |
| 👥 **Compatibilidad con varias cuentas**                                                 | Varias cuentas por proveedor                                                                   | Balance de carga + redundancia                          |
| 🔄 **Renovación automática de tokens**                                                   | Los tokens OAuth se renuevan automáticamente                                                   | Sin necesidad de volver a iniciar sesión                |
| 🎨 **Combos personalizados**                                                             | Crea combinaciones de modelos ilimitadas                                                       | Adapta la reserva a tus necesidades                     |
| 📝 **Registro de solicitudes**                                                           | Modo de depuración con registros completos de solicitudes/respuestas                           | Soluciona problemas fácilmente                          |
| 💾 **Sincronización en la nube**                                                         | Sincroniza la configuración entre dispositivos                                                 | La misma configuración en todas partes                  |
| 📊 **Analítica de uso**                                                                  | Realiza el seguimiento de tokens, costes y tendencias a lo largo del tiempo                     | Optimiza el gasto                                       |
| 🌐 **Implementa en cualquier lugar**                                                     | Localhost, VPS, Docker, Cloudflare Workers                                                     | Opciones de implementación flexibles                    |

<details>
<summary><b>📖 Detalles de las características</b></summary>

### 🚀 Ahorrador de tokens RTK

Las salidas de las herramientas (`git diff`, `grep`, `find`, `ls`, `tree`, volcados de registros...) suelen consumir entre 30-50% del presupuesto de tu prompt. RTK las detecta y aplica una compresión inteligente y sin pérdidas **antes** de que la solicitud llegue al LLM:

- **Filtros:** `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`
- **Detección automática:** No requiere configuración — RTK inspecciona el primer 1KB de cada `tool_result` y elige el filtro correcto.
- **Seguro por diseño:** Si un filtro falla, lanza un error o hace la salida más grande, RTK conserva silenciosamente el texto original. Los errores nunca interrumpen tu solicitud.
- **Universal:** Funciona en todos los formatos (OpenAI, Claude, Gemini, Cursor, Kiro, OpenAI Responses) porque se ejecuta **antes** de cualquier traducción de formato.
- **Activado por defecto:** Actívalo o desactívalo en cualquier momento en Panel de control → Ajustes de Endpoint.

```
Sin RTK: se envían 47K tokens al LLM
Con RTK:    se envían 28K tokens al LLM   (40% ahorrado · mismo contexto · misma respuesta)
```

### 🧠 Ahorrador de tokens Headroom

Headroom es opcional y se ejecuta por separado. 9Router llama al endpoint local `/v1/compress` de Headroom y luego mantiene el enrutamiento, la reserva, la autenticación y el seguimiento de uso normales:

```
Client → 9Router → Headroom /v1/compress → 9Router → provider
```

Configuración local:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

Actívalo en Panel de control → Endpoint → Token Saver → Headroom. URL por defecto: `http://localhost:8787`.

Ejemplos con Docker:

```bash
# Servicio de Headroom en la misma red de Docker
http://headroom:8787

# Headroom ejecutándose en la máquina host
http://host.docker.internal:8787
```

Si Headroom está caído o devuelve un error, 9Router falla de forma segura y envía la solicitud original.

### 🐴 Ponytail (Dev sénior perezoso)

Ponytail inyecta un prompt de sistema de _"dev sénior perezoso"_ en cada solicitud, orientando al LLM hacia un código mínimo y primero YAGNI — eliminación antes que adición, librería estándar antes que nuevas dependencias, una línea antes que abstracciones. Adaptado de [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

- **Lite** — Construye lo que se pide, nombra la alternativa más perezosa.
- **Full** — Jerarquía YAGNI aplicada: stdlib → nativo → dependencias existentes → una línea → código mínimo.
- **Ultra** — Extremista del YAGNI: eliminación primero, entrega la solución de una línea, cuestiona el resto del requisito en la misma respuesta.

```
Sin Ponytail: código verboso, abstracciones extra, andamiaje "por si acaso"
Con Ponytail:    diff funcional más corto, sin abstracciones no solicitadas, menos tokens
```

Nunca sacrifica: validación de entrada, manejo de errores que evita pérdida de datos, seguridad, accesibilidad ni nada solicitado explícitamente. Actívalo en Panel de control → Endpoint → Ponytail. Se combina con Caveman (concisión de salida) y RTK (compresión de entrada).

### 🎯 Reserva inteligente de 3 niveles

Crea combos con reserva automática:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (tu suscripción)
  2. glm/glm-4.7               (respaldo económico, $0.6/1M)
  3. if/kimi-k2-thinking       (reserva gratuita)

→ Cambia automáticamente cuando la cuota se agota o se producen errores
```

### 📊 Seguimiento de cuota en tiempo real

- Consumo de tokens por proveedor
- Cuenta atrás de restablecimiento (5 horas, diaria, semanal)
- Estimación de costes para niveles de pago
- Informes de gasto mensual

### 🔄 Traducción de formatos

Traducción fluida entre formatos:

- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- Tu herramienta CLI envía el formato OpenAI → 9Router lo traduce → El proveedor recibe el formato nativo
- Funciona con cualquier herramienta que admita endpoints OpenAI personalizados

### 👥 Compatibilidad con varias cuentas

- Añade varias cuentas por proveedor
- Enrutado automático round-robin o basado en prioridades
- Reserva a la siguiente cuenta cuando una alcanza su cuota

### 🔄 Renovación automática de tokens

- Los tokens OAuth se renuevan automáticamente antes de caducar
- Sin necesidad de reautenticación manual
- Experiencia fluida en todos los proveedores

### 🎨 Combos personalizados

- Crea combinaciones de modelos ilimitadas
- Mezcla niveles de suscripción, económicos y gratuitos
- Pon nombre a tus combos para acceder fácilmente
- Comparte combos entre dispositivos con Sincronización en la nube

### 📝 Registro de solicitudes

- Activa el modo de depuración para registros completos de solicitudes/respuestas
- Realiza el seguimiento de llamadas API, cabeceras y cargas útiles
- Soluciona problemas de integración
- Exporta los registros para su análisis

### 💾 Sincronización en la nube

- Sincroniza proveedores, combos y ajustes entre dispositivos
- Sincronización automática en segundo plano
- Almacenamiento cifrado y seguro
- Accede a tu configuración desde cualquier lugar

#### Notas del runtime en la nube

- Prefiere las variables de nube del lado del servidor en producción:
  - `BASE_URL` (URL de retorno interno usada por el planificador de sincronización)
  - `CLOUD_URL` (base del endpoint de sincronización en la nube)
- `NEXT_PUBLIC_BASE_URL` y `NEXT_PUBLIC_CLOUD_URL` siguen siendo compatibles para compatibilidad/UI, pero el runtime del servidor ahora prioriza `BASE_URL`/`CLOUD_URL`.
- Las solicitudes de sincronización en la nube ahora usan tiempo de espera + comportamiento de fallo rápido para evitar que la UI se cuelgue cuando el DNS/la red de la nube no está disponible.

### 📊 Analítica de uso

- Realiza el seguimiento del uso de tokens por proveedor y modelo
- Estimación de costes y tendencias de gasto
- Informes e información mensual
- Optimiza tu gasto en IA

> **💡 IMPORTANTE - Comprender los costes del panel de control:**
>
> El "coste" que se muestra en Analítica de uso es **solo para seguimiento y comparación**.
> 9Router por sí mismo **nunca te cobra** nada. Solo pagas a los proveedores directamente (si usas servicios de pago).
>
> **Ejemplo:** Si tu panel muestra "coste total de $290" mientras usas modelos iFlow, esto representa
> lo que habrías pagado usando APIs de pago directamente. Tu coste real = **$0** (iFlow es gratis e ilimitado).
>
> ¡Piénsalo como un "rastreador de ahorros" que muestra cuánto estás ahorrando al usar modelos gratuitos o
> enrutar a través de 9Router!

### 🌐 Implementa en cualquier lugar

- 💻 **Localhost** - Por defecto, funciona sin conexión
- ☁️ **VPS/Nube** - Comparte entre dispositivos
- 🐳 **Docker** - Implementación con un solo comando
- 🚀 **Cloudflare Workers** - Red perimetral global

</details>

---

## 💰 Precios de un vistazo

| Nivel                 | Proveedor              | Coste          | Restablecimiento de cuota | Mejor para                                  |
| --------------------- | ---------------------- | -------------- | ------------------------- | ------------------------------------------- |
| **🚀 AHORRO DE TOKENS** | **RTK (integrado)**    | **GRATUITO**   | Siempre activo            | **Ahorra 20-40% de tokens en CADA solicitud** |
| **💳 SUSCRIPCIÓN**    | Claude Code (Pro/Max)  | $20-200/mes    | 5 h + semanal             | Ya suscrito                                 |
|                       | Codex (Plus/Pro)       | $20-200/mes    | 5 h + semanal             | Usuarios de OpenAI                          |
|                       | GitHub Copilot         | $10-19/mes     | Mensual                   | Usuarios de GitHub                          |
|                       | Cursor IDE             | $20/mes        | Mensual                   | Usuarios de Cursor                          |
| **💰 ECONÓMICO**      | GLM-5.1 / GLM-4.7      | $0.6/1M        | Diario 10:00              | Respaldo económico                          |
|                       | MiniMax M2.7           | $0.2/1M        | Ventana de 5 horas        | La opción más barata                        |
|                       | Kimi K2.5              | $9/mes fijos   | 10M tokens/mes            | Coste predecible                            |
| **🆓 GRATUITO**       | Kiro AI                | $0             | Ilimitado                 | Claude 4.5 + GLM-5 + MiniMax gratis         |
|                       | OpenCode Free          | $0             | Ilimitado                 | Sin autenticación, modelos automáticos      |
|                       | Vertex AI              | $300 de crédito | Cuentas GCP nuevas       | Gemini 3 Pro + DeepSeek + GLM-5             |

**💡 Consejo profesional:** Combo RTK + Kiro AI + OpenCode Free = **$0 de coste + 20-40% de ahorro de tokens**!

---

### 📊 Cómo entender los costes y la facturación de 9Router

**Realidad de la facturación de 9Router:**

✅ **El software de 9Router = GRATUITO para siempre** (código abierto, nunca cobra)  
✅ **Los "costes" del panel = Solo visualización/seguimiento** (no son facturas reales)  
✅ **Pagas a los proveedores directamente** (suscripciones o tarifas de API)  
✅ **Los proveedores GRATUITOS siguen siendo GRATUITOS** (iFlow, Kiro, Qwen = $0 ilimitado)  
❌ **9Router nunca envía facturas** ni carga tu tarjeta

**Cómo funciona la visualización de costes:**

El panel muestra **costes estimados** como si estuvieras usando APIs de pago directamente. Esto **no es facturación** — es una herramienta de comparación para mostrar tus ahorros.

**Escenario de ejemplo:**

```
Visualización del panel:
• Total de solicitudes: 1,662
• Tokens totales: 47M
• Coste mostrado: $290

Comprobación de la realidad:
• Proveedor: iFlow (GRATUITO e ilimitado)
• Pago real: $0.00
• Qué significa $290: ¡La cantidad que AHORRASTE usando modelos gratuitos!
```

**Reglas de pago:**

- **Proveedores de suscripción** (Claude Code, Codex): Págales directamente a través de sus sitios web
- **Proveedores económicos** (GLM, MiniMax): Págales directamente, 9Router solo enruta
- **Proveedores GRATUITOS** (iFlow, Kiro, Qwen): Realmente gratuitos para siempre, sin cargos ocultos
- **9Router**: Nunca cobra nada, jamás

---

## 🎯 Casos de uso

### Caso 1: "Tengo una suscripción a Claude Pro"

**Problema:** La cuota caduca sin usar, límites de velocidad durante programación intensa

**Solución:**

```
Combo: "maximize-claude"
  1. cc/claude-opus-4-7        (usa la suscripción al máximo)
  2. glm/glm-5.1               (respaldo económico cuando se agota la cuota)
  3. kr/claude-sonnet-4.5      (reserva gratuita de emergencia)

Coste mensual: $20 (suscripción) + ~$5 (respaldo) = $25 en total
vs. $20 + chocar contra límites = frustración
```

### Caso 2: "Quiero coste cero"

**Problema:** No puedo permitirme suscripciones, necesito programación con IA fiable

**Solución:**

```
Combo: "free-forever"
  1. kr/claude-sonnet-4.5      (Claude 4.5 gratuito e ilimitado)
  2. kr/glm-5                  (GLM-5 gratis a través de Kiro)
  3. oc/<auto>                 (OpenCode Free, sin autenticación)

Coste mensual: $0
Calidad: Modelos listos para producción + RTK ahorra 20-40% de tokens
```

### Caso 3: "Necesito programar 24/7, sin interrupciones"

**Problema:** Plazos de entrega, no puedo permitirme tiempos de inactividad

**Solución:**

```
Combo: "always-on"
  1. cc/claude-opus-4-7        (la mejor calidad)
  2. cx/gpt-5.5                (segunda suscripción)
  3. glm/glm-5.1               (económico, se restablece diariamente)
  4. minimax/MiniMax-M2.7      (el más barato, restablecimiento cada 5 h)
  5. kr/claude-sonnet-4.5      (gratuito e ilimitado)

Resultado: 5 capas de reserva = cero tiempos de inactividad
Coste mensual: $20-200 (suscripciones) + $10-20 (respaldo)
```

### Caso 4: "Quiero IA GRATUITA en OpenClaw"

**Problema:** Necesito un asistente de IA en aplicaciones de mensajería (WhatsApp, Telegram, Slack...), completamente gratis

**Solución:**

```
Combo: "openclaw-free"
  1. kr/claude-sonnet-4.5      (Claude 4.5 gratuito)
  2. kr/glm-5                  (GLM-5 gratuito)
  3. kr/MiniMax-M2.5           (MiniMax gratuito)

Coste mensual: $0
Acceso mediante: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Preguntas frecuentes

<details>
<summary><b>📊 ¿Por qué mi panel muestra costes elevados?</b></summary>

El panel realiza el seguimiento de tu uso de tokens y muestra **costes estimados** como si estuvieras usando APIs de pago directamente. Esto **no es facturación real** — es una referencia para mostrar cuánto estás ahorrando al usar modelos gratuitos o suscripciones existentes a través de 9Router.

**Ejemplo:**

- **El panel muestra:** "$290 de coste total"
- **La realidad:** Estás usando iFlow (GRATUITO e ilimitado)
- **Tu coste real:** **$0.00**
- **Qué significa $290:** ¡La cantidad que **ahorraste** al usar modelos gratuitos en lugar de APIs de pago!

La visualización de costes es un "rastreador de ahorros" que te ayuda a comprender tus patrones de uso y las oportunidades de optimización.

</details>

<details>
<summary><b>💳 ¿9Router me cobrará algo?</b></summary>

**No.** 9Router es un software gratuito y de código abierto que se ejecuta en tu propio ordenador. Nunca te cobra nada.

**Solo pagas:**

- ✅ **Proveedores de suscripción** (Claude Code $20/mes, Codex $20-200/mes) → Págales directamente en sus sitios web
- ✅ **Proveedores económicos** (GLM, MiniMax) → Págales directamente, 9Router solo enruta tus solicitudes
- ❌ **El propio 9Router** → **Nunca cobra nada, jamás**

9Router es un proxy/enrutador local. No tiene tu tarjeta de crédito, no puede enviar facturas y no tiene sistema de facturación. Es software totalmente gratuito.

</details>

<details>
<summary><b>🆓 ¿Los proveedores GRATUITOS son realmente ilimitados?</b></summary>

**¡Sí!** Los proveedores GRATUITOS actuales (Kiro, OpenCode Free, Vertex) son realmente gratuitos y **no tienen cargos ocultos**.

Estos son servicios gratuitos ofrecidos por esas respectivas empresas:

- **Kiro AI**: Claude 4.5 + GLM-5 + MiniMax gratuitos e ilimitados mediante AWS Builder ID / Google / GitHub OAuth
- **OpenCode Free**: Proxy de paso sin autenticación, modelos obtenidos automáticamente de `opencode.ai/zen/v1/models`
- **Vertex AI**: $300 de crédito gratuito para cuentas nuevas de Google Cloud (90 días)

9Router solo enruta tus solicitudes hacia ellos — no hay "trampa" ni facturación futura. Son servicios realmente gratuitos y 9Router los hace fáciles de usar con soporte de reserva.

**Niveles gratuitos suspendidos (ya no recomendados):**

- ❌ **iFlow**: Era gratuito e ilimitado, ahora es de pago (2026)
- ❌ **Qwen Code**: El nivel gratuito de OAuth fue suspendido por Alibaba el 15-04-2026
- ❌ **Gemini CLI**: Sigue funcionando, pero usarlo con herramientas que no son CLI (Claude, Codex, Cursor...) puede resultar en baneo de cuentas — úsalo solo si te quedas con el propio Gemini CLI

</details>

<details>
<summary><b>💰 ¿Cómo minimizo mis costes reales de IA?</b></summary>

**Estrategia gratis-primero:**

1. **Empieza con un combo 100% gratuito:**

   ```
   1. gc/gemini-3-flash (180K/mes gratis de Google)
   2. if/kimi-k2-thinking (gratuito e ilimitado de iFlow)
   3. qw/qwen3-coder-plus (gratuito e ilimitado de Qwen)
   ```

   **Coste: $0/mes**

2. **Añade un respaldo económico** solo si lo necesitas:

   ```
   4. glm/glm-4.7 ($0.6/1M de tokens)
   ```

   **Coste adicional: Solo pagas por lo que realmente usas**

3. **Usa los proveedores de suscripción al final:**
   - Solo si ya los tienes
   - 9Router te ayuda a maximizar su valor mediante el seguimiento de cuota

**Resultado:** ¡La mayoría de los usuarios pueden operar con $0/mes usando solo niveles gratuitos!

</details>

<details>
<summary><b>📈 ¿Qué pasa si mi uso se dispara de repente?</b></summary>

La reserva inteligente de 9Router evita cargos sorpresa:

**Escenario:** Estás en un sprint de programación y agotas tus cuotas

**Sin 9Router:**

- ❌ Chocas contra el límite de velocidad → El trabajo se detiene → Frustración
- ❌ O: Acumulas accidentalmente facturas enormes de API

**Con 9Router:**

- ✅ La suscripción alcanza su límite → Reserva automática al nivel económico
- ✅ El nivel económico se vuelve caro → Reserva automática al nivel gratuito
- ✅ Nunca dejas de programar → Costes predecibles

**Tú tienes el control:** Establece límites de gasto por proveedor en el panel y 9Router los respeta.

</details>

---

## 📖 Guía de instalación

<details>
<summary><b>🔐 Proveedores de suscripción (maximiza el valor)</b></summary>

### Claude Code (Pro/Max)

```bash
Panel de control → Providers → Conecta Claude Code
→ Inicio de sesión OAuth → Renovación automática de tokens
→ Seguimiento de cuota de 5 horas + semanal

Modelos:
  cc/claude-opus-4-7
  cc/claude-opus-4-6
  cc/claude-sonnet-4-6
  cc/claude-haiku-4-5-20251001
```

**Consejo profesional:** Usa Opus para tareas complejas y Sonnet para velocidad. ¡9Router realiza el seguimiento de la cuota por modelo!

### OpenAI Codex (Plus/Pro)

```bash
Panel de control → Providers → Conecta Codex
→ Inicio de sesión OAuth (puerto 1455)
→ Restablecimiento de 5 horas + semanal

Modelos:
  cx/gpt-5.5
  cx/gpt-5.4
  cx/gpt-5.3-codex
  cx/gpt-5.2-codex
```

### GitHub Copilot

```bash
Panel de control → Providers → Conecta GitHub
→ OAuth a través de GitHub
→ Restablecimiento mensual (día 1 de cada mes)

Modelos:
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
Panel de control → Providers → Conecta Cursor
→ Inicio de sesión OAuth
→ Suscripción mensual

Modelos:
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 Proveedores económicos (respaldo)</b></summary>

### GLM-5.1 / GLM-4.7 (restablecimiento diario, $0.6/1M)

1. Regístrate: [Zhipu AI](https://open.bigmodel.cn/)
2. Obtén la clave API del Coding Plan
3. Panel de control → Add API Key:
   - Proveedor: `glm`
   - API Key: `tu-clave`

**Uso:** `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`

**Consejo profesional:** ¡El Coding Plan ofrece cuota 3× por 1/7 del coste! Restablecimiento diario a las 10:00.

### MiniMax M2.7 (restablecimiento cada 5 h, $0.20/1M)

1. Regístrate: [MiniMax](https://www.minimax.io/)
2. Obtén la clave API
3. Panel de control → Add API Key

**Uso:** `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`

**Consejo profesional:** ¡La opción más barata para contexto largo (1M de tokens)!

### Kimi K2.5 ($9/mes fijos)

1. Suscríbete: [Moonshot AI](https://platform.moonshot.ai/)
2. Obtén la clave API
3. Panel de control → Add API Key

**Uso:** `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`

**Consejo profesional:** ¡$9/mes fijos por 10M de tokens = coste efectivo de $0.90/1M!

</details>

<details>
<summary><b>🆓 Proveedores GRATUITOS (recomendados)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax GRATIS)

```bash
Panel de control → Conecta Kiro
→ AWS Builder ID, AWS IAM Identity Center, Google o GitHub
→ Uso ilimitado

Modelos:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**Consejo profesional:** La mejor opción gratuita para Claude. Sin clave API, sin pago, totalmente ilimitado.

### OpenCode Free (sin autenticación, modelos automáticos)

```bash
Panel de control → Conecta OpenCode Free
→ No requiere inicio de sesión (proxy de paso)
→ Modelos obtenidos automáticamente de opencode.ai/zen/v1/models
```

**Consejo profesional:** La configuración más rápida. Solo conéctate y empieza a programar.

### Vertex AI ($300 de crédito gratuito para cuentas GCP nuevas)

```bash
Panel de control → Conecta Vertex AI
→ Sube el JSON de la cuenta de servicio de Google Cloud
→ Habilita la API de Vertex AI en tu proyecto de GCP

Modelos:
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex Partner (Anthropic / DeepSeek / GLM / Qwen a través de Vertex):
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

**Consejo profesional:** Las cuentas nuevas de Google Cloud obtienen $300 de crédito gratis durante 90 días. Más que suficiente para programar a diario.

</details>

<details>
<summary><b>🎨 Crea combos</b></summary>

### Ejemplo 1: Maximiza la suscripción → Respaldo económico

```
Panel de control → Combos → Create New

Nombre: premium-coding
Modelos:
  1. cc/claude-opus-4-7 (Suscripción principal)
  2. glm/glm-5.1 (Respaldo económico, $0.6/1M)
  3. minimax/MiniMax-M2.7 (Reserva más barata, $0.20/1M)

Uso en CLI: premium-coding

Ejemplo de coste mensual (100M de tokens):
  80M vía Claude (suscripción): $0 extra
  15M vía GLM: $9
  5M vía MiniMax: $1
  Total: $10 + tu suscripción
```

### Ejemplo 2: Solo gratis (coste cero)

```
Nombre: free-combo
Modelos:
  1. kr/claude-sonnet-4.5 (Claude 4.5 gratuito e ilimitado)
  2. kr/glm-5 (GLM-5 gratis a través de Kiro)
  3. vertex/gemini-3.1-pro-preview ($300 de crédito gratuito)

Coste: $0 para siempre (+ 20-40% de ahorro de tokens vía RTK)!
```

</details>

<details>
<summary><b>🔧 Integración con CLI</b></summary>

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el panel de 9router]
  Model: cc/claude-opus-4-7
```

O usa el combo: `premium-coding`

### Claude Code

Edita `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "tu-clave-api-de-9router"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="tu-clave-api-de-9router"

codex "tu prompt"
```

### OpenClaw

**Opción 1 — Panel de control (recomendada):**

```
Panel de control → CLI Tools → OpenClaw → Selecciona el modelo → Aplicar
```

**Opción 2 — Manual:** Edita `~/.openclaw/openclaw.json`:

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

> **Nota:** OpenClaw solo funciona con 9Router local. Usa `127.0.0.1` en lugar de `localhost` para evitar problemas de resolución IPv6.

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [desde el panel]
Model: cc/claude-opus-4-7
```

</details>

<details>
<summary><b>🚀 Implementación</b></summary>

### Implementación en VPS

```bash
# Clona e instala
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Configura
export JWT_SECRET="tu-secreto-seguro-cámbialo"
export INITIAL_PASSWORD="tu-contraseña"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Inicia
npm run start

# O usa PM2
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Docker

Imágenes publicadas (multi-plataforma `linux/amd64` + `linux/arm64`):

- Docker Hub: [`decolua/9router`](https://hub.docker.com/r/decolua/9router)
- GHCR: [`ghcr.io/decolua/9router`](https://github.com/decolua/9router/pkgs/container/9router)

**Inicio rápido (usa la imagen publicada):**

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

→ Abre http://localhost:20128

**Compilar desde el código fuente (dev):**

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
docker build -t 9router .
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data 9router
```

**Valores por defecto del contenedor:**

- `PORT=20128`
- `HOSTNAME=0.0.0.0`

**Comandos útiles:**

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
docker pull decolua/9router:latest   # actualiza a la última versión
```

**Persistencia de datos:** `$HOME/.9router/db/data.sqlite` en el host ↔ `/app/data/db/data.sqlite` en el contenedor.

### Variables de entorno

| Variable                                             | Por defecto                                | Descripción                                                                          |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `JWT_SECRET`                                         | Generado automáticamente (`~/.9router/jwt-secret`) | Secreto de firma JWT para la cookie de autenticación del panel (sobreescríbelo para compartir entre instancias) |
| `INITIAL_PASSWORD`                                   | `123456`                                   | Contraseña del primer inicio de sesión cuando no existe un hash guardado             |
| `DATA_DIR`                                           | `~/.9router`                               | Ubicación principal de datos de la app (SQLite en `$DATA_DIR/db/data.sqlite`)        |
| `PORT`                                               | por defecto del framework                  | Puerto del servicio (`20128` en los ejemplos)                                        |
| `HOSTNAME`                                           | por defecto del framework                  | Host de enlace (Docker usa `0.0.0.0` por defecto)                                    |
| `NODE_ENV`                                           | por defecto del runtime                    | Establece `production` para el despliegue                                            |
| `BASE_URL`                                           | `http://localhost:20128`                   | URL base interna del lado del servidor usada por los trabajos de sincronización en la nube |
| `CLOUD_URL`                                          | `https://9router.com`                      | URL base del endpoint de sincronización en la nube del lado del servidor             |
| `NEXT_PUBLIC_BASE_URL`                               | `http://localhost:3000`                    | URL base pública/compatible con versiones anteriores (prefiere `BASE_URL` para el runtime del servidor) |
| `NEXT_PUBLIC_CLOUD_URL`                              | `https://9router.com`                      | URL de nube pública/compatible (prefiere `CLOUD_URL` para el runtime del servidor)   |
| `API_KEY_SECRET`                                     | `endpoint-proxy-api-key-secret`            | Secreto HMAC para las claves API generadas                                           |
| `MACHINE_ID_SALT`                                    | `endpoint-proxy-salt`                      | Sal para el hash estable del ID de máquina                                           |
| `ENABLE_REQUEST_LOGS`                                | `false`                                    | Habilita los registros de solicitudes/respuestas en `logs/`                          |
| `AUTH_COOKIE_SECURE`                                 | `false`                                    | Fuerza la cookie `Secure` de autenticación (establece `true` detrás de un proxy HTTPS inverso) |
| `REQUIRE_API_KEY`                                    | `false`                                    | Aplica clave API Bearer en las rutas `/v1/*` (recomendado para despliegues expuestos a Internet) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | vacío                                      | Proxy saliente opcional para las llamadas a proveedores externos                     |
| `SEARXNG_URL`                                        | `http://localhost:8888/search`             | Endpoint del proveedor de búsqueda web SearXNG integrado sin autenticación           |

Notas:

- También se admiten variables de proxy en minúsculas: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` no se incluye en la imagen de Docker (`.dockerignore`); inyecta la configuración del runtime con `--env-file` o `-e`.
- En Windows, se puede usar `APPDATA` para resolver la ruta de almacenamiento local.
- `INSTANCE_NAME` aparece en documentación/plantillas de entorno antiguas, pero actualmente no se usa en el runtime.

### Archivos en tiempo de ejecución y almacenamiento

- Estado principal de la app: `${DATA_DIR}/db/data.sqlite` (SQLite — proveedores, combos, alias, claves, ajustes, historial de uso)
- Copias de seguridad automáticas: `${DATA_DIR}/db/backups/`
- Registros opcionales de solicitudes/translator: `<repo>/logs/...` cuando `ENABLE_REQUEST_LOGS=true`
- Tanto `${DATA_DIR}` como `~/.9router` resuelven a la misma ubicación en un contenedor de Docker — el enlace simbólico `/root/.9router -> /app/data` se crea en tiempo de compilación.

</details>

---

## 📊 Modelos disponibles

<details>
<summary><b>Ver todos los modelos disponibles</b></summary>

**Claude Code (`cc/`)** - Pro/Max:

- `cc/claude-opus-4-7`
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:

- `cx/gpt-5.5`
- `cx/gpt-5.4`
- `cx/gpt-5.3-codex`
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**GitHub Copilot (`gh/`)**:

- `gh/gpt-5.4`
- `gh/claude-opus-4.7`
- `gh/claude-sonnet-4.6`
- `gh/gemini-3.1-pro-preview`
- `gh/grok-code-fast-1`

**Cursor (`cu/`)** - Suscripción:

- `cu/claude-4.6-opus-max`
- `cu/claude-4.5-sonnet-thinking`
- `cu/gpt-5.3-codex`
- `cu/kimi-k2.5`

**GLM (`glm/`)** - $0.6/1M:

- `glm/glm-5.1`
- `glm/glm-5`
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:

- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.5`

**Kimi (`kimi/`)** - $9/mes fijos:

- `kimi/kimi-k2.5`
- `kimi/kimi-k2.5-thinking`

**Kiro (`kr/`)** - GRATUITO e ilimitado:

- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`
- `kr/glm-5`
- `kr/MiniMax-M2.5`
- `kr/qwen3-coder-next`
- `kr/deepseek-3.2`

**OpenCode Free (`oc/`)** - GRATUITO sin autenticación:

- Obtenidos automáticamente de `opencode.ai/zen/v1/models`

**Vertex AI (`vertex/`)** - $300 de crédito gratuito:

- `vertex/gemini-3.1-pro-preview`
- `vertex/gemini-3-flash-preview`
- `vertex/gemini-2.5-flash`
- `vertex-partner/glm-5-maas`
- `vertex-partner/deepseek-v3.2-maas`

</details>

---

## 🐛 Solución de problemas

**"Language model did not provide messages"**

- Cuota del proveedor agotada → Revisa el rastreador de cuota del panel
- Solución: usa la reserva del combo o cambia a un nivel más barato

**Límites de velocidad**

- Cuota de suscripción agotada → Reserva a GLM/MiniMax
- Añade el combo: `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**Token OAuth caducado**

- 9Router lo renueva automáticamente
- Si los problemas persisten: Panel de control → Provider → Reconectar

**Costes elevados**

- Habilita RTK en Panel de control → Ajustes de Endpoint (activado por defecto, ahorra 20-40% de tokens)
- Revisa las estadísticas de uso en el panel
- Cambia el modelo principal a GLM/MiniMax
- Usa el nivel gratuito (Kiro, OpenCode Free, Vertex) para tareas no críticas

**El panel se abre en el puerto equivocado**

- Establece `PORT=20128` y `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**El primer inicio de sesión no funciona**

- Revisa `INITIAL_PASSWORD` en `.env`
- Si no está configurada, la contraseña de respaldo es `123456`

**No hay registros de solicitudes en `logs/`**

- Establece `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Pila tecnológica

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **Base de datos**: SQLite (better-sqlite3 / node:sqlite / sql.js como respaldo)
- **Streaming**: Server-Sent Events (SSE)
- **Autenticación**: OAuth 2.0 (PKCE) + JWT + claves API

---

## 📝 Referencia de la API

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer tu-clave-api
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Escribe una función para..."}
  ],
  "stream": true
}
```

### Listar modelos

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer tu-clave-api

→ Devuelve todos los modelos y combos en formato OpenAI
```

## 📧 Soporte

- **Sitio web**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Problemas**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Colaboradores

¡Gracias a todos los colaboradores que ayudaron a mejorar 9Router!

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Gráfico de estrellas

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

## 🔀 Forks

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — Un fork de 9Router en TypeScript con todas las funciones. Añade más de 36 proveedores, reserva automática de 4 niveles, APIs multimodales (imágenes, embeddings, audio, TTS), interruptor de circuitos, caché semántica, evaluaciones de LLM y un panel pulido. Más de 368 pruebas unitarias. Disponible a través de npm y Docker.

---

## 🙏 Agradecimientos

Construido sobre los hombros de gigantes:

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — implementación original en Go que inspiró este port a JavaScript.
- **[RTK](https://github.com/rtk-ai/rtk)** ![Stars](https://img.shields.io/github/stars/rtk-ai/rtk?style=flat&color=yellow) — ahorrador de tokens en Rust. 9Router porta su pipeline de compresión a JS → **−20-40% de tokens de entrada** en cada solicitud.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** ![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow) por **[@JuliusBrussee](https://github.com/JuliusBrussee)** — viral _"why use many token when few token do trick"_. 9Router adapta su prompt → **−65% de tokens de salida**.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** ![Stars](https://img.shields.io/github/stars/DietrichGebert/ponytail?style=flat&color=yellow) por **[@DietrichGebert](https://github.com/DietrichGebert)** — habilidad del _"dev sénior perezoso"_. 9Router inyecta su jerarquía primero-YAGNI → **menos tokens, menos código, diffs más cortos**.

Un enorme agradecimiento a estos autores — sin su trabajo, las funciones de ahorro de tokens de 9Router no existirían. ¡Dales una ⭐ en GitHub!

---

## 📄 Licencia

Licencia MIT - consulta [LICENSE](LICENSE) para más detalles.

---

<div align="center">
  <sub>Hecho con ❤️ para desarrolladores que programan 24/7</sub>
</div>

