# Proveedores de suscripción - Maximiza tu valor

Maximiza tus suscripciones de IA existentes con seguimiento inteligente de cuota y fallback automático. ¡Usa cada bit de tu suscripción antes de que se reinicie!

---

## Resumen

Los proveedores del nivel de suscripción son tu opción **principal** - ya estás pagando por ellos, así que obtén el valor completo:

- ✅ **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex, GPT 5.1 Codex Max
- ✅ **Gemini CLI** (¡Nivel GRATIS!) - 180K completados/mes
- ✅ **GitHub Copilot** - GPT-5, Claude 4.5, Gemini 3
- ✅ **Antigravity** (Google) - Gemini 3 Pro, Claude Sonnet 4.5

**Estrategia:** Úsalos primero, rastrea la cuota en tiempo real, fallback al barato/gratis cuando se agote.

---

## Claude Code (Pro/Max)

### Precios

| Plan | Costo mensual | Reinicio de cuota | Modelos |
|------|--------------|-------------|--------|
| Pro | $20 | 5 horas + semanal | Opus, Sonnet, Haiku |
| Max | $100 | 5 horas + semanal | Opus, Sonnet, Haiku |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Se abre el dashboard → Providers → Connect Claude Code
```

**Paso 2: Login OAuth**

- Clic en "Connect Claude Code"
- El navegador abre → Inicia sesión en Claude.ai
- Auto-refresh de token habilitado
- Comienza el seguimiento de cuota

**Paso 3: Usar en CLI**

```
Model: cc/claude-opus-4-5-20251101
       cc/claude-sonnet-4-5-20250929
       cc/claude-haiku-4-5-20251001
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `cc/claude-opus-4-5-20251101` | Claude 4.5 Opus | Tareas complejas, arquitectura |
| `cc/claude-sonnet-4-5-20250929` | Claude 4.5 Sonnet | Velocidad/calidad equilibrada |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | Respuestas rápidas |

### Pro Tips

- **Usa Opus para tareas complejas** - Decisiones de arquitectura, refactoring
- **Usa Sonnet por velocidad** - Ediciones rápidas, generación de código
- **Rastrea cuota por modelo** - El dashboard muestra uso por modelo
- **Reinicio de 5 horas** - Cuota fresca cada 5 horas + reinicio semanal

---

## OpenAI Codex (Plus/Pro)

### Precios

| Plan | Costo mensual | Reinicio de cuota | Modelos |
|------|--------------|-------------|--------|
| Plus | $20 | 5 horas + semanal | GPT 5.2, GPT 5.1 |
| Pro | $200 | 5 horas + semanal | GPT 5.2 Codex, GPT 5.1 Max |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Codex
```

**Paso 2: Login OAuth**

- Clic en "Connect Codex"
- El navegador abre `http://localhost:1455`
- Inicia sesión en la cuenta de OpenAI
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: cx/gpt-5.2-codex
       cx/gpt-5.1-codex-max
       cx/gpt-5.2
       cx/gpt-5.1-codex
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `cx/gpt-5.2-codex` | GPT 5.2 Codex | Último modelo de codificación |
| `cx/gpt-5.1-codex-max` | GPT 5.1 Codex Max | Contexto máximo |
| `cx/gpt-5.2` | GPT 5.2 | Tareas generales |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | Codificación estable |

### Pro Tips

- **Cuota rolling de 5 horas** - Cuota fresca cada 5 horas
- **Reinicio semanal** - Reinicio completo de cuota cada semana
- **Nivel Pro** - 10× más cuota que Plus

---

## Gemini CLI (¡GRATIS 180K/mes!)

### Precios

| Plan | Costo mensual | Cuota | Reinicio |
|------|--------------|-------|-------|
| FREE | $0 | 180K completados/mes + 1K/día | Diario + Mensual |

**Mejor valor:** ¡Nivel gratis enorme! Úsalo antes de los niveles de pago.

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Gemini CLI
```

**Paso 2: OAuth de Google**

- Clic en "Connect Gemini CLI"
- El navegador abre → Inicia sesión en cuenta Google
- Otorga permisos
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: gc/gemini-3-flash-preview
       gc/gemini-3-pro-preview
       gc/gemini-2.5-pro
       gc/gemini-2.5-flash
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `gc/gemini-3-flash-preview` | Gemini 3 Flash Preview | Respuestas rápidas |
| `gc/gemini-3-pro-preview` | Gemini 3 Pro Preview | Tareas complejas |
| `gc/gemini-2.5-pro` | Gemini 2.5 Pro | Producción estable |
| `gc/gemini-2.5-flash` | Gemini 2.5 Flash | Tareas rápidas |

### Pro Tips

- **180K completados/mes** - Nivel gratis masivo
- **Límite de 1K/día** - La cuota diaria se reinicia a medianoche
- **Úsalo primero** - Nivel gratis, úsalo antes de las suscripciones de pago
- **Sin tarjeta de crédito** - Completamente gratis con cuenta Google

---

## GitHub Copilot

### Precios

| Plan | Costo mensual | Reinicio de cuota | Modelos |
|------|--------------|-------------|--------|
| Individual | $10 | Mensual (día 1) | GPT-5, Claude 4.5, Gemini 3 |
| Business | $19 | Mensual (día 1) | GPT-5, Claude 4.5, Gemini 3 |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect GitHub
```

**Paso 2: OAuth vía GitHub**

