# Enrutamiento inteligente y fallback automático

9Router enruta automáticamente tus solicitudes a través del mejor proveedor disponible usando un sistema de fallback de 3 niveles. Nunca dejes de codificar debido a límites de cuota o rate-limiting.

---

## Cómo funciona

9Router usa enrutamiento inteligente para maximizar tus suscripciones existentes, minimizar costos y garantizar disponibilidad 24/7:

```
Solicitud → 9Router → Verificar Nivel 1 (Suscripción)
                       ↓ cuota agotada
                       Verificar Nivel 2 (Barato)
                       ↓ límite de presupuesto
                       Verificar Nivel 3 (Gratis)
                       ↓
                       Respuesta
```

### Sistema de fallback de 3 niveles

**Nivel 1: SUSCRIPCIÓN (Primario)**
- Claude Code (Pro/Max)
- OpenAI Codex (Plus/Pro)
- Gemini CLI (GRATIS 180K/mes)
- GitHub Copilot
- Antigravity (Google)

**Objetivo**: Maximizar el valor de las suscripciones que ya pagas.

**Nivel 2: BARATO (Respaldo)**
- GLM-4.7 ($0.60/1M entrada)
- MiniMax M2.1 ($0.20/1M entrada)
- Kimi K2 ($9/mes plano)

**Objetivo**: Respaldo ultra-barato cuando se agota la cuota de suscripción (~90% más barato que ChatGPT API).

**Nivel 3: GRATIS (Emergencia)**
- iFlow (8 modelos)
- Qwen (3 modelos)
- Kiro (Claude GRATIS)

**Objetivo**: Fallback de cero costo para codificación ilimitada.

---

## Cambio automático

9Router monitorea la cuota en tiempo real y cambia de proveedor automáticamente:

### Escenario 1: Cuota de suscripción agotada

```
Solicitud del usuario → cc/claude-opus-4-5
                       ↓ cuota agotada (límite de 5 horas alcanzado)
                       Cambio automático → glm/glm-4.7
                       ↓ cuota diaria agotada
                       Cambio automático → minimax/MiniMax-M2.1
                       ↓ cuota de 5 horas agotada
                       Cambio automático → if/kimi-k2-thinking (GRATIS)
                       ↓
                       Respuesta entregada ✅
```

**Resultado**: Cero tiempo de inactividad, experiencia sin interrupciones.

### Escenario 2: Rate limiting

```
Solicitud del usuario → cx/gpt-5.2-codex
                       ↓ rate limited (demasiadas solicitudes)
                       Cambio automático → glm/glm-4.7
                       ↓
                       Respuesta entregada ✅
```

### Escenario 3: Proveedor no disponible

```
Solicitud del usuario → cc/claude-opus-4-5
                       ↓ error del proveedor (503)
                       Cambio automático → siguiente modelo disponible
                       ↓
                       Respuesta entregada ✅
```

---

## Lógica de selección de modelo

9Router selecciona el mejor modelo según:

1. **Disponibilidad de cuota** - Verifica si el proveedor tiene cuota restante
2. **Nivel de costo** - Prefiere suscripción → barato → gratis
3. **Tiempo de reinicio** - Considera cuándo se reinicia la cuota
4. **Salud del proveedor** - Omite proveedores con errores

### Ejemplo de orden de prioridad

Para una solicitud a `cc/claude-opus-4-5`:

```
1. Verificar cuota de Claude Code
   ✅ Disponible → Usa cc/claude-opus-4-5
   ❌ Agotada → Continúa al paso 2

2. Verificar nivel de fallback (si está configurado)
   ✅ Cuota de GLM disponible → Usa glm/glm-4.7
   ❌ Agotada → Continúa al paso 3

3. Verificar nivel gratis
   ✅ iFlow disponible → Usa if/kimi-k2-thinking
   ❌ Todo agotado → Devuelve error de cuota
```

---

## Opciones de configuración

### Configuración del dashboard

**1. Habilitar/Deshabilitar fallback automático**

