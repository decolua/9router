# Solución de problemas

Problemas comunes y soluciones al usar 9Router.

---

## "Language model did not provide messages"

**Problema:** La solicitud falla con una respuesta vacía o un mensaje de error.

**Causas:**
- Cuota del proveedor agotada
- API key inválida o expirada
- Modelo no disponible

**Soluciones:**

1. **Verifica el estado de la cuota:**
   ```
   Dashboard → Providers → Ver el rastreador de cuota
   ```
   Si la cuota está agotada, espera el reinicio o cambia de proveedor.

2. **Usa el fallback con combo:**
   ```
   Dashboard → Combos → Crea cadena de fallback
   Ejemplo: cc/claude-opus → glm/glm-4.7 → if/kimi-k2
   ```

3. **Verifica la conexión del proveedor:**
   ```
   Dashboard → Providers → Reconecta si es necesario
   ```

---

## Rate Limiting

**Problema:** Errores "Rate limit exceeded" o "Too many requests".

**Causas:**
- Cuota de suscripción agotada (límites de 5 horas/diario/semanal)
- Límites de tasa de API alcanzados
- Demasiadas solicitudes concurrentes

**Soluciones:**

1. **Verifica el tiempo de reinicio:**
   ```
   Dashboard → Quota Tracking → Ver cuenta regresiva
   ```

2. **Cambia al nivel barato:**
   ```
   Usa: glm/glm-4.7 ($0.6/1M tokens)
        minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Agrega un combo de fallback:**
   ```
   Dashboard → Combos → Agrega modelos de respaldo
   Principal: cc/claude-opus (suscripción)
   Respaldo: glm/glm-4.7 (barato)
   Emergencia: if/kimi-k2 (gratis)
   ```

---

## Token OAuth expirado

**Problema:** Errores "Unauthorized" o "Token expired".

**Causas:**
- Token OAuth expirado (refresh automático falló)
- Sesión del proveedor invalidada
- Problemas de red durante el refresh

**Soluciones:**

1. **Refresh automático (por defecto):**
   9Router refresca automáticamente los tokens. Espera 30 segundos y reintenta.

2. **Reconexión manual:**
   ```
   Dashboard → Providers → [Nombre del proveedor] → Reconnect
   → Completa el flujo OAuth de nuevo
   ```

3. **Verifica el estado del proveedor:**
   Verifica que el servicio del proveedor esté en línea (Claude Code, Codex, etc.)

---

## Costos altos

**Problema:** Uso o costos altos inesperados.

**Causas:**
- Uso de modelos costosos innecesariamente
- Sin fallback a niveles más baratos
- Ventanas de contexto grandes

**Soluciones:**

1. **Verifica las estadísticas de uso:**
   ```
   Dashboard → Usage Stats → Ver consumo de tokens
   → Identifica modelos de alto costo
   ```

2. **Cambia a modelos más baratos:**
   ```
   Reemplaza: cc/claude-opus (suscripción $20-100/mes)
   Con: glm/glm-4.7 ($0.6/1M tokens)
        minimax/MiniMax-M2.1 ($0.20/1M tokens)
   ```

3. **Usa el nivel gratis:**
   ```
   if/kimi-k2-thinking (GRATIS)
   qw/qwen3-coder-plus (GRATIS)
   kr/claude-sonnet-4.5 (GRATIS)
   gc/gemini-3-flash-preview (GRATIS 180K/mes)
   ```

4. **Optimiza los prompts:**
   - Reduce el tamaño del contexto
   - Usa streaming para respuestas largas
   - Cachea prompts comunes

---

## Connection Refused

**Problema:** "ECONNREFUSED" o "Cannot connect to localhost:20128".

**Causas:**
- 9Router no está ejecutándose
- Puerto 20128 bloqueado
- Firewall bloqueando la conexión

**Soluciones:**

1. **Inicia 9Router:**
   ```bash
   9router
   ```
   El dashboard debe abrir en http://localhost:3000

2. **Verifica el puerto 20128:**
   ```bash
   # Verifica si el puerto está escuchando
   lsof -i :20128
   
   # O en Windows
   netstat -ano | findstr :20128
   ```

3. **Revisa el firewall:**
   - macOS: System Settings → Network → Firewall
   - Windows: Windows Defender Firewall → Allow app
   - Linux: `sudo ufw allow 20128`

4. **Usa el endpoint en la nube:**
   Si localhost no funciona (ej. Cursor IDE):
   ```
   Endpoint: https://9router.com/v1
   ```

---

## El dashboard no abre

**Problema:** El dashboard no carga en http://localhost:3000.

**Causas:**
- Puerto 3000 ya en uso
- 9Router crasheó
- Problemas de caché del navegador

**Soluciones:**

1. **Verifica si 9Router está ejecutándose:**
   ```bash
   # Verifica el proceso
   ps aux | grep 9router
   
   # Verifica el puerto 3000
   lsof -i :3000
   ```

2. **Mata el proceso en conflicto:**
   ```bash
   # macOS/Linux
   lsof -ti:3000 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

