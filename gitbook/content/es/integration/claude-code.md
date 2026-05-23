# Integración con Claude Code

Integra 9Router con Claude Code CLI para enrutar tus solicitudes de la API de Anthropic a través del sistema de enrutamiento inteligente de 9Router.

## Requisitos previos

- Claude Code CLI instalado
- 9Router ejecutándose localmente o endpoint en la nube configurado
- API key del dashboard de 9Router

## Configuración

### 1. Configurar variables de entorno

Establece las siguientes variables de entorno en tu archivo de configuración del shell (`~/.bashrc`, `~/.zshrc`, o `~/.bash_profile`):

```bash
# Base URL for 9Router
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"

# Optional: Set default models for aliases
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-4-5-20251101"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-4-5-20250929"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Recargar la configuración del shell

```bash
source ~/.zshrc  # o ~/.bashrc
```

### 3. Verificar la configuración

Verifica que las variables de entorno estén configuradas correctamente:

```bash
echo $ANTHROPIC_BASE_URL
```

## Aliases de modelos

Claude Code soporta los siguientes aliases de modelos que mapean a modelos de 9Router:

| Alias | Modelo | Variable de entorno |
|-------|-------|---------------------|
| `opus` | Claude Opus 4.5 | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | Claude Sonnet 4.5 | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | Claude Haiku 4.5 | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

## Ejemplos de uso

### Usando aliases de modelos

```bash
# Usar modelo Opus
claude --model opus "Explain quantum computing"

# Usar modelo Sonnet
claude --model sonnet "Write a Python function"

# Usar modelo Haiku
claude --model haiku "Quick code review"
```

### Usando nombres completos de modelos

```bash
claude --model cc/claude-opus-4-5-20251101 "Your prompt here"
```

## Archivo de configuración

Claude Code almacena su configuración en `~/.claude/settings.json`. Puedes editar este archivo manualmente si es necesario:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "defaultModel": "sonnet"
}
```

## Solución de problemas

### Problemas de conexión

Si encuentras errores de conexión:

1. Verifica que 9Router esté corriendo: `curl http://localhost:20128/health`
2. Verifica que las variables de entorno estén configuradas correctamente
3. Asegúrate de que ningún firewall esté bloqueando el puerto 20128

### Modelo no encontrado

Si obtienes errores de "modelo no encontrado":

1. Verifica que el nombre del modelo coincida con tu configuración de 9Router
2. Verifica que la conexión del proveedor esté activa en el dashboard de 9Router
3. Asegúrate de que el modelo esté disponible en tus proveedores conectados

## Endpoint en la nube

Para usar el endpoint en la nube de 9Router en lugar de localhost:

```bash
export ANTHROPIC_BASE_URL="https://9router.com"
```

Asegúrate de haber configurado tu API key en el dashboard en la nube de 9Router.
