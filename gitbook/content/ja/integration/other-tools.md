# その他ツール統合

9RouterはOpenAI API形式をサポートする任意のツールと互換性があります。このガイドでは、様々なツールやカスタムアプリケーション向けの汎用統合パターンを説明します。

## 概要

9RouterはOpenAI互換APIエンドポイントを提供し、以下と動作します:
- カスタムスクリプトとアプリケーション
- APIクライアントとテストツール
- CLIツールとユーティリティ
- サードパーティ統合
- 開発フレームワーク

## 汎用セットアップパターン

任意のOpenAI互換ツールは以下の設定で9Routerに接続できます:

**ローカル9Router:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
Model: 任意の9Routerモデル (cc/*, cx/*, glm/*など)
```

**クラウド9Router:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
Model: 任意の9Routerモデル (cc/*, cx/*, glm/*など)
```

## 利用可能なモデル

### Claudeモデル (Anthropic)
- `cc/claude-opus-4-5-20251101`
- `cc/claude-sonnet-4-20250514`
- `cc/claude-haiku-4-20250514`

### DeepSeekモデル
- `cx/deepseek-chat`
- `cx/deepseek-reasoner`

### GLMモデル (Zhipu AI)
- `glm/glm-4-plus`
- `glm/glm-4-flash`

## 統合例

### PythonとOpenAI SDK

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

### Node.jsとOpenAI SDK

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

### cURLコマンド

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

### HTTPクライアント (Postman、Insomnia)

**Request:**
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

### LangChain統合

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

### LlamaIndex統合

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

## カスタムスクリプトの例

### バッチ処理スクリプト

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

### ストリーミングレスポンスハンドラ

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

### マルチモデル比較

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

## 一般的な統合パターン

### 環境変数

認証情報を安全に保存:

```bash
# .envファイル
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

### エラーハンドリング

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

### リトライロジック

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

## トラブルシューティング

### 接続の問題

**問題:** 9Routerに接続できない
```bash
# 9Routerが動作中か確認
curl http://localhost:20128/health

# 期待されるレスポンス:
{"status": "ok"}
```

**解決策:**
- 9Routerが動作中か確認
- ポート20128がブロックされていないか確認
- 正しいbase URLを確認 (`/v1`を含む)

### 認証エラー

**問題:** 401 Unauthorized
```
Error: Invalid API key
```

**解決策:**
- ダッシュボードからのAPIキーを確認
- AuthorizationヘッダーフォーマットがBearer your-api-keyであることを確認
- APIキーに余分なスペースや改行がないことを確認

### モデルが見つからない

**問題:** 404 Model not found
```
Error: Model 'cc/claude-opus' not found
```

**解決策:**
- 正確なモデル名を使用 (大文字小文字を区別)
- 利用可能なモデルを確認: `curl http://localhost:20128/v1/models`
- プランでモデルが有効になっていることを確認

### タイムアウトの問題

**問題:** リクエストタイムアウト
```
Error: Request timed out after 30s
```

**解決策:**
- クライアント設定でタイムアウトを増やす
- 時間制約のあるタスクには高速モデルを使用
- 9Routerへのネットワーク接続を確認

### レート制限

**問題:** 429 Too Many Requests
```
Error: Rate limit exceeded
```

**解決策:**
- 指数バックオフを実装
- リクエスト頻度を減らす
- ダッシュボードでレート制限を確認
- プランのアップグレードを検討

## ベストプラクティス

### セキュリティ
- APIキーを環境変数に保存
- APIキーをバージョン管理にコミットしない
- クラウドデプロイにはHTTPSを使用
- APIキーを定期的にローテーション

### パフォーマンス
- タスクの複雑さに応じて適切なモデルを使用
- 繰り返しクエリにキャッシュを実装
- 長い応答にはストリーミングを使用
- 可能な場合はリクエストをバッチ処理

### エラーハンドリング
- 常にtry-catchブロックを実装
- 指数バックオフでリトライロジックを追加
- デバッグのためエラーをログ
- フォールバックメカニズムを提供

### コスト最適化
- シンプルなタスクには費用対効果の高いモデルを選択
- 適切な場合は応答をキャッシュ
- ダッシュボードで使用量をモニター
- コードでリクエスト制限を設定

## 次のステップ

- [Cursorを設定](cursor.md) IDE統合用
- [Continueをセットアップ](continue.md) VSCode用
- [CLI使用法を確認](../cli/basic-usage.md)
- [モデル選択について学ぶ](../models/overview.md)
- [APIリファレンス](../api/reference.md)