3. **Reinicia 9Router:**
   ```bash
   # Detener
   pkill -f 9router
   
   # Iniciar
   9router
   ```

4. **Limpia la caché del navegador:**
   - Chrome: Ctrl+Shift+Delete → Limpiar caché
   - Prueba en modo incógnito

5. **Verifica la configuración del firewall:**
   Asegúrate de que el puerto 3000 no esté bloqueado.

---

## Modelo no encontrado

**Problema:** Errores "Model not found" o "Invalid model".

**Causas:**
- Proveedor no conectado
- Error tipográfico en el ID del modelo
- Proveedor inactivo

**Soluciones:**

1. **Verifica la conexión del proveedor:**
   ```
   Dashboard → Providers → Verifica estado (verde = activo)
   ```

2. **Revisa el formato del ID del modelo:**
   ```
   Correcto: cc/claude-opus-4-5-20251101
   Incorrecto: claude-opus-4-5-20251101
   
   Formato: [prefijo-proveedor]/[nombre-modelo]
   ```

3. **Lista los modelos disponibles:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer your-api-key"
   ```

4. **Reconecta el proveedor:**
   ```
   Dashboard → Providers → [Proveedor] → Reconnect
   ```

---

## Respuesta lenta

**Problema:** Las solicitudes tardan demasiado o hacen timeout.

**Causas:**
- Latencia del proveedor
- Problemas de red
- Contexto/respuesta grande
- Rate limiting del proveedor

**Soluciones:**

1. **Verifica el estado del proveedor:**
   ```
   Dashboard → Providers → Ver estadísticas de latencia
   ```

2. **Cambia a un modelo más rápido:**
   ```
   Rápidos: cc/claude-haiku-4-5 (Haiku es más rápido que Opus)
         gc/gemini-3-flash-preview
         qw/qwen3-coder-flash
   ```

3. **Usa streaming:**
   ```json
   {
     "model": "cc/claude-opus-4-5",
     "messages": [...],
     "stream": true
   }
   ```

4. **Verifica la red:**
   ```bash
   # Prueba la latencia
   ping api.anthropic.com
   ping api.openai.com
   ```

5. **Reduce el tamaño del contexto:**
   - Recorta el historial de mensajes
   - Usa prompts más pequeños
   - Habilita el pruning de contexto en la herramienta CLI

---

## API Key inválida

**Problema:** Errores "Invalid API key" o "Authentication failed".

**Causas:**
- API key incorrecta copiada
- API key expirada
- API key no generada

**Soluciones:**

1. **Regenera la API key:**
   ```
   Dashboard → Settings → API Keys → Generate New Key
   → Copia y usa la nueva key
   ```

2. **Verifica el formato de la key:**
   ```
   Correcto: 9r_xxxxxxxxxxxxxxxxxxxxxxxx
   Incorrecto: Falta el prefijo 9r_
   ```

3. **Verifica la key en la configuración del CLI:**
   ```bash
   # Cursor
   Settings → Models → OpenAI API Key
   
   # Cline
   Settings → API Key
   
   # Variable de entorno
   export OPENAI_API_KEY="9r_your_key"
   ```

4. **Prueba la API key:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer 9r_your_key"
   ```

---

## ¿Necesitas más ayuda?

- **GitHub Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **Documentación:** [9router.com/docs](https://9router.com/docs)
- **FAQ:** [faq.md](faq.md)
