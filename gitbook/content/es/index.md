# Bienvenido a 9Router

**Usa Claude, Codex, Gemini GRATIS • Alternativas ultra-baratas desde $0.20/1M tokens**

9Router es un router de modelos de IA que maximiza el valor de tus suscripciones y minimiza los costos mediante enrutamiento inteligente y fallback automático.

---

## ¿Qué es 9Router?

9Router es un proxy inteligente que se sitúa entre tus herramientas de codificación (Cursor, Cline, Claude Desktop) y los proveedores de IA. Enruta automáticamente las solicitudes al mejor modelo disponible según la cuota, el costo y la disponibilidad.

**Deja de desperdiciar dinero:**
- ❌ La cuota de suscripción expira sin usar cada mes
- ❌ Los límites de tasa te detienen a mitad de la codificación
- ❌ APIs costosas ($20-50/mes por proveedor)
- ❌ Cambio manual entre proveedores

**Empieza a maximizar el valor:**
- ✅ **Maximiza tus suscripciones** - Rastrea y usa cada bit de cuota de Claude Code, Codex, Gemini
- ✅ **GRATIS disponible** - Accede a modelos iFlow, Qwen, Kiro vía CLI
- ✅ **Respaldo ultra-barato** - GLM ($0.6/1M), MiniMax M2.1 ($0.20/1M)
- ✅ **Fallback inteligente** - Suscripción → Barato → Gratis, cambio automático

---

## Características clave

### 🔄 Fallback inteligente de 3 niveles

```
Configura una vez, nunca dejes de codificar:

Nivel 1 (SUSCRIPCIÓN): Claude Code → Codex → Gemini
  ↓ cuota agotada
Nivel 2 (BARATO): GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ límite de presupuesto
Nivel 3 (GRATIS): iFlow → Qwen → Kiro

→ Cambio automático, sin tiempo de inactividad!
```

### 📊 Seguimiento de cuota

- Consumo de tokens en tiempo real por proveedor
- Cuenta regresiva de reinicio (5 horas, diario, semanal, mensual)
- Estimación de costos para niveles de pago
- Reportes de gasto mensual

### 🎯 Soporte universal de CLI

Funciona con cualquier herramienta que soporte endpoints personalizados de OpenAI:

✅ **Cursor** • **Cline** • **Claude Desktop** • **Codex** • **RooCode** • **Continue** • **Cualquier herramienta compatible con OpenAI**

### 💰 Optimización de costos

**Ejemplo real (100M tokens/mes):**
```
60M vía Gemini CLI: $0 (nivel gratis)
30M vía Claude Code: $0 (suscripción que ya tienes)
8M vía GLM: $4.80
2M vía MiniMax: $0.40
Total: $5.20/mes vs $2000 en ChatGPT API!
```

---

## ¿Por qué elegir 9Router?

### Maximiza tus suscripciones

¿Ya pagas Claude Code ($20-100/mes) o Codex ($20-200/mes)? Obtén el valor completo:

- Rastrea el uso de cuota en tiempo real
- Cambio automático cuando se reinicia la cuota (5 horas, semanal)
- Usa cada token antes de que expire
- Gemini CLI: 180K completados/mes **GRATIS**

### Respaldo ultra-barato

Cuando se agota la cuota de suscripción, paga centavos:

| Proveedor | Costo por 1M tokens | Reinicio |
|----------|-------------------|-------|
| **GLM-4.7** | $0.60 entrada / $2.20 salida | Diario 10:00 AM |
| **MiniMax M2.1** | $0.20 entrada / $1.00 salida | 5 horas rolling |
| **Kimi K2** | $9/mes (10M tokens) | Mensual |

**~90% más barato que ChatGPT API ($20/1M)!**

### Fallback gratis para siempre

Respaldo de emergencia cuando todo lo demás está limitado por cuota:

- **iFlow**: 8 modelos (Kimi K2, Qwen3 Coder Plus, GLM 4.7, MiniMax M2)
- **Qwen**: 3 modelos (Qwen3 Coder Plus/Flash, Vision)
- **Kiro**: Claude Sonnet 4.5, Haiku 4.5 (AWS Builder ID)

---

## Inicio rápido

Comienza en 2 minutos:

```bash
# Instala globalmente
npm install -g 9router

# Inicia (el dashboard se abre automáticamente)
9router
```

🎉 **Se abre el dashboard** → Conecta proveedores → ¡Empieza a codificar!

**Úsalo en tu herramienta CLI:**

```
Endpoint: http://localhost:20128/v1
API Key: [desde el dashboard]
Model: cc/claude-opus-4-5-20251101
```

[→ Guía completa para empezar](getting-started.md)

---

## Casos de uso

### Para desarrolladores individuales

- Maximiza tu suscripción de Claude Code/Codex
- Usa el nivel gratis de Gemini CLI (180K/mes)
- Fallback a modelos ultra-baratos ($0.20/1M)
- Codifica 24/7 sin límites de tasa

### Para equipos

- Despliega en VPS/Cloud para acceso compartido
- Rastrea el gasto del equipo en tiempo real
- Establece límites de presupuesto por nivel
- Gestión centralizada de proveedores

### Para codificación móvil/remota

- Usa el despliegue en la nube (https://9router.com)
- Accede desde iPad, teléfono, donde sea
- Sin limitaciones de localhost
- Red edge de Cloudflare (300+ ubicaciones)

---

## ¿Qué sigue?

- [Empezar](getting-started.md) - Instala y configura en 5 minutos
- [Guía de instalación](getting-started/installation.md) - Instrucciones detalladas
- [Características](features/) - Explora todas las capacidades
- [FAQ](faq.md) - Preguntas comunes

---

<div align="center">
  <sub>Construido con ❤️ para desarrolladores que maximizan el valor de la IA</sub>
</div>
