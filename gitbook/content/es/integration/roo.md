# Integración con Roo AI Assistant

Integra 9Router con Roo AI Assistant para acceder a múltiples modelos de IA a través de una interfaz unificada.

## Requisitos previos

- Roo AI Assistant instalado
- API key de 9Router desde el [dashboard](https://9router.com/dashboard)
- 9Router ejecutándose (local o en la nube)

## Pasos de configuración

### 1. Abrir la configuración de Roo

Inicia Roo AI Assistant y abre el panel de configuración.

### 2. Configurar el proveedor de API

1. Navega a la configuración de **API Provider**
2. Selecciona **Ollama** como tipo de proveedor
3. Configura los siguientes ajustes:

**Para 9Router local:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
```

**Para 9Router en la nube:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
```

### 3. Seleccionar modelo

Elige entre los modelos disponibles de 9Router:

**Modelos Claude:**
- `cc/claude-opus-4-5-20251101` - El más capaz
- `cc/claude-sonnet-4-20250514` - Equilibrado
- `cc/claude-haiku-4-20250514` - Rápido

**Modelos DeepSeek:**
- `cx/deepseek-chat` - Propósito general
- `cx/deepseek-reasoner` - Razonamiento complejo

**Modelos GLM:**
- `glm/glm-4-plus` - Avanzado
- `glm/glm-4-flash` - Respuestas rápidas

### 4. Probar la conexión

Envía un mensaje de prueba para verificar la integración:

```
Hello! Can you confirm you're connected through 9Router?
```

## Ejemplos de uso

### Chat básico
```
Pregunta a Roo: "Explain quantum computing in simple terms"
Modelo: cc/claude-sonnet-4-20250514
```

### Generación de código
```
Pregunta a Roo: "Write a Python function to calculate Fibonacci numbers"
Modelo: cx/deepseek-chat
```

### Razonamiento complejo
```
Pregunta a Roo: "Analyze the trade-offs between microservices and monolithic architecture"
Modelo: cx/deepseek-reasoner
```

## Consejos de selección de modelo

- **Tareas rápidas**: Usa `cc/claude-haiku-4-20250514` o `glm/glm-4-flash`
- **Rendimiento equilibrado**: Usa `cc/claude-sonnet-4-20250514` o `cx/deepseek-chat`
- **Razonamiento complejo**: Usa `cc/claude-opus-4-5-20251101` o `cx/deepseek-reasoner`
- **Optimización de costos**: Usa modelos DeepSeek o GLM

## Solución de problemas

### Connection Failed
- Verifica que 9Router esté corriendo: `curl http://localhost:20128/health`
- Verifica que la API key sea correcta
- Asegúrate de que la Base URL incluya el sufijo `/v1`

### Modelo no disponible
- Verifica que el nombre del modelo coincida exactamente (sensible a mayúsculas)
- Verifica que el modelo esté habilitado en tu plan de 9Router
- Intenta otro modelo de la lista

### Respuestas lentas
- Cambia a modelos más rápidos (haiku, flash)
- Verifica la conexión de red
- Monitorea los logs de 9Router por problemas

## Configuración avanzada

### Aliases personalizados de modelos

Puedes crear atajos para modelos usados con frecuencia en la configuración de Roo:

```
Alias: "fast" → cc/claude-haiku-4-20250514
Alias: "smart" → cc/claude-opus-4-5-20251101
Alias: "code" → cx/deepseek-chat
```

### Múltiples perfiles

Configura diferentes perfiles para distintos casos de uso:
- **Desarrollo**: Modelos DeepSeek para código
- **Escritura**: Modelos Claude para contenido
- **Investigación**: Modelos reasoner para análisis

## Próximos pasos

- [Configurar Cursor](cursor.md) para integración con IDE
- [Configurar Continue](continue.md) para VSCode
- [Explorar uso de CLI](../cli/basic-usage.md)
