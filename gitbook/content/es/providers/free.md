# Proveedores gratis - Fallback de cero costo

Respaldo de emergencia cuando todo lo demás está limitado por cuota. ¡Codifica 24/7 con cero costo!

---

## Resumen

Los proveedores del nivel gratis son tu **fallback** cuando se agota la cuota de suscripción y la del nivel barato:

- 🆓 **iFlow** - 8 modelos GRATIS (Kimi K2, Qwen3, GLM 4.7, MiniMax M2...)
- 🆓 **Qwen** - 3 modelos GRATIS (Qwen3 Coder Plus/Flash, Vision)
- 🆓 **Kiro** - 2 modelos GRATIS (Claude Sonnet 4.5, Haiku 4.5)

**Estrategia:** Úsalos como respaldo de emergencia. ¡Uso ilimitado, cero costo para siempre!

---

## iFlow (8 modelos GRATIS)

### Precios

| Plan | Costo mensual | Modelos | Cuota |
|------|--------------|--------|-------|
| FREE | $0 | 8 modelos | Ilimitado |

**Mejor valor:** ¡La mayoría de modelos en el nivel gratis! Kimi K2, Qwen3, GLM, MiniMax, DeepSeek.

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect iFlow
```

**Paso 2: Login OAuth de iFlow**

- Clic en "Connect iFlow"
- El navegador abre → página de login de iFlow
- Crea cuenta o inicia sesión
- Otorga permisos
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: if/kimi-k2-thinking
       if/kimi-k2
       if/qwen3-coder-plus
       if/glm-4.7
       if/minimax-m2
       if/deepseek-r1
       if/deepseek-v3.2-chat
       if/deepseek-v3.2-reasoner
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `if/kimi-k2-thinking` | Kimi K2 Thinking | Razonamiento complejo |
| `if/kimi-k2` | Kimi K2 | Codificación general |
| `if/qwen3-coder-plus` | Qwen3 Coder Plus | Generación de código |
| `if/glm-4.7` | GLM 4.7 | Chino + inglés |
| `if/minimax-m2` | MiniMax M2 | Contexto largo |
| `if/deepseek-r1` | DeepSeek R1 | Tareas de razonamiento |
| `if/deepseek-v3.2-chat` | DeepSeek V3.2 Chat | Conversacional |
| `if/deepseek-v3.2-reasoner` | DeepSeek V3.2 Reasoner | Lógica compleja |

### Pro Tips

- **8 modelos GRATIS** - La mayor variedad en el nivel gratis
- **Uso ilimitado** - Sin límites de cuota
- **Kimi K2 Thinking** - Ideal para razonamiento complejo
- **DeepSeek R1** - Fuertes capacidades de razonamiento

---

## Qwen (3 modelos GRATIS)

### Precios

| Plan | Costo mensual | Modelos | Cuota |
|------|--------------|--------|-------|
| FREE | $0 | 3 modelos | Ilimitado |

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Qwen
```

**Paso 2: Autorización por código de dispositivo**

- Clic en "Connect Qwen"
- El dashboard muestra el código de dispositivo
- Visita la URL de autorización
- Ingresa el código de dispositivo
- Inicia sesión en la cuenta de Qwen
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: qw/qwen3-coder-plus
       qw/qwen3-coder-flash
       qw/vision-model
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `qw/qwen3-coder-plus` | Qwen3 Coder Plus | Codificación avanzada |
| `qw/qwen3-coder-flash` | Qwen3 Coder Flash | Respuestas rápidas |
| `qw/vision-model` | Qwen3 Vision | Análisis de imágenes |

### Pro Tips

- **Qwen3 Coder Plus** - Fuertes capacidades de codificación
- **Qwen3 Coder Flash** - Rápido para tareas rápidas
- **Modelo de visión** - Análisis de imágenes GRATIS
- **Uso ilimitado** - Sin límites de cuota

---

## Kiro (Claude GRATIS)

### Precios

| Plan | Costo mensual | Modelos | Cuota |
|------|--------------|--------|-------|
| FREE | $0 | Claude Sonnet 4.5, Haiku 4.5 | Ilimitado |

