# Seguimiento de cuota y monitoreo de uso

Rastrea el consumo de tokens en tiempo real, monitorea los límites de cuota, estima costos y recibe alertas antes de quedarte sin recursos. Nunca desperdicies cuota de suscripción ni excedas los límites de presupuesto.

---

## Resumen

9Router proporciona un seguimiento de cuota integral para todos los proveedores:

- **Consumo de tokens en tiempo real** - Mira los tokens usados por solicitud
- **Límites de cuota y restantes** - Rastrea el uso vs límites
- **Cuenta regresiva de reinicio** - Sabe cuándo se refresca la cuota
- **Estimación de costos** - Calcula el gasto para niveles de pago
- **Reportes mensuales** - Analiza patrones de uso
- **Alertas y notificaciones** - Recibe advertencias antes de los límites

---

## Resumen del dashboard

### Resumen de cuota

```
Dashboard → Home → Quota Overview

┌─────────────────────────────────────────────┐
│ Claude Code (cc/)                           │
│ ████████████░░░░░░░░ 2.5h / 5h (50%)       │
│ Se reinicia en: 2h 30m                      │
│ Costo: $0 (suscripción)                     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Gemini CLI (gc/)                            │
│ ████████░░░░░░░░░░░░ 450 / 1000 (45%)      │
│ Reinicio diario en: 18h 30m                 │
│ Mensual: 45K / 180K (25%)                   │
│ Costo: $0 (nivel gratis)                    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ GLM-4.7 (glm/)                              │
│ ██████████████░░░░░░ 7M / 10M tokens (70%)  │
│ Se reinicia: Diario 10:00 AM (en 5h 35m)   │
│ Costo hoy: $4.20                            │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ MiniMax M2.1 (minimax/)                     │
│ ████████████████░░░░ 4M / 5M tokens (80%)   │
│ Ventana rolling 5h                          │
│ Costo (5h): $0.80                           │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ iFlow (if/)                                 │
│ ████████████████████ Ilimitado              │
│ Costo: $0 (gratis para siempre)             │
└─────────────────────────────────────────────┘
```

---

## Consumo de tokens en tiempo real

### Seguimiento por solicitud

Cada solicitud muestra el uso detallado de tokens:

```
Dashboard → Activity → Recent Requests

Request #1234
Model: cc/claude-opus-4-5-20251101
Timestamp: 2026-02-04 04:15:32

Tokens:
  Input: 1,250 tokens
  Output: 850 tokens
  Total: 2,100 tokens

Cost: $0 (cuota de suscripción)
Duration: 3.2s
Status: ✅ Success
```

### Monitor de uso en vivo

```
Dashboard → Live Monitor

Solicitud actual:
  Model: glm/glm-4.7
  Tokens transmitidos: 450 / ~800 estimados
  Costo hasta ahora: $0.0009
  Duración: 1.8s
```

### Desglose de tokens por modelo

```
Dashboard → Analytics → Token Usage

Hoy (4 feb 2026):
  cc/claude-opus-4-5: 15M tokens ($0, suscripción)
  glm/glm-4.7: 8M tokens ($4.80)
  if/kimi-k2-thinking: 3M tokens ($0, gratis)
  
Total: 26M tokens
Costo: $4.80
```

---

## Límites de cuota y tiempos de reinicio

### Proveedores de suscripción

**Claude Code (Pro/Max)**
```
Tipo de cuota: Basado en tiempo (rolling 5 horas)
Límite: 5 horas de uso
Reinicio: Ventana rolling 5 horas + refresh semanal
Seguimiento: Tiempo de uso por modelo

El dashboard muestra:
  Opus: 2.5h / 5h usados
  Sonnet: 1.2h / 5h usados
  Haiku: 0.8h / 5h usados
  
Reinicio semanal: Todos los lunes 00:00 UTC
```

**OpenAI Codex (Plus/Pro)**
```
Tipo de cuota: Basado en tiempo (rolling 5 horas)
Límite: 5 horas (Plus) / 10 horas (Pro)
Reinicio: Ventana rolling 5 horas + refresh semanal

El dashboard muestra:
  GPT-5.2 Codex: 3.5h / 5h usados
  Se reinicia en: 1h 30m
```

**Gemini CLI (GRATIS)**
```
Tipo de cuota: Conteo de solicitudes + tokens mensuales
Límite diario: 1,000 solicitudes
Límite mensual: 180,000 completados
Reinicio: Diario 00:00 UTC + Mensual día 1

El dashboard muestra:
  Hoy: 450 / 1,000 solicitudes (45%)
  Este mes: 45K / 180K completados (25%)
  Reinicio diario en: 18h 30m
  Reinicio mensual en: 26 días
```

