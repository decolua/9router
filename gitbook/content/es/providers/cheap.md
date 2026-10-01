# Proveedores baratos - Respaldo ultra-barato

Cuando se agota la cuota de suscripción, paga centavos en lugar de dólares. ¡~90% más barato que ChatGPT API!

---

## Resumen

Los proveedores del nivel barato son tu **respaldo** cuando se agota la cuota de suscripción:

- 💰 **GLM-4.7** - $0.6/$2.2 por 1M tokens (reinicio diario)
- 💰 **MiniMax M2.1** - $0.2/$1.0 por 1M tokens (reinicio 5h)
- 💰 **Kimi K2** - $9/mes plano (10M tokens)

**Estrategia:** Úsalos después de agotar la cuota de suscripción, antes del nivel gratis. Ahorros masivos vs ChatGPT API ($20/1M).

---

## GLM-4.7 (Reinicio diario)

### Precios

| Nivel | Entrada | Salida | Reinicio |
|------|-------|--------|-------|
| Standard | $0.60/1M | $2.20/1M | Diario 10:00 AM |
| Coding Plan | $0.60/1M | $2.20/1M | Diario 10:00 AM (3× cuota) |

**Ejemplo de costo (10M tokens):**
- Entrada: 10M × $0.60 = $6
- Salida: 10M × $2.20 = $22
- **Total: $6-22** ¡vs $200 en ChatGPT API!

### Configuración

**Paso 1: Registrarse**

