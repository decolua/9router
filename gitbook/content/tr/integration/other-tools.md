# Diğer Araçlarla Entegrasyon

9Router, OpenAI API biçimini destekleyen her araçla uyumludur. Bu kılavuz, çeşitli araçlar ve özel uygulamalar için genel entegrasyon kalıplarını ele alır.

## Genel Bakış

9Router, şunlarla çalışan OpenAI uyumlu bir API uç noktası sunar:
- Özel betikler ve uygulamalar
- API istemcileri ve test araçları
- CLI araçları ve yardımcı programlar
- Üçüncü taraf entegrasyonları
- Geliştirme çerçeveleri

## Genel Kurulum Kalıbı

OpenAI uyumlu her araç, bu ayarlarla 9Router'a bağlanabilir:

**Yerel 9Router:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
Model: herhangi bir 9Router modeli (cc/*, cx/*, glm/* vb.)
```

**Bulut 9Router:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
Model: herhangi bir 9Router modeli (cc/*, cx/*, glm/* vb.)
```

## Kullanılabilir Modeller

### Claude Modelleri (Anthropic)
- `cc/claude-opus-4-5-20251101`
- `cc/claude-sonnet-4-20250514`
- `cc/claude-haiku-4-20250514`

### DeepSeek Modelleri
- `cx/deepseek-chat`
- `cx/deepseek-reasoner`

### GLM Modelleri (Zhipu AI)
- `glm/glm-4-plus`
- `glm/glm-4-flash`

## Entegrasyon Örnekleri

### OpenAI SDK ile Python

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

### OpenAI SDK ile Node.js

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

### cURL Komutu

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

### HTTP İstemcisi (Postman, Insomnia)

**İstek:**
```
POST http://localhost:20128/v1/chat/completions
```

**Başlıklar:**
```
Content-Type: application/json
Authorization: Bearer your-api-key-from-dashboard
```

**Gövde:**
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

### LangChain Entegrasyonu

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

### LlamaIndex Entegrasyonu

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

## Özel Betik Örnekleri

### Toplu İşleme Betiği

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

### Akış Yanıtı İşleyicisi

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

### Çoklu Model Karşılaştırması

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

## Yaygın Entegrasyon Kalıpları

### Ortam Değişkenleri

Kimlik bilgilerini güvenli şekilde saklayın:

```bash
# .env dosyası
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

### Hata Yönetimi

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

### Yeniden Deneme Mantığı

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

## Sorun Giderme

### Bağlantı Sorunları

**Sorun:** 9Router'a bağlanılamıyor
```bash
# 9Router'ın çalışıp çalışmadığını kontrol edin
curl http://localhost:20128/health

# Beklenen yanıt:
{"status": "ok"}
```

**Çözüm:**
- 9Router'ın çalıştığını doğrulayın
- 20128 portunun engellenmediğini kontrol edin
- Base URL'nin doğru olduğundan emin olun (`/v1` dahil)

### Kimlik Doğrulama Hataları

**Sorun:** 401 Unauthorized
```
Error: Invalid API key
```

**Çözüm:**
- API anahtarını panelden doğrulayın
- Authorization başlık biçimini kontrol edin: `Bearer your-api-key`
- API anahtarında fazladan boşluk veya satır sonu olmadığından emin olun

### Model Bulunamadı

**Sorun:** 404 Model not found
```
Error: Model 'cc/claude-opus' not found
```

**Çözüm:**
- Tam model adını kullanın (büyük/küçük harfe duyarlı)
- Kullanılabilir modelleri kontrol edin: `curl http://localhost:20128/v1/models`
- Modelin planınızda etkin olduğunu doğrulayın

### Zaman Aşımı Sorunları

**Sorun:** Request timeout
```
Error: Request timed out after 30s
```

**Çözüm:**
- İstemci yapılandırmasında zaman aşımını artırın
- Zamana duyarlı görevler için daha hızlı modeller kullanın
- 9Router'a ağ bağlantısını kontrol edin

### Hız Sınırlama

**Sorun:** 429 Too Many Requests
```
Error: Rate limit exceeded
```

**Çözüm:**
- Üstel geri çekilme uygulayın
- İstek sıklığını azaltın
- Paneldeki hız sınırlarını kontrol edin
- Planı yükseltmeyi değerlendirin

## En İyi Uygulamalar

### Güvenlik
- API anahtarlarını ortam değişkenlerinde saklayın
- API anahtarlarını asla sürüm kontrolüne işlemeyin
- Bulut dağıtımlarında HTTPS kullanın
- API anahtarlarını düzenli olarak değiştirin

### Performans
- Görev karmaşıklığına uygun modeller kullanın
- Tekrarlanan sorgular için önbellekleme uygulayın
- Uzun yanıtlar için akış kullanın
- Mümkün olduğunda istekleri toplu işleyin

### Hata Yönetimi
- Her zaman try-catch blokları uygulayın
- Üstel geri çekilme (exponential backoff) ile yeniden deneme mantığı ekleyin
- Hata ayıklama için hataları günlüğe kaydedin
- Yedek geçiş (fallback) mekanizmaları sağlayın

### Maliyet Optimizasyonu
- Basit görevler için maliyet etkin modeller seçin
- Uygun olduğunda yanıtları önbelleğe alın
- Kullanımı panelden izleyin
- Kodda istek sınırları belirleyin

## Sonraki Adımlar

- IDE entegrasyonu için [Cursor'ı yapılandırın](cursor.md)
- VSCode için [Continue'u kurun](continue.md)
- [CLI kullanımını keşfedin](../cli/basic-usage.md)
- [Model seçimi hakkında bilgi edinin](../models/overview.md)
- [API Referansı](../api/reference.md)
