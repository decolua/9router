# Integración con otras herramientas

9Router es compatible con cualquier herramienta que soporte el formato de API de OpenAI. Esta guía cubre patrones de integración genéricos para varias herramientas y aplicaciones personalizadas.

## Resumen

9Router proporciona un endpoint de API compatible con OpenAI que funciona con:
- Scripts y aplicaciones personalizadas
- Clientes de API y herramientas de testing
- Herramientas CLI y utilidades
- Integraciones de terceros
- Frameworks de desarrollo

## Patrón de configuración genérico

Cualquier herramienta compatible con OpenAI puede conectarse a 9Router usando estas configuraciones:

**9Router local:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
Model: cualquier modelo de 9Router (cc/*, cx/*, glm/*, etc.)
```

**9Router en la nube:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
Model: cualquier modelo de 9Router (cc/*, cx/*, glm/*, etc.)
```

## Modelos disponibles

### Modelos Claude (Anthropic)
- `cc/claude-opus-4-5-20251101`
- `cc/claude-sonnet-4-20250514`
- `cc/claude-haiku-4-20250514`

### Modelos DeepSeek
- `cx/deepseek-chat`
- `cx/deepseek-reasoner`

### Modelos GLM (Zhipu AI)
- `glm/glm-4-plus`
- `glm/glm-4-flash`

## Ejemplos de integración

### Python con OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key-from-dashboard",
    base_url="http://localhost:20128/v1"
)

response = client.chat.completions.create(
    model="cc/claude-sonnet-4-20250514",
    messages=[
        {"role": "user", "content": "Hello, how are you?"}
    ]
)

print(response.choices[0].message.content)
```

### Node.js con OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "your-api-key-from-dashboard",
  baseURL: "http://localhost:20128/v1"
});

const response = await client.chat.completions.create({
  model: "cc/claude-sonnet-4-20250514",
  messages: [
    { role: "user", content: "Hello, how are you?" }
  ]
});

console.log(response.choices[0].message.content);
```

### Comando cURL

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key-from-dashboard" \
  -d '{
    "model": "cc/claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### Cliente HTTP (Postman, Insomnia)

**Solicitud:**
```
POST http://localhost:20128/v1/chat/completions
```

**Headers:**
```
Content-Type: application/json
Authorization: Bearer your-api-key-from-dashboard
```

**Body:**
```json
{
  "model": "cc/claude-sonnet-4-20250514",
  "messages": [
    {"role": "user", "content": "Hello, how are you?"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### Integración con LangChain

```python
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage

llm = ChatOpenAI(
    model_name="cc/claude-sonnet-4-20250514",
    openai_api_key="your-api-key-from-dashboard",
    openai_api_base="http://localhost:20128/v1",
    temperature=0.7
)

messages = [HumanMessage(content="Explain quantum computing")]
response = llm(messages)
print(response.content)
```

### Integración con LlamaIndex

```python
from llama_index.llms import OpenAI

llm = OpenAI(
    model="cc/claude-sonnet-4-20250514",
    api_key="your-api-key-from-dashboard",
    api_base="http://localhost:20128/v1"
)

response = llm.complete("What is machine learning?")
print(response.text)
```

## Ejemplos de scripts personalizados

### Script de procesamiento por lotes

```python
import openai
import json

openai.api_key = "your-api-key-from-dashboard"
openai.api_base = "http://localhost:20128/v1"

def process_batch(prompts, model="cx/deepseek-chat"):
    results = []
    for prompt in prompts:
        response = openai.ChatCompletion.create(
            model=model,
            messages=[{"role": "user", "content": prompt}]
        )
        results.append({
            "prompt": prompt,
            "response": response.choices[0].message.content
        })
    return results

prompts = [
    "Explain AI in one sentence",
    "What is machine learning?",
    "Define neural networks"
]

results = process_batch(prompts)
print(json.dumps(results, indent=2))
```

### Manejador de respuestas streaming

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "your-api-key-from-dashboard",
  baseURL: "http://localhost:20128/v1"
});

async function streamResponse(prompt) {
  const stream = await client.chat.completions.create({
    model: "cc/claude-sonnet-4-20250514",
    messages: [{ role: "user", content: prompt }],
    stream: true
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    process.stdout.write(content);
  }
}

streamResponse("Write a short story about AI");
```

### Comparación multi-modelo

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key-from-dashboard",
    base_url="http://localhost:20128/v1"
)

models = [
    "cc/claude-sonnet-4-20250514",
    "cx/deepseek-chat",
    "glm/glm-4-plus"
]

prompt = "Explain quantum computing in simple terms"

for model in models:
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}]
    )
    print(f"\n=== {model} ===")
    print(response.choices[0].message.content)
```

## Patrones comunes de integración

### Variables de entorno

Almacena credenciales de forma segura:

```bash
# .env file
ROUTER_API_KEY=your-api-key-from-dashboard
ROUTER_BASE_URL=http://localhost:20128/v1
ROUTER_MODEL=cc/claude-sonnet-4-20250514
```

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("ROUTER_API_KEY"),
    base_url=os.getenv("ROUTER_BASE_URL")
)
```

### Manejo de errores

```python
from openai import OpenAI, OpenAIError

client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:20128/v1"
)

try:
    response = client.chat.completions.create(
        model="cc/claude-sonnet-4-20250514",
        messages=[{"role": "user", "content": "Hello"}]
    )
    print(response.choices[0].message.content)
except OpenAIError as e:
    print(f"Error: {e}")
```

### Lógica de reintentos

```python
import time
from openai import OpenAI, RateLimitError

client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:20128/v1"
)

def chat_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="cc/claude-sonnet-4-20250514",
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content
        except RateLimitError:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise
```

## Solución de problemas

### Problemas de conexión

**Problema:** No se puede conectar a 9Router
```bash
# Verifica si 9Router está corriendo
curl http://localhost:20128/health

# Respuesta esperada:
{"status": "ok"}
```

**Solución:**
- Verifica que 9Router esté corriendo
- Verifica que el puerto 20128 no esté bloqueado
- Asegúrate de tener la URL base correcta (incluir `/v1`)

### Errores de autenticación

**Problema:** 401 Unauthorized
```
Error: Invalid API key
```

**Solución:**
- Verifica la API key desde el dashboard
- Verifica el formato del header de Authorization: `Bearer your-api-key`
- Asegúrate de no tener espacios extras o saltos de línea en la API key

### Modelo no encontrado

**Problema:** 404 Model not found
```
Error: Model 'cc/claude-opus' not found
```

**Solución:**
- Usa el nombre exacto del modelo (sensible a mayúsculas)
- Verifica los modelos disponibles: `curl http://localhost:20128/v1/models`
- Verifica que el modelo esté habilitado en tu plan

### Problemas de timeout

**Problema:** Request timeout
```
Error: Request timed out after 30s
```

**Solución:**
- Aumenta el timeout en la configuración del cliente
- Usa modelos más rápidos para tareas sensibles al tiempo
- Verifica la conexión de red a 9Router

### Rate limiting

**Problema:** 429 Too Many Requests
```
Error: Rate limit exceeded
```

**Solución:**
- Implementa exponential backoff
- Reduce la frecuencia de solicitudes
- Verifica los límites de tasa en el dashboard
- Considera actualizar tu plan

## Mejores prácticas

### Seguridad
- Almacena las API keys en variables de entorno
- Nunca subas las API keys al control de versiones
- Usa HTTPS para despliegues en la nube
- Rota las API keys regularmente

### Rendimiento
- Usa modelos apropiados para la complejidad de la tarea
- Implementa caché para consultas repetidas
- Usa streaming para respuestas largas
- Agrupa solicitudes cuando sea posible

### Manejo de errores
- Siempre implementa bloques try-catch
- Agrega lógica de reintento con exponential backoff
- Registra errores para debugging
- Proporciona mecanismos de fallback

### Optimización de costos
- Elige modelos costo-efectivos para tareas simples
- Cachea respuestas cuando sea apropiado
- Monitorea el uso en el dashboard
- Establece límites de solicitudes en el código

## Próximos pasos

- [Configurar Cursor](cursor.md) para integración con IDE
- [Configurar Continue](continue.md) para VSCode
- [Explorar uso de CLI](../cli/basic-usage.md)
- [Aprende sobre la selección de modelos](../models/overview.md)
- [Referencia de API](../api/reference.md)
