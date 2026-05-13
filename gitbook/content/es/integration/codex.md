# Integración con OpenAI Codex CLI

Integra 9Router con OpenAI Codex CLI para enrutar tus solicitudes de la API de OpenAI a través del sistema de enrutamiento inteligente de 9Router.

## Requisitos previos

- OpenAI Codex CLI instalado
- 9Router ejecutándose localmente o endpoint en la nube configurado
- API key del dashboard de 9Router

## Configuración

### 1. Configurar variables de entorno

Establece las siguientes variables de entorno en tu archivo de configuración del shell (`~/.bashrc`, `~/.zshrc`, o `~/.bash_profile`):

```bash
# Base URL for 9Router
export OPENAI_BASE_URL="http://localhost:20128/v1"

# API Key from 9Router dashboard
export OPENAI_API_KEY="your-9router-api-key"
```

### 2. Recargar la configuración del shell

```bash
source ~/.zshrc  # o ~/.bashrc
```

### 3. Verificar la configuración

Verifica que las variables de entorno estén configuradas correctamente:

```bash
echo $OPENAI_BASE_URL
echo $OPENAI_API_KEY
```

## Modelos disponibles

9Router proporciona los siguientes modelos de Codex:

| ID del modelo | Descripción |
|----------|-------------|
| `cx/gpt-5.2-codex` | GPT-5.2 Codex - Última versión |
| `cx/gpt-5.1-codex-max` | GPT-5.1 Codex Max - Contexto extendido |

## Ejemplos de uso

### Uso básico

```bash
# Usar GPT-5.2 Codex
codex --model cx/gpt-5.2-codex "Write a function to sort an array"

# Usar GPT-5.1 Codex Max
codex --model cx/gpt-5.1-codex-max "Explain this complex algorithm"
```

### Generación de código

```bash
codex --model cx/gpt-5.2-codex "Create a REST API endpoint for user authentication"
```

### Explicación de código

```bash
codex --model cx/gpt-5.1-codex-max "Explain what this code does: $(cat myfile.js)"
```

## Archivo de configuración

También puedes configurar Codex CLI usando un archivo de configuración. Crea o edita `~/.codex/config.json`:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "apiKey": "your-9router-api-key",
  "defaultModel": "cx/gpt-5.2-codex"
}
```

## Solución de problemas

### Errores de autenticación

Si encuentras errores de autenticación:

1. Verifica que tu API key sea correcta en el dashboard de 9Router
2. Verifica que la variable de entorno `OPENAI_API_KEY` esté configurada
3. Asegúrate de que la API key no haya expirado

### Problemas de conexión

Si encuentras errores de conexión:

1. Verifica que 9Router esté corriendo: `curl http://localhost:20128/health`
2. Verifica que las variables de entorno estén configuradas correctamente
3. Asegúrate de que ningún firewall esté bloqueando el puerto 20128

### Modelo no disponible

Si obtienes errores de "modelo no disponible":

1. Verifica que el nombre del modelo coincida con tu configuración de 9Router
2. Verifica que la conexión del proveedor de OpenAI esté activa en el dashboard de 9Router
3. Asegúrate de que el modelo esté disponible en tus proveedores conectados

## Endpoint en la nube

Para usar el endpoint en la nube de 9Router en lugar de localhost:

```bash
export OPENAI_BASE_URL="https://9router.com"
```

Asegúrate de haber configurado tu API key en el dashboard en la nube de 9Router.

## Configuración avanzada

### Timeout personalizado

```bash
export OPENAI_TIMEOUT=60  # segundos
```

### Modo debug

Habilita el modo debug para ver logs detallados de request/response:

```bash
export CODEX_DEBUG=true
codex --model cx/gpt-5.2-codex "Your prompt"
```
