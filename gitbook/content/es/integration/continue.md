# Integración con la extensión Continue de VSCode

Integra 9Router con la extensión Continue para llevar la asistencia de IA directamente a Visual Studio Code.

## Requisitos previos

- Visual Studio Code instalado
- Extensión Continue instalada desde el marketplace de VSCode
- API key de 9Router desde el [dashboard](https://9router.com/dashboard)
- 9Router ejecutándose (local o en la nube)

## Pasos de configuración

### 1. Abrir la configuración de Continue

1. Abre VSCode
2. Presiona `Cmd+Shift+P` (Mac) o `Ctrl+Shift+P` (Windows/Linux)
3. Escribe "Continue: Open Config" y selecciónalo
4. Esto abre `~/.continue/config.json`

### 2. Agregar configuración de modelo de 9Router

Agrega la siguiente configuración a tu `config.json`:

**Configuración de un solo modelo:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Configuración de múltiples modelos:**
```json
{
  "models": [
    {
      "title": "9Router - Claude Opus (Best)",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Sonnet (Balanced)",
      "provider": "openai",
      "model": "cc/claude-sonnet-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - DeepSeek Chat (Code)",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "9Router - Claude Haiku (Fast)",
      "provider": "openai",
      "model": "cc/claude-haiku-4-20250514",
      "apiKey": "your-api-key-from-dashboard",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

**Para 9Router en la nube:**
Reemplaza `apiBase` con:
```json
"apiBase": "https://9router.com/v1"
```

### 3. Guardar y recargar

1. Guarda el archivo de configuración
2. Recarga la ventana de VSCode: `Cmd+Shift+P` → "Developer: Reload Window"
3. La extensión Continue cargará la nueva configuración

### 4. Seleccionar modelo

1. Abre la barra lateral de Continue (clic en el ícono de Continue en el panel izquierdo)
2. Clic en el dropdown selector de modelo en la parte superior
3. Elige tu modelo preferido de 9Router

## Modelos disponibles

### Modelos Claude (Anthropic)
- `cc/claude-opus-4-5-20251101` - El más capaz, ideal para tareas complejas
- `cc/claude-sonnet-4-20250514` - Rendimiento y velocidad equilibrados
- `cc/claude-haiku-4-20250514` - El más rápido, bueno para tareas simples

### Modelos DeepSeek
- `cx/deepseek-chat` - Excelente para generación de código
- `cx/deepseek-reasoner` - Mejor para resolución de problemas complejos

### Modelos GLM (Zhipu AI)
- `glm/glm-4-plus` - Chino e inglés avanzado
- `glm/glm-4-flash` - Respuestas rápidas

## Ejemplos de uso

### Explicación de código
1. Selecciona código en el editor
2. Abre la barra lateral de Continue
3. Escribe: "Explain this code"
4. Modelo: `cc/claude-sonnet-4-20250514`

### Generación de código
1. Abre la barra lateral de Continue
2. Escribe: "Create a React component for user profile card"
3. Modelo: `cx/deepseek-chat`

### Refactorización
1. Selecciona código para refactorizar
2. Escribe: "Refactor this to use async/await"
3. Modelo: `cc/claude-sonnet-4-20250514`

### Corrección de bugs
1. Selecciona código problemático
2. Escribe: "Find and fix the bug in this code"
3. Modelo: `cx/deepseek-reasoner`

## Configuración avanzada

### Prompts de sistema personalizados

Agrega prompts de sistema personalizados para comportamientos específicos:

```json
{
  "models": [
    {
      "title": "9Router - Code Expert",
      "provider": "openai",
      "model": "cx/deepseek-chat",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "systemMessage": "You are an expert programmer. Always provide clean, well-documented code with best practices."
    }
  ]
}
```

### Temperatura y parámetros

Ajusta el comportamiento del modelo con parámetros:

```json
{
  "models": [
    {
      "title": "9Router - Creative Writer",
      "provider": "openai",
      "model": "cc/claude-opus-4-5-20251101",
      "apiKey": "your-api-key",
      "apiBase": "http://localhost:20128/v1",
      "temperature": 0.9,
      "topP": 0.95
    }
  ]
}
```

### Proveedores de contexto

Configura qué contexto envía Continue al modelo:

```json
{
  "contextProviders": [
    {
      "name": "code",
      "params": {
        "maxLines": 100
      }
    },
    {
      "name": "diff",
      "params": {}
    },
    {
      "name": "terminal",
      "params": {}
    }
  ]
}
```

## Atajos de teclado

- `Cmd+L` (Mac) / `Ctrl+L` (Windows/Linux) - Abrir chat de Continue
- `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux) - Edición inline
- `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux) - Regenerar respuesta

## Solución de problemas

### El modelo no responde
- Verifica que 9Router esté corriendo: `curl http://localhost:20128/health`
- Verifica la API key en config.json
- Revisa la consola de desarrollador de VSCode por errores: `Help` → `Toggle Developer Tools`

### Modelo incorrecto seleccionado
- Clic en el dropdown de modelo en la barra lateral de Continue
- Selecciona el modelo correcto de 9Router
- El nombre del modelo debe coincidir exactamente (sensible a mayúsculas)

### La configuración no se carga
- Verifica que la sintaxis JSON sea válida (usa un validador de JSON)
- Verifica la ubicación del archivo: `~/.continue/config.json`
- Recarga la ventana de VSCode después de cambios

### Rendimiento lento
- Cambia a modelos más rápidos (haiku, flash)
- Reduce el tamaño del contexto en contextProviders
- Verifica la latencia de red hacia 9Router

## Mejores prácticas

### Estrategia de selección de modelo
- **Ediciones rápidas**: Usa `cc/claude-haiku-4-20250514`
- **Generación de código**: Usa `cx/deepseek-chat`
- **Refactoring complejo**: Usa `cc/claude-opus-4-5-20251101`
- **Resolución de problemas**: Usa `cx/deepseek-reasoner`

### Gestión de contexto
- Selecciona solo el código relevante antes de preguntar
- Usa prompts específicos y claros
- Divide tareas complejas en pasos más pequeños

### Optimización de costos
- Usa modelos más rápidos/baratos para tareas simples
- Limita el tamaño del contexto cuando sea posible
- Cachea respuestas usadas con frecuencia

## Próximos pasos

- [Configurar Cursor](cursor.md) para integración mejorada con IDE
- [Configurar Roo](roo.md) para asistente de IA
- [Explorar uso de CLI](../cli/basic-usage.md)
- [Aprende sobre la selección de modelos](../models/overview.md)