**GitHub Copilot**
```
Tipo de cuota: Uso mensual
Límite: Varía según el plan
Reinicio: 1ro de cada mes

El dashboard muestra:
  Uso: 60% de la cuota mensual
  Se reinicia: 1 mar 2026 (en 25 días)
```

### Proveedores baratos

**GLM-4.7**
```
Tipo de cuota: Límite diario de tokens
Límite: 10M tokens/día (Coding Plan)
Reinicio: Diario 10:00 AM hora de Beijing (UTC+8)

El dashboard muestra:
  Usados: 7M / 10M tokens (70%)
  Restantes: 3M tokens
  Se reinicia en: 5h 35m
  Costo hoy: $4.20
```

**MiniMax M2.1**
```
Tipo de cuota: Ventana rolling 5 horas
Límite: 5M tokens por 5 horas
Reinicio: Ventana rolling continua

El dashboard muestra:
  Usados (5h): 4M / 5M tokens (80%)
  El uso más antiguo expira en: 45m
  Costo (5h): $0.80
```

**Kimi K2**
```
Tipo de cuota: Suscripción mensual
Límite: 10M tokens/mes ($9 plano)
Reinicio: Mensual en la fecha de suscripción

El dashboard muestra:
  Usados: 6M / 10M tokens (60%)
  Se reinicia: 15 feb 2026 (en 11 días)
  Costo: $9/mes (pagado por adelantado)
```

### Proveedores gratis

**iFlow / Qwen / Kiro**
```
Tipo de cuota: Ilimitado (con rate-limit)
Límite: Sin límite duro
Reinicio: N/A

El dashboard muestra:
  Usados hoy: 5M tokens
  Costo: $0 (gratis para siempre)
  Estado: ✅ Disponible
```

---

## Estimación de costos

### Seguimiento de costos en tiempo real

```
Dashboard → Costs → Today

Proveedores de suscripción: $0
  Claude Code: 15M tokens ($0, incluido)
  Gemini CLI: 3M tokens ($0, nivel gratis)

Proveedores de pago: $4.80
  GLM-4.7: 8M tokens ($4.80)
    Input: 6M × $0.60/1M = $3.60
    Output: 2M × $2.20/1M = $4.40
    Total: $4.80

Proveedores gratis: $0
  iFlow: 3M tokens ($0)

Total hoy: $4.80
```

### Reporte de gasto mensual

```
Dashboard → Costs → This Month (Febrero 2026)

Semana 1 (1-7 feb):
  Suscripción: $0 (80M tokens)
  Pago: $15.20 (25M tokens)
  Gratis: $0 (10M tokens)
  Total: $15.20

Semana 2 (8-14 feb):
  Suscripción: $0 (75M tokens)
  Pago: $12.80 (20M tokens)
  Gratis: $0 (8M tokens)
  Total: $12.80

Mes hasta la fecha: $28.00
Proyectado (30 días): ~$120

Desglose por proveedor:
  GLM-4.7: $22.00 (78%)
  MiniMax M2.1: $6.00 (22%)
  
Costo promedio por 1M tokens: $0.62
Ahorros vs ChatGPT API: 97% ($4,000 → $120)
```

### Proyección de costos

```
Dashboard → Costs → Projections

Basado en uso de los últimos 7 días:
  Promedio diario: 50M tokens
  Costo diario: $4.50

Proyección mensual:
  Tokens: 1,500M (1.5B)
  Costo: $135
  
Desglose:
  Suscripción: 900M tokens ($0)
  GLM-4.7: 450M tokens ($90)
  MiniMax: 120M tokens ($24)
  Gratis: 30M tokens ($0)

Estado del presupuesto:
  Límite diario: $5 → 90% usado hoy
  Límite mensual: $150 → 90% proyectado
  ⚠️ Advertencia: Puede exceder el presupuesto mensual
```

---

## Dashboard de uso

### Estadísticas generales

```
Dashboard → Analytics → Overview

Hoy (4 feb 2026):
  Solicitudes: 1,234
  Tokens: 26M
  Costo: $4.80
  Tiempo promedio de respuesta: 2.1s

Esta semana:
  Solicitudes: 8,456
  Tokens: 180M
  Costo: $28.00
  Tasa de éxito: 99.2%

Este mes:
  Solicitudes: 15,234
  Tokens: 320M
  Costo: $52.00
  Modelo principal: cc/claude-opus-4-5 (45%)
```

### Uso por modelo