1. Visita [Zhipu AI](https://open.bigmodel.cn/)
2. Crea cuenta (verificación por teléfono)
3. Elige **Coding Plan** para 3× cuota al mismo precio

**Paso 2: Obtener API Key**

```bash
Dashboard → API Keys → Create New
→ Copia la API key (comienza con "zhipu-")
```

**Paso 3: Agregar a 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: glm
API Key: zhipu-your-api-key-here
```

**Paso 4: Usar en CLI**

```
Model: glm/glm-4.7
       glm/glm-4.6v (vision)
```

### Modelos disponibles

| ID del modelo | Descripción | Contexto | Ideal para |
|----------|-------------|---------|----------|
| `glm/glm-4.7` | GLM 4.7 | 128K | Codificación, tareas generales |
| `glm/glm-4.6v` | GLM 4.6V Vision | 128K | Análisis de imágenes |

### Pro Tips

- **Coding Plan** - 3× cuota al mismo precio ($0.6/$2.2)
- **Reinicio diario** - Cuota fresca a las 10:00 AM hora de Beijing
- **Ideal para codificación** - Optimizado para generación de código
- **128K de contexto** - Maneja archivos grandes

### Reinicio de cuota

```
Reinicio diario: 10:00 AM hora Beijing (UTC+8)
→ 2:00 AM UTC
→ 6:00 PM PST (día anterior)
→ 9:00 PM EST (día anterior)

¡Planifica tus tareas pesadas según el tiempo de reinicio!
```

---

## MiniMax M2.1 (Reinicio 5 horas)

### Precios

| Nivel | Entrada | Salida | Reinicio |
|------|-------|--------|-------|
| Standard | $0.20/1M | $1.00/1M | Rolling 5 horas |

**Ejemplo de costo (10M tokens):**
- Entrada: 10M × $0.20 = $2
- Salida: 10M × $1.00 = $10
- **Total: $2-10** - ¡La opción más barata!

### Configuración

**Paso 1: Registrarse**

1. Visita [MiniMax](https://www.minimax.io/)
2. Crea cuenta
3. Verifica email/teléfono

**Paso 2: Obtener API Key**

```bash
Dashboard → API Management → Create Key
→ Copia la API key
```

**Paso 3: Agregar a 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: minimax
API Key: your-minimax-api-key
```

**Paso 4: Usar en CLI**

```
Model: minimax/MiniMax-M2.1
```

### Modelos disponibles

| ID del modelo | Descripción | Contexto | Ideal para |
|----------|-------------|---------|----------|
| `minimax/MiniMax-M2.1` | MiniMax M2.1 | 1M tokens | Contexto largo, codificación |

### Pro Tips

- **La opción más barata** - $0.20/1M entrada (90% más barato que ChatGPT)
- **Rolling 5 horas** - La cuota se reinicia cada 5 horas
- **Contexto de 1M** - Ventana de contexto masiva
- **Ideal para archivos largos** - Maneja codebases enteras

### Reinicio de cuota

```
Ventana rolling de 5 horas:
→ Usar cuota → Esperar 5 horas → Cuota fresca

Ejemplo:
10:00 AM - Usar 5M tokens
3:00 PM - Cuota fresca disponible
8:00 PM - Cuota fresca disponible

¡Codifica 24/7 con costo mínimo!
```

---

## Kimi K2 ($9/mes plano)

### Precios

| Plan | Costo mensual | Tokens incluidos | Costo efectivo |
|------|--------------|-----------------|----------------|
| Subscription | $9 | 10M tokens | $0.90/1M |

**Ejemplo de costo:**
- $9/mes plano
- 10M tokens incluidos
- **Efectivo: $0.90/1M** - ¡Mejor valor para uso constante!

### Configuración

**Paso 1: Suscribirse**

1. Visita [Moonshot AI](https://platform.moonshot.ai/)
2. Crea cuenta
3. Suscríbete al plan $9/mes

**Paso 2: Obtener API Key**

```bash
Dashboard → API Keys → Create New
→ Copia la API key
```

**Paso 3: Agregar a 9Router**

```bash
9router
# Dashboard → Providers → Add API Key

Provider: kimi
API Key: your-kimi-api-key
```

**Paso 4: Usar en CLI**

```
Model: kimi/kimi-latest
```

### Modelos disponibles

| ID del modelo | Descripción | Contexto | Ideal para |
|----------|-------------|---------|----------|
| `kimi/kimi-latest` | Kimi Latest | 200K | Codificación general |

### Pro Tips

- **Costo fijo** - $9/mes sin importar el uso (hasta 10M)
- **Ideal para uso constante** - Si usas 10M/mes, solo $0.90/1M
- **Reinicio mensual** - 10M tokens se reinician mensualmente
- **Facturación predecible** - Sin costos sorpresa

### Reinicio de cuota

```
Reinicio mensual: 1ro de cada mes
→ 10M tokens se refrescan

Ejemplo de uso mensual:
Semana 1: 3M tokens
Semana 2: 2M tokens
Semana 3: 3M tokens
Semana 4: 2M tokens
Total: 10M tokens = $9 plano
```

---

## Comparación de precios

| Proveedor | Entrada/1M | Salida/1M | Reinicio | Costo 10M | Ideal para |
|----------|----------|-----------|-------|----------|----------|
| **GLM-4.7** | $0.60 | $2.20 | Diario 10AM | $6-22 | Usuarios con cuota diaria |
| **MiniMax M2.1** | $0.20 | $1.00 | 5 horas | $2-10 | **¡La más barata!** |
| **Kimi K2** | $0.90 | $0.90 | Mensual | **$9 plano** | Uso constante |
| ChatGPT API | $20.00 | $20.00 | Ninguno | $200 | ❌ Costoso |

**Ahorros:** ¡90-95% más barato que ChatGPT API!

---

## Ejemplo de uso

### Configuración en Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: glm/glm-4.7
```

### Crear combo (Recomendado)

```
Dashboard → Combos → Create New

Name: cheap-backup
Models:
  1. cc/claude-opus-4-5 (Suscripción principal)
  2. glm/glm-4.7 (Respaldo barato, reinicio diario)
  3. minimax/MiniMax-M2.1 (Fallback más barato)
  4. if/kimi-k2-thinking (Emergencia GRATIS)

Usar en CLI: cheap-backup
```

**Resultado:** Suscripción → Barato → Más barato → Gratis

---

## Optimización de costos

### Estrategia 1: Rutina de reinicio diario

```
Mañana (10AM): Cuota fresca de GLM
→ Usa GLM para tareas pesadas
→ Ahorra cuota de suscripción

Tarde: Cuota de suscripción
→ Usa Claude/Codex para tareas complejas

Noche: MiniMax (reinicio 5h)
→ Respaldo barato para trabajo nocturno

Madrugada: Nivel gratis (iFlow)
→ Respaldo de emergencia cero costo
```

### Estrategia 2: Presupuesto primero

```
Establece presupuesto mensual: $20

Asignación:
- $9 Kimi K2 (10M tokens plano)
- $6 cuota diaria de GLM (10M tokens)
- $5 overflow de MiniMax (25M tokens)

Total: 45M tokens por $20
¡vs 1M tokens por $20 en ChatGPT API!
```

### Estrategia 3: Maximiza suscripciones primero

```
Prioridad:
1. Gemini CLI (180K/mes GRATIS)
2. Claude Code (suscripción que ya pagas)
3. GLM-4.7 (respaldo barato, $0.6/1M)
4. MiniMax M2.1 (más barato, $0.2/1M)
5. iFlow (emergencia GRATIS)

Ejemplo de costo mensual (100M tokens):
- 60M vía Gemini CLI: $0 (gratis)
- 30M vía Claude Code: $0 (suscripción)
- 8M vía GLM: $4.80
- 2M vía MiniMax: $0.40
¡Total: $5.20/mes!
```

---

## Ejemplos reales

### Ejemplo 1: Mes de codificación intensa (100M tokens)

```
Desglose:
- 60M vía suscripción (Claude/Codex): $0 extra
- 30M vía GLM-4.7: $18
- 10M vía MiniMax M2.1: $2

Total: $20/mes
¡vs $2000 en ChatGPT API!

Ahorros: ¡99% más barato!
```

### Ejemplo 2: Codificador con presupuesto ($10/mes)

```
Estrategia:
- $9 Kimi K2 (10M tokens)
- $1 overflow de MiniMax (5M tokens)

Total: 15M tokens por $10
¡vs 0.5M tokens por $10 en ChatGPT API!

¡30× más tokens!
```

### Ejemplo 3: Freelancer (Uso variable)

```
Mes ligero (20M tokens):
- 15M vía suscripción: $0
- 5M vía GLM: $3
Total: $3

Mes intenso (150M tokens):
- 60M vía suscripción: $0
- 60M vía GLM: $36
- 30M vía MiniMax: $6
Total: $42

Promedio: $22.50/mes
¡vs $3400 en ChatGPT API!
```

---

## Mejores prácticas

### 1. Rastrea la cuota diaria

```
El dashboard muestra:
- Cuota GLM: 75% usado (reinicio en 6h)
- Cuota MiniMax: 50% usado (reinicio en 2h)
- Cuota Kimi: 8M/10M usado (reinicio en 15 días)

¡Planifica tareas pesadas según los tiempos de reinicio!
```

### 2. Usa el Coding Plan (GLM)

```
Standard: 1× cuota
Coding Plan: 3× cuota (¡mismo precio!)

→ Siempre elige Coding Plan
```

### 3. Combina con el nivel gratis

```
Combo:
1. gc/gemini-3-flash (GRATIS principal)
2. glm/glm-4.7 (respaldo barato)
3. minimax/MiniMax-M2.1 (más barato)
4. if/kimi-k2-thinking (emergencia GRATIS)

Resultado: Minimiza costos, maximiza uptime
```

### 4. Establece alertas de presupuesto

```
Dashboard → Settings → Budget Alerts

Diario: $2 límite
Semanal: $10 límite
Mensual: $30 límite

→ Cambio automático al nivel gratis cuando se alcanza el límite
```

---

## Solución de problemas

### "Cuota agotada"

**Solución:**
- GLM: Espera hasta las 10:00 AM hora Beijing
- MiniMax: Espera 5 horas desde el primer uso
- Kimi: Espera hasta el 1ro del próximo mes
- Usa fallback de combo al nivel gratis

### "API key inválida"

**Solución:**
- Verifica que la API key esté copiada correctamente
- Verifica que la cuenta tenga créditos
- Regenera la API key si es necesario

### "Costos altos"

**Solución:**
- Revisa las estadísticas de uso en el dashboard
- Establece alertas de presupuesto
- Cambia a MiniMax ($0.2/1M, la más barata)
- Usa el nivel gratis para tareas no críticas

---

## Próximos pasos

- **Agregar fallback gratis:** [Proveedores gratis](./free.md)
- **Configurar suscripciones:** [Proveedores de suscripción](./subscription.md)
- **Crear combos:** Dashboard → Combos → Create New
