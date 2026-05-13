# Combos - Cadenas de fallback personalizadas

Crea combinaciones de modelos personalizadas con fallback automático. Los combos te permiten definir tu propia estrategia de enrutamiento basada en costo, calidad y disponibilidad.

---

## ¿Qué son los combos?

Los combos son **cadenas de fallback personalizadas** que creas en el dashboard. En lugar de usar un solo modelo, defines una secuencia de modelos que 9Router intenta en orden.

**Ejemplo:**
```
Nombre del combo: premium-coding
Modelos:
  1. cc/claude-opus-4-5-20251101 (intentar primero)
  2. glm/glm-4.7 (si #1 tiene cuota agotada)
  3. minimax/MiniMax-M2.1 (si #2 tiene cuota agotada)
```

**Uso en CLI:**
```
Model: premium-coding
```

9Router intenta automáticamente cada modelo en secuencia hasta que uno tenga éxito.

---

## ¿Por qué usar combos?

### 1. Maximiza el valor de la suscripción
```
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

→ Usa la suscripción primero, respaldo barato, emergencia gratis
→ Obtén el valor completo de las suscripciones que ya pagas
```

### 2. Minimiza costos
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking

→ Comienza con la opción de pago más barata ($0.60/1M)
→ Fallback a una aún más barata ($0.20/1M)
→ Nivel de emergencia gratis
→ Costo total: ~$5-10/mes vs $2000 en ChatGPT API
```

### 3. Garantiza disponibilidad 24/7
```
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7 → if/kimi-k2-thinking

→ Siempre incluye el nivel gratis al final
→ Nunca te quedes sin cuota
→ Codifica en cualquier momento, en cualquier lugar
```

### 4. Optimiza por calidad
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → gc/gemini-3-pro

→ Mejores modelos primero
→ Fallback a otros modelos premium
→ Mantén alta calidad en toda la cadena de fallback
```

---

## Cómo crear combos

### Paso 1: Abrir el dashboard

```
http://localhost:20128
→ Inicia sesión con tu contraseña
```

### Paso 2: Navegar a Combos

```
Dashboard → Combos → Create New Combo
```

### Paso 3: Configurar el combo

**Nombre del combo:**
```
premium-coding
```

**Descripción (opcional):**
```
Suscripción primero, respaldo barato, emergencia gratis
```

**Seleccionar modelos:**
```
1. cc/claude-opus-4-5-20251101
2. glm/glm-4.7
3. minimax/MiniMax-M2.1
```

**Arrastra para reordenar** - Prioridad de arriba a abajo.

### Paso 4: Guardar

```
Clic en "Save Combo"
→ El combo aparece en la lista de modelos
```

### Paso 5: Usar en CLI

```
Cursor/Cline/Cualquier herramienta:
  Model: premium-coding
```

---

## Combos de ejemplo

### Ejemplo 1: Premium Coding (Suscripción → Barato → Gratis)

**Objetivo**: Maximizar el valor de la suscripción, minimizar costos extras.

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

**Uso:**
```
Cursor IDE:
  Model: premium-coding
```

**Comportamiento:**
```
Mañana (cuota fresca):
  Solicitud → cc/claude-opus-4-5 ✅

Tarde (cuota de Claude agotada):
  Solicitud → glm/glm-4.7 ✅ (cambio automático)

Noche (cuota de GLM agotada):
  Solicitud → minimax/MiniMax-M2.1 ✅ (cambio automático)
```

**Costo mensual (100M tokens):**
```
80M vía Claude Code: $0 (suscripción)
15M vía GLM: $9
5M vía MiniMax: $1
Total: $10 + tu suscripción
```

**Ahorros**: ~99% vs ChatGPT API ($2000).

---

### Ejemplo 2: Combo de presupuesto (Barato → Gratis)

**Objetivo**: Minimizar costos, usar el nivel gratis como respaldo.

```
Dashboard → Combos → Create New

Name: budget-combo
Models:
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/kimi-k2-thinking
```

**Uso:**
```
Cline:
  Provider: OpenAI Compatible
  Base URL: http://localhost:20128/v1
  Model: budget-combo
```