**Mejor valor:** ¡Claude GRATIS! Misma calidad que Claude Code de pago.

### Configuración

**Paso 1: Conectar vía Dashboard**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**Paso 2: AWS Builder ID u OAuth**

- Clic en "Connect Kiro"
- Elige método de login:
  - AWS Builder ID (recomendado)
  - Cuenta Google
  - Cuenta GitHub
- Otorga permisos
- Auto-refresh de token habilitado

**Paso 3: Usar en CLI**

```
Model: kr/claude-sonnet-4.5
       kr/claude-haiku-4.5
```

### Modelos disponibles

| ID del modelo | Descripción | Ideal para |
|----------|-------------|----------|
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 | Calidad/velocidad equilibrada |
| `kr/claude-haiku-4.5` | Claude Haiku 4.5 | Respuestas rápidas |

### Pro Tips

- **Claude GRATIS** - Misma calidad que el nivel de pago
- **AWS Builder ID** - Configuración fácil con cuenta AWS
- **Uso ilimitado** - Sin límites de cuota
- **Mejor calidad** - ¡Claude 4.5 gratis!

---

## Comparación de características

| Proveedor | Modelos | Mejor modelo | Configuración | Cuota |
|----------|--------|------------|-------|-------|
| **iFlow** | 8 | Kimi K2 Thinking | OAuth | Ilimitado |
| **Qwen** | 3 | Qwen3 Coder Plus | Device Code | Ilimitado |
| **Kiro** | 2 | Claude Sonnet 4.5 | AWS Builder ID | Ilimitado |

**Ganador:** ¡iFlow por variedad, Kiro por calidad!

---

## Ejemplo de uso

### Configuración en Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [desde el dashboard de 9router]
  Model: if/kimi-k2-thinking
```

### Crear combo (Recomendado)

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking (iFlow principal)
  2. qw/qwen3-coder-plus (Qwen respaldo)
  3. kr/claude-sonnet-4.5 (Kiro calidad)

Usar en CLI: free-combo
```

**Resultado:** ¡Cero costo, máximo uptime!

---

## Estrategia de fallback completa

### Combo completo de 3 niveles

```
Dashboard → Combos → Create New

Name: complete-fallback
Models:
  1. gc/gemini-3-flash-preview (Suscripción GRATIS)
  2. cc/claude-opus-4-5 (Suscripción de pago)
  3. glm/glm-4.7 (Respaldo barato, $0.6/1M)
  4. minimax/MiniMax-M2.1 (Más barato, $0.2/1M)
  5. if/kimi-k2-thinking (Fallback GRATIS)
  6. kr/claude-sonnet-4.5 (Calidad GRATIS)

Usar en CLI: complete-fallback
```

**Resultado:**
- Nivel 1: Suscripción GRATIS (Gemini CLI)
- Nivel 2: Suscripción de pago (Claude Code)
- Nivel 3: Respaldo barato (GLM, MiniMax)
- Nivel 4: Fallback GRATIS (iFlow, Kiro)

**¡Nunca dejes de codificar!**

---

## Mejores prácticas

### 1. Úsalos como respaldo de emergencia

```
Prioridad:
1. Nivel de suscripción (maximiza cuota de pago)
2. Nivel barato (centavos por 1M tokens)
3. Nivel GRATIS (ilimitado, cero costo)

Usa el nivel gratis solo cuando:
- Cuota de suscripción agotada
- Límite de presupuesto alcanzado
- Pruebas/tareas no críticas
```

### 2. Elige el modelo correcto

```
Razonamiento complejo: if/kimi-k2-thinking
Codificación rápida: qw/qwen3-coder-flash
Mejor calidad: kr/claude-sonnet-4.5
Contexto largo: if/minimax-m2
Tareas de visión: qw/vision-model
```

### 3. Crea un combo solo-gratis

```
Para codificación de cero costo:

Name: zero-cost
Models:
  1. kr/claude-sonnet-4.5 (Mejor calidad)
  2. if/kimi-k2-thinking (Tareas complejas)
  3. qw/qwen3-coder-plus (Codificación rápida)

¡Costo: $0 para siempre!
```