- Clic en "Connect GitHub"
- El navegador abre → Inicia sesión en GitHub
- Autoriza GitHub Copilot
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: gh/gpt-5
       gh/gpt-5.1-codex-max
       gh/claude-4.5-sonnet
       gh/gemini-3-pro
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `gh/gpt-5` | GPT-5 | Último modelo de OpenAI |
| `gh/gpt-5.1-codex-max` | GPT-5.1 Codex Max | Contexto máximo |
| `gh/claude-4.5-sonnet` | Claude 4.5 Sonnet | Calidad de Anthropic |
| `gh/gemini-3-pro` | Gemini 3 Pro | Calidad de Google |

### Pro Tips

- **Reinicio mensual** - Reinicio completo de cuota el 1ro del mes
- **Múltiples modelos** - Accede a GPT, Claude, Gemini en una suscripción
- **Nivel Business** - Mayor cuota para equipos

---

## Antigravity (Cuenta Google)

### Precios

| Plan | Costo mensual | Cuota | Modelos |
|------|--------------|-------|--------|
| FREE | $0 | Similar a Gemini CLI | Gemini 3 Pro, Claude Sonnet 4.5 |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Antigravity
```

**Paso 2: OAuth de Google**

- Clic en "Connect Antigravity"
- El navegador abre → Inicia sesión en cuenta Google
- Otorga permisos
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-opus-4-5-thinking
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | Respuestas de alta calidad |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Calidad de Anthropic |
| `ag/claude-opus-4-5-thinking` | Claude Opus 4.5 Thinking | Razonamiento complejo |

### Pro Tips

- **Nivel gratis** - Sin costo con cuenta Google
- **Acceso a Claude** - Claude Sonnet/Opus gratis
- **Cuota similar a Gemini CLI** - Límites diarios/mensuales

---

## Comparación de precios

| Proveedor | Costo mensual | Reinicio de cuota | Valor |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5 horas + semanal | ⭐⭐⭐⭐⭐ Mejor calidad |
| **Claude Code Max** | $100 | 5 horas + semanal | ⭐⭐⭐⭐⭐ Mayor cuota |
| **Codex Plus** | $20 | 5 horas + semanal | ⭐⭐⭐⭐ Buen valor |
| **Codex Pro** | $200 | 5 horas + semanal | ⭐⭐⭐⭐⭐ 10× cuota |
| **Gemini CLI** | **$0** | Diario + Mensual | ⭐⭐⭐⭐⭐ ¡GRATIS 180K/mes! |
| **GitHub Copilot** | $10-19 | Mensual (día 1) | ⭐⭐⭐⭐ Multi-modelo |
| **Antigravity** | **$0** | Diario + Mensual | ⭐⭐⭐⭐ ¡Claude GRATIS! |

---

## Ejemplo de uso

### Configuración en Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: cc/claude-opus-4-5-20251101
```

### Crear combo (Recomendado)

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. gc/gemini-3-flash-preview (GRATIS, usar primero)
  2. cc/claude-opus-4-5-20251101 (Suscripción)
  3. cx/gpt-5.2-codex (Respaldo de suscripción)

Usar en CLI: premium-coding
```

**Resultado:** Maximiza el nivel gratis → Usa suscripción → Fallback automático

---

## Seguimiento de cuota

9Router rastrea la cuota en tiempo real:

- **Consumo de tokens** - Tokens de entrada/salida por solicitud
- **Cuenta regresiva de reinicio** - Tiempo hasta el próximo reinicio de cuota
- **Porcentaje de uso** - Cuánta cuota se ha usado
- **Fallback automático** - Cambia al siguiente nivel cuando se agota

**Vista del dashboard:**

```
Claude Code Pro
├─ Cuota: 75% usada
├─ Reinicio: 2h 15m (5 horas)
├─ Reinicio semanal: 3 días
└─ Fallback: glm/glm-4.7 (nivel barato)
```

---

## Mejores prácticas

### 1. Usa el nivel gratis primero

```
Prioridad:
1. Gemini CLI (180K/mes GRATIS)
2. Antigravity (Claude GRATIS)
3. Claude Code/Codex (suscripciones de pago)
```

### 2. Rastrea la cuota diariamente

- Revisa el dashboard cada mañana
- Planifica tareas pesadas según reinicios de cuota
- Usa el nivel barato/gratis para tareas no críticas

### 3. Crea combos inteligentes

```
Ejemplo de combo:
1. gc/gemini-3-flash-preview (GRATIS principal)
2. cc/claude-opus-4-5 (Tareas complejas)
3. glm/glm-4.7 (Respaldo barato)
4. if/kimi-k2-thinking (Fallback GRATIS)
```

### 4. Optimiza por tiempo

```
Mañana: Cuota fresca de 5 horas (Claude/Codex)
Tarde: Gemini CLI (1K/día)
Noche: Cuota de suscripción
Madrugada: Nivel barato/gratis
```

---

## Solución de problemas

### "Cuota agotada"

**Solución:**
- Verifica el rastreador de cuota del dashboard
- Espera el reinicio (5 horas o diario)
- Usa fallback de combo al nivel barato/gratis

### "Token OAuth expirado"

**Solución:**
- Auto-refresh por 9Router
- Si hay problemas: Dashboard → Provider → Reconnect

### "Rate limiting"

**Solución:**
- Cuota de suscripción agotada
- Agrega fallback: `cc/claude-opus → glm/glm-4.7`
- Usa el nivel gratis: `if/kimi-k2-thinking`

---

## Próximos pasos

- **Configurar respaldo barato:** [Proveedores baratos](./cheap.md)
- **Agregar fallback gratis:** [Proveedores gratis](./free.md)
- **Crear combos:** Dashboard → Combos → Create New