```
Dashboard → Settings → Smart Routing
→ Toggle "Auto Fallback" ON/OFF
```

- **ON** (por defecto): Cambio automático de nivel
- **OFF**: Modo estricto, devuelve error si el modelo principal no está disponible

**2. Establecer límites de presupuesto**

```
Dashboard → Settings → Budget Control
→ Límite diario: $5
→ Límite mensual: $50
```

Cuando se alcanza el presupuesto, 9Router cambia automáticamente al nivel gratis.

**3. Configurar el orden de fallback**

```
Dashboard → Settings → Fallback Priority
→ Arrastra para reordenar proveedores dentro de cada nivel
```

Ejemplo de orden personalizado:
```
Nivel 1: Gemini CLI → Claude Code → Codex
Nivel 2: MiniMax → GLM → Kimi
Nivel 3: iFlow → Kiro → Qwen
```

**4. Notificaciones de reinicio de cuota**

```
Dashboard → Settings → Notifications
→ Email cuando se reinicia la cuota
→ Alerta cuando se usa 80% de cuota
```

---

## Ejemplos

### Ejemplo 1: Fallback automático básico

**Configuración:**
```
Model: cc/claude-opus-4-5-20251101
Fallback: Auto (3 niveles por defecto)
```

**Comportamiento:**
```
Mañana (cuota fresca):
  Solicitud → cc/claude-opus-4-5 ✅

Tarde (cuota agotada):
  Solicitud → glm/glm-4.7 ✅ (cambio automático)

Noche (cuota de GLM agotada):
  Solicitud → minimax/MiniMax-M2.1 ✅ (cambio automático)

Madrugada (toda la cuota de pago agotada):
  Solicitud → if/kimi-k2-thinking ✅ (nivel gratis)
```

**Costo**: ~$5-10/mes extra (en su mayoría cubierto por la suscripción).

### Ejemplo 2: Enrutamiento consciente del presupuesto

**Configuración:**
```
Dashboard → Settings:
  Presupuesto diario: $2
  Presupuesto mensual: $20
  Fallback: Habilitado
```

**Comportamiento:**
```
Día 1-15 (dentro del presupuesto):
  Solicitudes → glm/glm-4.7 (nivel barato)
  Costo: $1.50/día

Día 16 (presupuesto alcanzado):
  Solicitudes → if/kimi-k2-thinking (nivel gratis)
  Costo: $0

Mes siguiente (presupuesto se reinicia):
  Solicitudes → glm/glm-4.7 nuevamente
```

**Resultado**: Nunca excede $20/mes, siempre disponible.

### Ejemplo 3: Modo solo suscripción

**Configuración:**
```
Dashboard → Settings:
  Fallback automático: OFF
  Modo estricto: ON
```

**Comportamiento:**
```
Solicitud → cc/claude-opus-4-5
  ✅ Cuota disponible → Éxito
  ❌ Cuota agotada → Devuelve error (sin fallback)
```

**Caso de uso**: Cuando solo quieres usar suscripciones de pago, sin costos extras.

### Ejemplo 4: Modo solo gratis

**Configuración:**
```
Model: if/kimi-k2-thinking
Fallback: qw/qwen3-coder-plus → kr/claude-sonnet-4.5
```

**Comportamiento:**
```
Todas las solicitudes → Solo nivel gratis
Costo: $0 para siempre
```

**Caso de uso**: Proyectos personales, aprendizaje, experimentación.

---

## Mejores prácticas

### 1. Maximiza el valor de la suscripción

```
Estrategia:
- Establece modelos de suscripción como Nivel 1
- Monitorea el uso de cuota en el dashboard
- Usa el nivel barato solo cuando la suscripción se agote
```

**Ejemplo de combo:**
```
cc/claude-opus-4-5 → glm/glm-4.7 → if/kimi-k2-thinking
```

### 2. Optimiza por costo

```
Estrategia:
- Usa el nivel gratis de Gemini CLI primero (180K/mes)
- Fallback a GLM/MiniMax (ultra-baratos)
- Emergencia: iFlow (gratis)
```

