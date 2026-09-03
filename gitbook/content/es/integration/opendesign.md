# Integración con OpenDesign

Integra 9Router con [OpenDesign](https://github.com/Diwak4r/OpenDesign), un IDE de agentes de diseño AI-nativo, para enrutar cada solicitud visual y de generación de código a través del sistema de enrutamiento inteligente de 9Router.

## Por qué OpenDesign + 9Router

OpenDesign trata los prompts como especificaciones de diseño — entradas con percepción de imagen, intención de layout, restricciones de paleta y salidas estructuradas. Combinado con 9Router obtienes:

- **Iteración segura en cuota** — sigue diseñando en tiers de suscripción/fallback sin quemar asientos de pago
- **Fan-out multi-modelo** — compara un modelo con visión y un modelo code-capable sobre el mismo brief
- **Fallback automático** — si un proveedor aplica rate-limit a mitad de iteración, 9Router rota silenciosamente al siguiente proveedor configurado
- **Telemetría de uso unificada** — ve cada render, generate y edit en un solo dashboard

## Requisitos previos

- OpenDesign instalado (CLI o build de escritorio)
- 9Router ejecutándose local **o** un endpoint en la nube de 9Router configurado
- Un API key del dashboard de 9Router

> **Nota**: OpenDesign soporta tanto `localhost` como endpoint en la nube. Elige el que se ajuste a tu setup.

## Configuración

### 1. Abrir OpenDesign Settings

1. Lanza OpenDesign
2. Abre **Settings → Providers**
3. Click en **Add Custom Provider**

### 2. Configurar Base URL

Configura el base URL con tu endpoint de 9Router:

**9Router local:**
```
http://localhost:20128/v1
```

**9Router en la nube:**
```
https://9router.com/v1
```

**Pasos:**
1. En el campo **Base URL**, pega tu endpoint de 9Router
2. Asegúrate de que la ruta termina en `/v1`

### 3. Agregar API Key

1. En el campo **API Key**, ingresa tu API key de 9Router
2. Encuéntrala en el dashboard de 9Router en **Settings → API Keys**
3. Las keys empiezan con `sk-9router-`

### 4. Elegir modelo por defecto

OpenDesign permite definir un modelo por defecto para chat y otro independiente para generation. Combinaciones recomendadas:

| Tarea | Prefijo | Ejemplo |
|---|---|---|
| Razonamiento visual (default) | `cc/` | `cc/claude-sonnet-4-20250514` |
| Iteración rápida | `glm/` | `glm/glm-4-flash` |
| Trabajo de layout code-heavy | `cx/` | `cx/deepseek-chat` |

OpenDesign auto-detecta todos los modelos disponibles en tu instancia de 9Router vía el endpoint `/v1/models`.

### 5. Habilitar Image-Aware Mode

En **Settings → Generation**, activa **Image-aware prompts**. Esto envuelve las imágenes adjuntas como partes `image_url` válidas en el payload de OpenAI — 9Router las reenvía al proveedor subyacente.

### 6. Guardar y verificar

Click en **Test Connection**. OpenDesign enviará un `GET /v1/models` a 9Router. Una palomita verde significa que el enrutamiento está activo.

## Ejemplo de configuración

Tu entrada de proveedor en OpenDesign debería verse así:

```
Name:        9Router
Base URL:    http://localhost:20128/v1
API Key:     sk-9router-xxxxxxxxxxxxx
Chat Model:  cc/claude-sonnet-4-20250514
Gen Model:   glm/glm-4-plus
Streaming:   on
Image-aware: on
```

## Modelos disponibles

Puedes usar cualquier modelo expuesto por tu dashboard de 9Router. Los que mejor funcionan para flujos de diseño:

| Modelo | Proveedor | Ideal para |
|---|---|---|
| `cc/claude-sonnet-4-20250514` | Anthropic | Razonamiento visual, crítica de layout |
| `cc/claude-opus-4-5-20251101` | Anthropic | Borradores de spec de alta fidelidad |
| `cx/deepseek-chat` | DeepSeek | Generación de código, scaffolds de componentes |
| `glm/glm-4-plus` | Zhipu AI | Iteración rápida, trabajo de color/paleta |
| `gemini/gemini-2.0-flash` | Google | Adjuntos multi-modales, previews rápidas |

Cambia de modelo por proyecto en **Project → Model**.

## Uso

### Chat con contexto de diseño

1. Abre un archivo de diseño (`.opendsg`, Figma JSON, imagen o sketch)
2. Abre el panel de chat (`Cmd/Ctrl + Shift + L`)
3. Referencia capas específicas: *"Aprieta el padding del hero a 32px y sube el contraste del CTA a AA"*
4. OpenDesign adjunta el canvas actual como contexto `image_url`; 9Router lo reenvía al modelo de chat

### Generar componentes

1. Pulsa `Cmd/Ctrl + G` para abrir el diálogo de generate
2. Describe el componente: *"Una pricing card con tres tiers, sticky CTA, dark mode"*
3. OpenDesign pide un modelo code-capable vía 9Router y renderiza el resultado en línea

### Iterar sobre un mock

1. Suelta un screenshot o wireframe al canvas
2. Pregunta: *"Genera una versión Tailwind de alta fidelidad de esto, conserva el spacing"*
3. OpenDesign transmite tokens de vuelta a través de 9Router; puedes interrumpir y redirigir en cualquier momento

### Trabajo de paleta y tokens

1. Selecciona un color en el canvas
2. Pregunta: *"Construye una escala de tokens de 12 pasos alrededor de este base, perceptualmente uniforme"*
3. Los tokens generados aterrizan como variables con nombre que puedes reutilizar en todo el proyecto

## Solución de problemas

### "Connection Failed"

1. Verifica que 9Router está corriendo: `curl http://localhost:20128/health`
2. Confirma que el base URL termina en `/v1`
3. Revisa que el firewall no esté bloqueando el puerto 20128
4. En OpenDesign, click **Test Connection** de nuevo

### "Invalid API Key"

1. Vuelve a copiar la key desde el dashboard de 9Router
2. Confirma que el prefijo `sk-9router-` está intacto
3. Verifica que la key no se haya revocado en **Settings → API Keys**

### "Model Not Found"

1. Ejecuta `curl http://localhost:20128/v1/models` y verifica el id exacto
2. Confirma que el proveedor subyacente esté conectado en el dashboard de 9Router (estado verde)
3. Prueba el nombre calificado: `cc/claude-sonnet-4-20250514` en lugar de `claude-sonnet-4`

### Adjuntos de imagen no se respetan

1. Confirma que **Image-aware prompts** esté habilitado en OpenDesign
2. Verifica que el modelo activo soporte visión (revisa docs del proveedor)
3. Revisa los logs de 9Router — las partes de imagen deben aparecer bajo `messages[].content[].type == "image_url"`

### Primer token lento

1. OpenDesign espera al primer byte antes de renderizar — prompts grandes lo retrasan
2. Activa **Streaming** + un modelo más rápido para chat, reserva el modelo pesado para generation
3. Pre-calienta combos en el dashboard de 9Router para que la ruta de fallback ya esté conectada

## Buenas prácticas

1. **Empareja modelo y tarea** — modelo con visión para crítica visual, modelo de código para scaffolds, modelo rápido para trabajo de paleta
2. **Compón vía combos** — en 9Router, construye un combo que distribuya el mismo brief a dos modelos y elija la respuesta más barata válida
3. **Vigila la cuota** — la iteración de diseño consume muchos tokens; mantén el dashboard abierto mientras trabajas
4. **Reutiliza vía proyectos** — fija modelo + base URL a nivel de proyecto para que distintos proyectos anclen distintos tiers
5. **Rota las API keys** — genera una nueva key `sk-9router-` cada 60 días

## Integración con funciones de 9Router

### Smart Routing

9Router elige el proveedor más barato que aún cumple con la disponibilidad y salud del modelo — perfecto para loops de iteración cerrados.

### Combos

Encadena dos o tres proveedores para que un pase de visión con Claude pueda caer a GLM y luego a Gemini Flash, todo sin que OpenDesign lo note.

### Quota Tracking

Cada render, generate y edit call aterriza en el dashboard bajo **Usage**. Filtra por `provider=opendesign` para aislar el trabajo de diseño.

### Token Savers

Empareja OpenDesign con [RTK](https://github.com/rtk-ai/rtk) o [Headroom](https://github.com/chopratejas/headroom) aguas arriba de 9Router para comprimir descripciones largas de canvas antes de que lleguen al modelo.

## Siguientes pasos

- [Explorar otras integraciones](other-tools.md)
- [Configurar smart routing](../features/smart-routing.md)
- [Definir combos y fallback](../features/combos.md)
- [Seguir la cuota entre proveedores](../features/quota-tracking.md)