### 4. Prueba antes de producción

```
Usa el nivel gratis para:
- Probar prompts
- Prototipar características
- Aprender nuevos frameworks
- Tareas no críticas

Guarda la cuota de pago para:
- Código de producción
- Refactoring complejo
- Características críticas
```

---

## Ejemplos reales

### Ejemplo 1: Estudiante/Aprendiz (Cero presupuesto)

```
Configuración:
1. kr/claude-sonnet-4.5 (Mejor calidad)
2. if/kimi-k2-thinking (Razonamiento complejo)
3. qw/qwen3-coder-plus (Codificación rápida)

Costo mensual: $0
Uso: Ilimitado

Perfecto para:
- Aprender a programar
- Proyectos personales
- Tareas/asignaciones
```

### Ejemplo 2: Freelancer (Consciente del presupuesto)

```
Configuración:
1. gc/gemini-3-flash-preview (GRATIS 180K/mes)
2. glm/glm-4.7 (Respaldo barato, $0.6/1M)
3. if/kimi-k2-thinking (Fallback GRATIS)

Costo mensual: $5-10
Uso: 100M+ tokens

Perfecto para:
- Proyectos de cliente (nivel de pago)
- Pruebas (nivel gratis)
- Respaldo de emergencia
```

### Ejemplo 3: Usuario intensivo (Maximiza todo)

```
Configuración:
1. gc/gemini-3-flash-preview (GRATIS 180K/mes)
2. cc/claude-opus-4-5 (Suscripción $20-100)
3. cx/gpt-5.2-codex (Suscripción $20-200)
4. glm/glm-4.7 (Barato $0.6/1M)
5. minimax/MiniMax-M2.1 (Más barato $0.2/1M)
6. if/kimi-k2-thinking (GRATIS ilimitado)
7. kr/claude-sonnet-4.5 (Calidad GRATIS)

Costo mensual: $40-320 (suscripciones) + $10-20 (nivel barato)
Uso: 500M+ tokens

Perfecto para:
- Desarrollo profesional
- Proyectos de equipo
- Codificación 24/7
```

---

## Comparación de costos

### Escenario: 100M tokens/mes

**Opción 1: Solo ChatGPT API**
```
100M × $20/1M = $2,000/mes
```

**Opción 2: Solo nivel gratis de 9Router**
```
100M vía nivel gratis = $0/mes
Ahorros: $2,000/mes (100%)
```

**Opción 3: Estrategia completa de 9Router**
```
60M vía Gemini CLI (GRATIS): $0
30M vía Claude Code (suscripción): $0 extra
8M vía GLM (barato): $4.80
2M vía iFlow (GRATIS): $0
Total: $4.80/mes + suscripciones que ya tienes
Ahorros: $1,995/mes (99.76%)
```

---

## Solución de problemas

### "OAuth failed"

**Solución:**
- Verifica la conexión a internet
- Prueba otro navegador
- Limpia la caché del navegador
- Reconecta en el dashboard

### "Modelo no disponible"

**Solución:**
- Verifica que el proveedor esté conectado en el dashboard
- Verifica que el token OAuth sea válido
- Reconecta el proveedor si es necesario

### "Respuestas lentas"

**Solución:**
- El nivel gratis puede tener menor prioridad
- Úsalo durante horas off-peak
- Cambia a otro proveedor gratis
- Mejora al nivel barato para velocidad

---

## Limitaciones

### Consideraciones del nivel gratis

- **Velocidad** - Puede ser más lento que los niveles de pago
- **Prioridad** - Menor prioridad en horas pico
- **Rate limits** - Posible rate-limiting (pero cuota ilimitada)
- **Disponibilidad** - Puede tener tiempo de inactividad ocasional

**Solución:** ¡Usa la estrategia de fallback de 3 niveles para confiabilidad!

---

## Próximos pasos

- **Configurar suscripciones:** [Proveedores de suscripción](./subscription.md)
- **Agregar respaldo barato:** [Proveedores baratos](./cheap.md)
- **Crear combos:** Dashboard → Combos → Create New
- **Empezar a codificar:** Usa el combo `complete-fallback` para máxima confiabilidad