**Comportamiento:**
```
Solicitud → glm/glm-4.7
  ✅ Cuota diaria disponible → Usa GLM ($0.60/1M)
  ❌ Cuota agotada → Intenta MiniMax ($0.20/1M)
  ❌ Cuota de MiniMax agotada → Usa iFlow (GRATIS)
```

**Costo mensual (100M tokens):**
```
70M vía GLM: $42
20M vía MiniMax: $4
10M vía iFlow: $0
Total: $46 vs $2000 en ChatGPT API
```

**Ahorros**: 97%.

---

### Ejemplo 3: Combo gratis (Cero costo)

**Objetivo**: 100% gratis, sin costos nunca.

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking
  2. qw/qwen3-coder-plus
  3. kr/claude-sonnet-4.5
```

**Uso:**
```
Claude Desktop:
  Model: free-combo
```

**Comportamiento:**
```
Solicitud → if/kimi-k2-thinking
  ✅ Disponible → Usa iFlow
  ❌ Error → Intenta Qwen
  ❌ Error → Intenta Kiro
```

**Costo mensual:**
```
100M tokens vía proveedores gratis: $0
Total: $0 para siempre
```

**Caso de uso**: Proyectos personales, aprendizaje, experimentación.

---

### Ejemplo 4: Calidad primero (Solo modelos premium)

**Objetivo**: Mejor calidad, sin fallback barato.

```
Dashboard → Combos → Create New

Name: quality-first
Models:
  1. cc/claude-opus-4-5-20251101
  2. cx/gpt-5.2-codex
  3. gc/gemini-3-pro-preview
```

**Uso:**
```
Codex CLI:
  export OPENAI_BASE_URL="http://localhost:20128"
  Model: quality-first
```

**Comportamiento:**
```
Solicitud → cc/claude-opus-4-5
  ❌ Cuota agotada → cx/gpt-5.2-codex
  ❌ Cuota agotada → gc/gemini-3-pro-preview
  ❌ Todo agotado → Devuelve error (sin fallback barato)
```

**Caso de uso**: Código crítico de producción, refactoring complejo.

---

### Ejemplo 5: Multi-suscripción (Maximiza todo)

**Objetivo**: Usa todas las suscripciones antes de pagar extra.

```
Dashboard → Combos → Create New

Name: multi-sub
Models:
  1. gc/gemini-3-flash-preview (GRATIS 180K/mes)
  2. cc/claude-opus-4-5-20251101 (suscripción Pro)
  3. cx/gpt-5.2-codex (suscripción Plus)
  4. gh/gpt-5 (suscripción Copilot)
  5. glm/glm-4.7 (respaldo barato)
  6. if/kimi-k2-thinking (emergencia gratis)
```

**Costo mensual (200M tokens):**
```
50M vía Gemini CLI: $0 (nivel gratis)
80M vía Claude Code: $0 (suscripción)
40M vía Codex: $0 (suscripción)
20M vía Copilot: $0 (suscripción)
8M vía GLM: $4.80
2M vía iFlow: $0
Total: $4.80 + suscripciones existentes
```

**Resultado**: Usa 190M tokens de suscripciones, solo $4.80 extra.

---

### Ejemplo 6: Optimización de reinicio de cuota

**Objetivo**: Distribuir el uso según los tiempos de reinicio.

```
Dashboard → Combos → Create New

Name: reset-optimized
Models:
  1. cc/claude-opus-4-5 (reinicio 5h, usar mañana)
  2. gc/gemini-3-flash (1K/día, usar tarde)
  3. glm/glm-4.7 (reinicio diario 10AM, usar noche)
  4. minimax/MiniMax-M2.1 (rolling 5h, usar madrugada)
  5. if/kimi-k2-thinking (ilimitado, emergencia)
```

**Rutina diaria:**
```
08:00 - 13:00: Claude Code (cuota fresca de 5h)
13:00 - 18:00: Gemini CLI (cuota 1K/día)
18:00 - 22:00: GLM (se reinicia 10AM del día siguiente)
22:00 - 08:00: MiniMax (rolling 5h) o iFlow
```

**Resultado**: Codifica 24/7 con costos mínimos.

---

## Usar combos en herramientas CLI

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard]
  Model: premium-coding
```

