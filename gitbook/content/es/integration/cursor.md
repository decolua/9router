# Integración con Cursor

Integra 9Router con Cursor IDE para enrutar tus solicitudes de IA a través del sistema de enrutamiento inteligente de 9Router.

## Requisitos previos

- Cursor IDE instalado
- Cuenta Cursor Pro (requerida para endpoints de API personalizados)
- Endpoint en la nube de 9Router configurado
- API key del dashboard de 9Router

## ⚠️ Notas importantes

> **Endpoint en la nube requerido**: Cursor enruta solicitudes a través de su propio servidor y no soporta endpoints localhost. Debes usar el endpoint en la nube de 9Router: `https://9router.com`

> **Cursor Pro requerido**: Esta característica requiere una cuenta Cursor Pro para usar endpoints de API personalizados.

## Configuración

### 1. Abrir la configuración de Cursor

1. Abre Cursor IDE
2. Ve a **Settings** (Cmd/Ctrl + ,)
3. Navega a la sección **Models**

### 2. Habilitar OpenAI API

1. Encuentra la opción **OpenAI API key**
2. Activa el toggle para habilitar la configuración de API personalizada

### 3. Configurar Base URL

Establece la URL base al endpoint en la nube de 9Router:

```
https://9router.com
```

**Pasos:**
1. En la configuración de Models, localiza el campo **Base URL**
2. Ingresa: `https://9router.com`
3. Clic en **Save**

### 4. Agregar API Key

1. En el campo **API Key**, ingresa tu API key de 9Router
2. Puedes encontrar tu API key en el dashboard de 9Router en **Settings → API Keys**
3. Clic en **Save**

### 5. Agregar modelo personalizado

1. Clic en el botón **View All Models**
2. Clic en **Add Custom Model**
3. Ingresa el nombre del modelo desde tu configuración de 9Router (ej. `gpt-4`, `claude-opus-4-5`, etc.)
4. Clic en **Add**

### 6. Seleccionar modelo

1. En la interfaz de chat de Cursor, clic en el dropdown selector de modelo
2. Elige tu modelo personalizado de la lista
3. ¡Empieza a usar 9Router con Cursor!

## Ejemplo de configuración

Tu configuración de Cursor debería verse así:

```
OpenAI API: ✓ Enabled
Base URL: https://9router.com
API Key: sk-9router-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
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

### Interfaz de chat

1. Abre el chat de Cursor (Cmd/Ctrl + L)
2. Selecciona tu modelo del dropdown
3. Comienza a chatear con IA a través de 9Router

### Generación de código inline

1. Selecciona código en tu editor
2. Presiona Cmd/Ctrl + K
3. Ingresa tu prompt
4. Cursor usará 9Router para generar código

### Explicación de código

1. Selecciona código en tu editor
2. Presiona Cmd/Ctrl + L
3. Pregunta "Explain this code"
4. Obtén explicaciones potenciadas por IA a través de 9Router

## Solución de problemas

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

### Problemas de conexión

1. Verifica que estés usando el endpoint en la nube: `https://9router.com`
2. Verifica tu conexión a internet
3. Asegúrate de que el servicio en la nube de 9Router esté operativo
4. Intenta deshabilitar VPN o proxy si está habilitado

### Localhost no funciona

> **Recuerda**: Cursor no soporta endpoints localhost. Debes usar el endpoint en la nube `https://9router.com`. Si necesitas usar una instancia local de 9Router, considera usar un servicio de tunneling como ngrok para exponer tu endpoint local.

## Configuración del endpoint en la nube

Si estás ejecutando 9Router localmente y quieres usarlo con Cursor:

1. Habilita el endpoint en la nube en la configuración de 9Router
2. Configura tu URL del endpoint en la nube en el dashboard de 9Router
3. Usa la URL en la nube en la configuración de Cursor
4. Asegúrate de que tu instancia local de 9Router sea accesible desde internet

## Mejores prácticas

1. **Usa aliases de modelos**: Crea aliases cortos para modelos usados con frecuencia en 9Router
2. **Monitorea el uso**: Revisa el dashboard de 9Router para estadísticas de uso y costos
3. **Rota las API Keys**: Rota tus API keys regularmente por seguridad
4. **Prueba modelos**: Prueba diferentes modelos para encontrar el mejor para tu caso de uso