**Ejemplo de combo:**
```
gc/gemini-3-flash-preview → glm/glm-4.7 → if/kimi-k2-thinking
```

### 3. Optimiza por calidad

```
Estrategia:
- Usa los mejores modelos (Claude Opus, GPT-5.2)
- Fallback a modelos baratos buenos (GLM-4.7)
- Último recurso: Nivel gratis
```

**Ejemplo de combo:**
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → glm/glm-4.7
```

### 4. Disponibilidad 24/7

```
Estrategia:
- Siempre incluye el nivel gratis en el fallback
- Monitorea los tiempos de reinicio de cuota
- Distribuye el uso entre proveedores
```

**Ejemplo de combo:**
```
cc/claude-opus-4-5 → glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

**Resultado**: Nunca te quedas sin cuota, codifica en cualquier momento.

---

## Estrategia de reinicio de cuota

Planifica tu uso según los tiempos de reinicio de cuota:

| Proveedor | Reinicio de cuota | Estrategia |
|----------|-------------|----------|
| **Claude Code** | 5 horas + semanal | Usar en la mañana, cuota fresca |
| **Codex** | 5 horas + semanal | Usar después de cuota de Claude |
| **Gemini CLI** | Diario (1K) + Mensual (180K) | Usar durante el día |
| **GLM-4.7** | Diario 10:00 AM | Usar en la noche, se reinicia al día siguiente |
| **MiniMax M2.1** | Rolling 5 horas | Usar cuando sea, rastrea ventana rolling |
| **iFlow/Qwen/Kiro** | Sin límite | Respaldo de emergencia |

**Ejemplo de rutina diaria:**
```
08:00 - 13:00: Claude Code (cuota fresca 5h)
13:00 - 18:00: Gemini CLI (cuota 1K/día)
18:00 - 22:00: GLM-4.7 (barato, se reinicia 10AM)
22:00 - 08:00: MiniMax o iFlow (rolling 5h o gratis)
```

---

## Monitoreo y alertas

### Rastreador de cuota del dashboard

```
Dashboard → Quota Overview:
  Claude Code: 2.5h / 5h restantes (50%)
  Gemini CLI: 450 / 1000 solicitudes hoy
  GLM-4.7: 5M / 10M tokens (se reinicia en 8h)
  MiniMax: 3M / 5M tokens (rolling 5h)
```

### Notificaciones en tiempo real

```
Dashboard → Notifications:
  ⚠️ Cuota de Claude Code 80% usada (1h restante)
  ✅ Cuota de GLM-4.7 reiniciada (10M tokens disponibles)
  💰 Presupuesto diario 50% usado ($2.50 / $5)
```

### Analítica de uso

```
Dashboard → Analytics:
  Hoy: 50M tokens
    - 30M vía Claude Code (suscripción)
    - 15M vía GLM-4.7 ($9)
    - 5M vía iFlow (gratis)
  
  Costo: $9 (vs $1000 en ChatGPT API)
  Ahorros: 99%
```

---

## Solución de problemas

**Problema: "All providers quota exhausted"**

**Solución:**
1. Verifica el rastreador de cuota del dashboard
2. Espera el reinicio de cuota (mira la cuenta regresiva)
3. Agrega el nivel gratis a la cadena de fallback
4. O aumenta el límite de presupuesto

**Problema: "Demasiados cambios de fallback"**

**Solución:**
1. Verifica si el proveedor principal está caído
2. Aumenta los límites de cuota (mejora la suscripción)
3. Usa un modelo principal más barato (GLM en lugar de Claude)

**Problema: "Costos inesperados"**

**Solución:**
1. Dashboard → Analytics → Revisa el uso
2. Establece límites de presupuesto diarios/mensuales
3. Cambia al nivel gratis para tareas no críticas
4. Usa combos con fallback gratis

---

## Relacionado

- [Combos](./combos.md) - Crea cadenas de fallback personalizadas
- [Seguimiento de cuota](./quota-tracking.md) - Monitorea uso y costos
