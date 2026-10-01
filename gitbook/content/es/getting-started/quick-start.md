# Empezar

Pon en marcha 9Router en 5 minutos y comienza a enrutar solicitudes de IA de forma inteligente.

---

## Inicio rápido

### 1. Instalar

```bash
npm install -g 9router
```

**Requisitos:** Node.js 20+ ([Detalles de instalación](getting-started/installation.md))

### 2. Iniciar

```bash
9router
```

🎉 **El dashboard se abre automáticamente** en `http://localhost:20128`

- Contraseña por defecto: `123456` (cámbiala en el dashboard)
- API key generada automáticamente
- Listo para conectar proveedores

### 3. Conectar proveedores

Tienes 3 formas de conectar proveedores:

#### Opción A: OAuth (Proveedores de suscripción)

**Ideal para:** Claude Code, Codex, Gemini CLI, GitHub Copilot

```
Dashboard → Providers → Connect [Provider]
→ Login OAuth → Refresh automático de token
→ Seguimiento de cuota habilitado
```

**Ejemplo: Claude Code**
1. Clic en "Connect Claude Code"
2. Inicia sesión con tu cuenta de Claude
3. Autoriza 9Router
4. ✅ ¡Listo! Usa el modelo: `cc/claude-opus-4-5-20251101`

#### Opción B: API Key (Proveedores baratos)

**Ideal para:** GLM, MiniMax, Kimi, OpenRouter

```
Dashboard → Providers → Add API Key
→ Selecciona proveedor
→ Pega API key
→ Guardar
```

**Ejemplo: GLM-4.7**
1. Regístrate en [Zhipu AI](https://open.bigmodel.cn/)
2. Obtén la API key del Coding Plan
3. Dashboard → Add API Key → Provider: `glm` → Pega la key
4. ✅ ¡Listo! Usa el modelo: `glm/glm-4.7`

#### Opción C: Proveedores gratis (Sin costo)

**Ideal para:** iFlow, Qwen, Kiro

```
Dashboard → Providers → Connect [Free Provider]
→ Device code u OAuth
→ Uso ilimitado
```

**Ejemplo: iFlow**
1. Clic en "Connect iFlow"
2. Inicia sesión con tu cuenta de iFlow
3. Autoriza
4. ✅ ¡Listo! Usa 8 modelos: `if/kimi-k2-thinking`, `if/qwen3-coder-plus`, etc.

---

## 4. Usar en herramientas CLI

Apunta tu herramienta de codificación a 9Router:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: cc/claude-opus-4-5-20251101
```

### Claude Desktop

Edita `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [desde el dashboard]
Model: cc/claude-opus-4-5-20251101
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. Crear combos inteligentes (Opcional)

Los combos habilitan el fallback automático entre modelos:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (Suscripción principal)
  2. glm/glm-4.7 (Respaldo barato, $0.6/1M)
  3. if/kimi-k2-thinking (Fallback gratis)

Usar en CLI: premium-coding
```

**Cómo funciona:**
1. Intenta primero Claude Opus (tu suscripción)
2. Si la cuota se agota → GLM-4.7 (ultra-barato)
3. Si llega al límite de presupuesto → iFlow (gratis)
4. ¡Cero tiempo de inactividad, cambio automático!

---

## Modelos disponibles

### Modelos de suscripción (Maximiza primero)

**Claude Code (`cc/`)** - Suscripción Pro/Max:
- `cc/claude-opus-4-5-20251101` - Claude 4.5 Opus
- `cc/claude-sonnet-4-5-20250929` - Claude 4.5 Sonnet
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Suscripción Plus/Pro:
- `cx/gpt-5.2-codex` - GPT 5.2 Codex
- `cx/gpt-5.1-codex-max` - GPT 5.1 Codex Max

**Gemini CLI (`gc/`)** - GRATIS 180K/mes:
- `gc/gemini-3-flash-preview` - Gemini 3 Flash Preview
- `gc/gemini-2.5-pro` - Gemini 2.5 Pro

**GitHub Copilot (`gh/`)** - Suscripción:
- `gh/gpt-5` - GPT-5
- `gh/claude-4.5-sonnet` - Claude 4.5 Sonnet

### Modelos baratos (Respaldo)

**GLM (`glm/`)** - $0.6/$2.2 por 1M:
- `glm/glm-4.7` - GLM 4.7 (reinicio diario 10AM)

**MiniMax (`minimax/`)** - $0.20/$1.00 por 1M:
- `minimax/MiniMax-M2.1` - MiniMax M2.1 (reinicio 5h)

**Kimi (`kimi/`)** - $9/mes (10M tokens):
- `kimi/kimi-latest` - Kimi Latest

### Modelos GRATIS (Emergencia)

**iFlow (`if/`)** - 8 modelos GRATIS:
- `if/kimi-k2-thinking` - Kimi K2 Thinking
- `if/qwen3-coder-plus` - Qwen3 Coder Plus
- `if/glm-4.7` - GLM 4.7
- `if/deepseek-r1` - DeepSeek R1

**Qwen (`qw/`)** - 3 modelos GRATIS:
- `qw/qwen3-coder-plus` - Qwen3 Coder Plus
- `qw/qwen3-coder-flash` - Qwen3 Coder Flash

**Kiro (`kr/`)** - 2 modelos GRATIS:
- `kr/claude-sonnet-4.5` - Claude Sonnet 4.5
- `kr/claude-haiku-4.5` - Claude Haiku 4.5

---

## Estrategia de optimización de costos

### Presupuesto mensual: $10-20/mes

```
1. Usa el nivel gratis de Gemini CLI (180K/mes) para tareas rápidas
2. Usa la cuota de suscripción de Claude Code al máximo (ya pagas)
3. Fallback a GLM ($0.6/1M) cuando se agote la cuota
4. Emergencia: MiniMax M2.1 ($0.20/1M) o iFlow (gratis)

Ejemplo real (100M tokens/mes):
  60M vía Gemini CLI: $0 (nivel gratis)
  30M vía Claude Code: $0 (suscripción que ya tienes)
  8M vía GLM: $4.80
  2M vía MiniMax: $0.40
  Total: $5.20/mes + suscripciones existentes
```

### Estrategia de reinicio de cuota

```
Rutina diaria:
1. Mañana: Cuota fresca de Claude Code (reinicio 5h)
2. Tarde: Cambia a Gemini CLI (1K/día)
3. Noche: Cuota diaria de GLM (reinicio 10AM del día siguiente)
4. Madrugada: MiniMax (rolling 5h) o iFlow (gratis)

→ ¡Codifica 24/7 con costo extra mínimo!
```

---

## Próximos pasos

- [Detalles de instalación](getting-started/installation.md) - Requisitos, troubleshooting
- [Características](features/) - Explora seguimiento de cuota, combos, despliegue
- [FAQ](faq.md) - Preguntas y respuestas comunes
- [Troubleshooting](troubleshooting.md) - Soluciona problemas comunes

---

## ¿Necesitas ayuda?

- **Sitio web**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