```
Dashboard → Analytics → Models

Modelos principales (este mes):
1. cc/claude-opus-4-5: 145M tokens (45%)
2. glm/glm-4.7: 95M tokens (30%)
3. if/kimi-k2-thinking: 50M tokens (16%)
4. minimax/MiniMax-M2.1: 20M tokens (6%)
5. gc/gemini-3-flash: 10M tokens (3%)

Desglose de costos:
  cc/claude-opus: $0 (suscripción)
  glm/glm-4.7: $45.00
  if/kimi-k2-thinking: $0 (gratis)
  minimax/MiniMax-M2.1: $7.00
  gc/gemini-3-flash: $0 (gratis)
```

### Uso por tiempo

```
Dashboard → Analytics → Timeline

Uso por hora (hoy):
00:00 - 01:00: 0.5M tokens
01:00 - 02:00: 0.2M tokens
...
08:00 - 09:00: 3.2M tokens (pico)
09:00 - 10:00: 2.8M tokens
...
23:00 - 00:00: 0.8M tokens

Horas pico: 08:00 - 12:00 (codificación matutina)
Horas bajas: 00:00 - 06:00 (noche)
```

### Uso por combo

```
Dashboard → Analytics → Combos

premium-coding:
  Solicitudes: 456
  Tokens: 12M
  Costo: $2.40
  
  Desglose:
    cc/claude-opus: 8M tokens (67%, $0)
    glm/glm-4.7: 3M tokens (25%, $1.80)
    minimax/MiniMax-M2.1: 1M tokens (8%, $0.20)

budget-combo:
  Solicitudes: 234
  Tokens: 6M
  Costo: $1.20
  
  Desglose:
    glm/glm-4.7: 4M tokens (67%, $2.40)
    if/kimi-k2-thinking: 2M tokens (33%, $0)
```

---

## Alertas y notificaciones

### Alertas de cuota

```
Dashboard → Settings → Alerts

Advertencias de cuota:
  ✅ Alerta al 80% de cuota usada
  ✅ Alerta al 90% de cuota usada
  ✅ Alerta cuando la cuota se agota
  ✅ Notificar cuando la cuota se reinicia

Entrega:
  ✅ Notificación del dashboard
  ✅ Email (opcional)
  ✅ Webhook (opcional)
```

**Ejemplo de notificaciones:**
```
⚠️ Cuota de Claude Code 80% usada
   2.5h restantes (se reinicia en 1h 30m)
   
⚠️ Cuota de GLM-4.7 90% usada
   1M tokens restantes (se reinicia en 5h)
   
✅ Cuota de Gemini CLI reiniciada
   1,000 solicitudes disponibles (límite diario)
```

### Alertas de presupuesto

```
Dashboard → Settings → Budget Alerts

Presupuesto diario: $5
  ✅ Alerta al 80% ($4)
  ✅ Alerta al 100% ($5)
  ✅ Cambio automático al nivel gratis cuando se excede

Presupuesto mensual: $150
  ✅ Alerta al 50% ($75)
  ✅ Alerta al 80% ($120)
  ✅ Alerta al 100% ($150)
```

**Ejemplo de notificaciones:**
```
⚠️ Presupuesto diario 80% usado
   $4.00 / $5.00 gastados hoy
   
⚠️ Presupuesto mensual 50% alcanzado
   $75 / $150 gastados este mes
   Proyectado: $135 (dentro del presupuesto)
   
🚨 Presupuesto diario excedido
   $5.20 / $5.00 gastados hoy
   Cambio automático al nivel gratis
```

### Detección de anomalías de costo

```
Dashboard → Settings → Anomaly Detection

✅ Detectar patrones de gasto inusuales
✅ Alerta en picos de costo (>2× promedio diario)
✅ Advertencia en patrones de agotamiento de cuota

Ejemplo de alerta:
⚠️ Pico de costo detectado
   Hoy: $12.50 (2.5× promedio diario)
   Razón: Alto uso de GLM-4.7 (20M tokens)
   Sugerencia: Verifica si los modelos principales tienen cuota agotada
```

---

## Mejores prácticas

### 1. Monitorea la cuota diariamente

```
Rutina diaria:
1. Revisa el resumen de cuota del dashboard (30 segundos)
2. Revisa los tiempos de reinicio
3. Planifica el uso según la disponibilidad de cuota
```

**Ejemplo:**
```
Revisión matutina:
  ✅ Claude Code: 5h disponibles (reinicio fresco)
  ✅ Gemini CLI: 1K solicitudes disponibles
  ⚠️ GLM-4.7: 2M tokens restantes (se reinicia 10AM)
  
Acción: Usar Claude Code para el trabajo matutino
```

### 2. Establece límites de presupuesto

```
Dashboard → Settings → Budget:
  Diario: $5 (previene gastos excesivos)
  Mensual: $150 (alinea con el presupuesto)
```