### Claude Desktop

Edita `~/.claude/config.json`:
```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key",
  "model": "budget-combo"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex --model quality-first "your prompt"
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [desde el dashboard]
Model: free-combo
```

### Solicitud por API

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [
      {"role": "user", "content": "Write a function to..."}
    ],
    "stream": true
  }'
```

---

## Mejores prácticas

### 1. Siempre incluye el nivel gratis

```
✅ Bueno:
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

❌ Malo:
cc/claude-opus → glm/glm-4.7
(sin fallback gratis, puede quedarse sin cuota)
```

**Por qué**: Garantiza disponibilidad 24/7, nunca bloqueado por cuota.

### 2. Ordena por costo (Barato a costoso)

```
✅ Bueno:
glm/glm-4.7 → minimax/MiniMax-M2.1 → cc/claude-opus

❌ Malo:
cc/claude-opus → glm/glm-4.7
(desperdicia cuota de suscripción en tareas simples)
```

**Excepción**: Si quieres maximizar el valor de la suscripción, pon la suscripción primero.

### 3. Coincide con los requisitos de calidad

```
Para código de producción:
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7

Para tareas rápidas:
glm/glm-4.7 → if/kimi-k2-thinking

Para experimentación:
if/kimi-k2-thinking → qw/qwen3-coder-plus
```

### 4. Considera los tiempos de reinicio de cuota

```
Combo matutino (cuotas frescas):
cc/claude-opus → cx/gpt-5.2-codex

Combo nocturno (cuotas probablemente agotadas):
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

### 5. Crea múltiples combos para diferentes casos de uso

```
premium-coding: Para tareas complejas
budget-combo: Para tareas simples
free-combo: Para experimentación
quality-first: Para código de producción
```

**Cambia entre combos** según los requisitos de la tarea.

### 6. Monitorea el desempeño del combo

```
Dashboard → Analytics → Combo Usage:
  premium-coding:
    80% vía cc/claude-opus (bueno, usando suscripción)
    15% vía glm/glm-4.7 (respaldo aceptable)
    5% vía minimax (fallback raro)
```

**Optimiza**: Si hay demasiado uso de fallback, aumenta la cuota principal o reordena modelos.

---

## Configuración avanzada

### Establecer límites de presupuesto por combo

```
Dashboard → Combos → Edit → Budget:
  Daily limit: $5
  Monthly limit: $50
```

Cuando se alcanza el límite, 9Router omite los modelos de pago y usa solo el nivel gratis.

### Habilitar/Deshabilitar modelos en un combo

```
Dashboard → Combos → Edit → Models:
  ✅ cc/claude-opus-4-5 (habilitado)
  ❌ glm/glm-4.7 (deshabilitado temporalmente)
  ✅ if/kimi-k2-thinking (habilitado)
```

**Caso de uso**: Deshabilitar temporalmente modelos costosos sin eliminar el combo.

### Clonar un combo existente

```
Dashboard → Combos → Clone "premium-coding"
→ Crea una copia con sufijo "-copy"
→ Modifica y guarda como nuevo combo
```

**Caso de uso**: Crear variaciones para diferentes escenarios.

---

## Solución de problemas

**Problema: El combo no aparece en la lista de modelos**

**Solución:**
1. Refresca el dashboard
2. Verifica que el combo esté guardado (marca verde)
3. Reinicia la herramienta CLI para refrescar la lista de modelos

**Problema: El combo siempre usa el último modelo (nivel gratis)**

**Solución:**
1. Verifica la cuota de los modelos principales (Dashboard → Quota)
2. Verifica que las API keys sean válidas (Dashboard → Providers)
3. Verifica que no se hayan excedido los límites de presupuesto

**Problema: El combo cuesta más de lo esperado**

**Solución:**
1. Dashboard → Analytics → Revisa el uso del combo
2. Verifica si los modelos principales tienen cuota agotada
3. Reordena los modelos (pon los más baratos primero)
4. Establece límites de presupuesto

---

## Relacionado

- [Enrutamiento inteligente](./smart-routing.md) - Cómo funciona el fallback automático
- [Seguimiento de cuota](./quota-tracking.md) - Monitorea uso y costos
