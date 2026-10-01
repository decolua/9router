# Integración con Cline

Integra 9Router con la extensión Cline de VSCode para enrutar tus solicitudes de IA a través del sistema de enrutamiento inteligente de 9Router.

## Requisitos previos

- Visual Studio Code instalado
- Extensión Cline instalada desde el marketplace de VSCode
- 9Router ejecutándose localmente o endpoint en la nube configurado
- API key del dashboard de 9Router

## Configuración

### 1. Abrir la configuración de Cline

1. Abre Visual Studio Code
2. Abre el panel de la extensión Cline (clic en el ícono de Cline en la barra lateral)
3. Clic en el ícono de **Settings** (engranaje) en el panel de Cline

### 2. Seleccionar el proveedor de API

1. En la configuración de Cline, encuentra el dropdown **API Provider**
2. Selecciona **Ollama** de la lista
   - Nota: Usamos el tipo de proveedor Ollama porque es compatible con APIs estilo OpenAI

### 3. Configurar Base URL

Establece la URL base a tu endpoint de 9Router:

**Para 9Router local:**
```
http://localhost:20128/v1
```

**Para 9Router en la nube:**
```
https://9router.com
```

**Pasos:**
1. En el campo **Base URL**, ingresa tu endpoint de 9Router
2. Asegúrate de incluir `/v1` al final

### 4. Agregar API Key

1. En el campo **API Key**, ingresa tu API key de 9Router
2. Puedes encontrar tu API key en el dashboard de 9Router en **Settings → API Keys**
3. La key debe comenzar con `sk-9router-`

### 5. Seleccionar modelo

1. En el dropdown **Model**, puedes:
   - Seleccionar de los modelos disponibles (si Cline los auto-detecta)
   - Ingresar manualmente el nombre del modelo desde tu configuración de 9Router

2. Nombres comunes de modelos:
   - `gpt-4`
   - `gpt-4o`
   - `claude-opus-4-5`
   - `claude-sonnet-4-5`
   - `gemini-2.0-flash`

### 6. Guardar la configuración

Clic en **Save** o cierra el panel de configuración. Cline guardará automáticamente tu configuración.

## Ejemplo de configuración

Tu configuración de Cline debería verse así:

```
API Provider: Ollama
Base URL: http://localhost:20128/v1
API Key: sk-9router-xxxxxxxxxxxxx
Model: gpt-4
```

## Modelos disponibles

Puedes usar cualquier modelo configurado en tu dashboard de 9Router. Ejemplos comunes:

| Nombre del modelo | Proveedor | Descripción |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Uso

### Chat con IA

1. Abre el panel de Cline en VSCode
2. Escribe tu mensaje en el input del chat
3. Presiona Enter para enviar
4. Cline usará 9Router para procesar tu solicitud

### Generación de código

1. Pide a Cline que genere código: "Create a React component for a login form"
2. Cline generará código usando 9Router
3. Revisa y acepta el código generado

### Explicación de código

1. Selecciona código en tu editor
2. Pregunta a Cline: "Explain this code"
3. Obtén explicaciones potenciadas por IA a través de 9Router

### Operaciones con archivos

1. Pide a Cline que cree, modifique o elimine archivos
2. Cline usará 9Router para entender el contexto y hacer cambios
3. Revisa los cambios antes de aceptar

## Solución de problemas

### Error "Connection Failed"

1. Verifica que 9Router esté corriendo: `curl http://localhost:20128/health`
2. Verifica que la URL base sea correcta e incluya `/v1`
3. Asegúrate de que ningún firewall esté bloqueando el puerto 20128
4. Intenta reiniciar VSCode

### Error "Invalid API Key"

1. Verifica tu API key en el dashboard de 9Router
2. Asegúrate de haber copiado la key completa incluyendo el prefijo `sk-9router-`
3. Verifica que la API key no haya expirado
4. Intenta regenerar una nueva API key

### Error "Model Not Found"

1. Verifica que el nombre del modelo coincida exactamente con tu configuración de 9Router
2. Verifica que la conexión del proveedor esté activa en el dashboard de 9Router
3. Asegúrate de que el modelo esté disponible en tus proveedores conectados
4. Intenta usar el nombre completo del modelo (ej. `openai/gpt-4` en lugar de `gpt-4`)

### Cline no responde

1. Revisa el panel de output de Cline para mensajes de error
2. Verifica que tu instancia de 9Router esté ejecutándose y saludable
3. Intenta recargar la ventana de VSCode (Cmd/Ctrl + Shift + P → "Reload Window")
4. Revisa los logs de 9Router para cualquier error

## Configuración avanzada

### Usar endpoint en la nube

Para usar el endpoint en la nube de 9Router en lugar de localhost:

1. En la configuración de Cline, establece Base URL a: `https://9router.com`
2. Asegúrate de haber configurado tu API key en el dashboard en la nube de 9Router
3. Asegúrate de que tu endpoint en la nube esté activo y accesible

### Múltiples modelos

Puedes cambiar rápidamente entre modelos:

1. Abre la configuración de Cline
2. Cambia el campo **Model** a otro modelo
3. Guarda y continúa chateando con el nuevo modelo

### Timeout personalizado

Si experimentas problemas de timeout con solicitudes grandes:

1. Abre la configuración de VSCode (Cmd/Ctrl + ,)
2. Busca "Cline timeout"
3. Aumenta el valor de timeout (por defecto suele ser 30 segundos)

## Mejores prácticas

1. **Usa modelos apropiados**: Elige modelos rápidos (como Haiku o Flash) para tareas simples, y modelos más potentes (como Opus o GPT-4) para tareas complejas
2. **Monitorea el uso**: Revisa el dashboard de 9Router para estadísticas de uso y costos
3. **Gestión de contexto**: Mantén tus conversaciones enfocadas para reducir el uso de tokens
4. **Cambio de modelo**: Cambia modelos según la complejidad de la tarea para optimizar costo y rendimiento
5. **Seguridad de API Key**: Nunca subas tu API key al control de versiones

## Integración con características de 9Router

### Enrutamiento de modelos

9Router enruta automáticamente tus solicitudes al mejor proveedor disponible según:
- Disponibilidad del modelo
- Estado de salud del proveedor
- Optimización de costos
- Balanceo de carga

### Soporte de fallback

Si un proveedor falla, 9Router automáticamente cambia a proveedores alternativos configurados en tu dashboard.

### Seguimiento de uso

Monitorea tu uso de Cline a través del dashboard de 9Router:
- Total de solicitudes
- Uso de tokens
- Costo por modelo
- Distribución por proveedor