**Resultado**: Cambio automático al nivel gratis cuando se alcanza el límite.

### 3. Optimiza el uso de combos

```
Dashboard → Analytics → Combos:
  Revisa qué modelos se usan más
  Ajusta el orden del combo para minimizar costos
```

**Ejemplo:**
```
Actual: cc/claude-opus → glm/glm-4.7
  80% vía Claude (bueno)
  20% vía GLM ($12/mes)

Optimizado: gc/gemini-3-flash → cc/claude-opus → glm/glm-4.7
  50% vía Gemini (gratis)
  40% vía Claude (suscripción)
  10% vía GLM ($6/mes)
  
Ahorros: $6/mes
```

### 4. Rastrea los tiempos de reinicio

```
Dashboard → Quota → Reset Schedule:
  Claude Code: 5h rolling + Semanal lunes
  Gemini CLI: Diario 00:00 UTC + Mensual día 1
  GLM-4.7: Diario 10:00 AM hora Beijing
  MiniMax: Ventana rolling 5h
```

**Estrategia**: Usa proveedores cuando la cuota esté fresca.

### 5. Revisa los reportes mensuales

```
Dashboard → Analytics → Monthly Report:
  Total de tokens: 1.5B
  Costo total: $120
  Ahorros: 97% vs ChatGPT API
  
Insights:
  - 60% de uso vía suscripciones ($0)
  - 30% vía GLM ($90)
  - 10% vía nivel gratis ($0)
  
Optimización:
  - Aumentar el uso de Gemini CLI (gratis)
  - Reducir el uso de GLM (costoso)
```

---

## Acceso por API

### Obtener estado de cuota

```bash
GET http://localhost:20128/api/quota
Authorization: Bearer your-api-key

Response:
{
  "providers": [
    {
      "id": "cc",
      "name": "Claude Code",
      "quota": {
        "used": 2.5,
        "limit": 5,
        "unit": "hours",
        "percentage": 50
      },
      "reset": {
        "type": "rolling",
        "window": "5h",
        "nextReset": "2026-02-04T06:45:00Z"
      },
      "cost": {
        "today": 0,
        "month": 0,
        "currency": "USD"
      }
    },
    {
      "id": "glm",
      "name": "GLM-4.7",
      "quota": {
        "used": 7000000,
        "limit": 10000000,
        "unit": "tokens",
        "percentage": 70
      },
      "reset": {
        "type": "daily",
        "time": "10:00 AM UTC+8",
        "nextReset": "2026-02-04T10:00:00+08:00"
      },
      "cost": {
        "today": 4.20,
        "month": 52.00,
        "currency": "USD"
      }
    }
  ]
}
```

### Obtener estadísticas de uso

```bash
GET http://localhost:20128/api/usage?period=today
Authorization: Bearer your-api-key

Response:
{
  "period": "today",
  "date": "2026-02-04",
  "summary": {
    "requests": 1234,
    "tokens": 26000000,
    "cost": 4.80
  },
  "byModel": [
    {
      "model": "cc/claude-opus-4-5",
      "requests": 456,
      "tokens": 15000000,
      "cost": 0
    },
    {
      "model": "glm/glm-4.7",
      "requests": 234,
      "tokens": 8000000,
      "cost": 4.80
    }
  ]
}
```

---

## Solución de problemas

**Problema: La cuota muestra 0% pero las solicitudes fallan**

**Solución:**
1. Verifica la conexión del proveedor (Dashboard → Providers)
2. Verifica que las API keys sean válidas
3. Verifica si el proveedor está caído (página de estado)
4. Intenta reconectar los proveedores OAuth

**Problema: Estimación de costos incorrecta**

**Solución:**
1. Dashboard → Settings → Pricing
2. Verifica que el precio por proveedor coincida con las tarifas actuales
3. Actualiza el precio si el proveedor cambió las tarifas
4. Contacta a soporte si la discrepancia persiste

**Problema: El tiempo de reinicio no se actualiza**

**Solución:**
1. Refresca el dashboard (F5)
2. Verifica que la hora del sistema sea correcta
3. Verifica la configuración de zona horaria
4. Reinicia 9Router si el problema persiste

**Problema: No se reciben alertas**

**Solución:**
1. Dashboard → Settings → Alerts
2. Verifica que la dirección de email sea correcta
3. Revisa la carpeta de spam
4. Prueba la notificación (botón Send Test)

---

## Relacionado

- [Enrutamiento inteligente](./smart-routing.md) - Fallback automático según cuota
- [Combos](./combos.md) - Crea cadenas de fallback personalizadas
