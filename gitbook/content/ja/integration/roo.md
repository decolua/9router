# Roo AIアシスタント統合

9RouterをRoo AIアシスタントと統合し、統一インターフェイスから複数のAIモデルにアクセスします。

## 前提条件

- Roo AIアシスタントがインストール済み
- [ダッシュボード](https://9router.com/dashboard)からの9Router APIキー
- 9Routerが動作中 (ローカルまたはクラウド)

## 設定手順

### 1. Roo設定を開く

Roo AIアシスタントを起動し、設定パネルを開きます。

### 2. APIプロバイダーを設定

1. **API Provider** 設定へ移動
2. プロバイダータイプとして **Ollama** を選択
3. 以下の設定を行う:

**ローカル9Router用:**
```
Base URL: http://localhost:20128/v1
API Key: your-api-key-from-dashboard
```

**クラウド9Router用:**
```
Base URL: https://9router.com/v1
API Key: your-api-key-from-dashboard
```

### 3. モデルを選択

利用可能な9Routerモデルから選択:

**Claudeモデル:**
- `cc/claude-opus-4-5-20251101` - 最も高性能
- `cc/claude-sonnet-4-20250514` - バランス
- `cc/claude-haiku-4-20250514` - 高速

**DeepSeekモデル:**
- `cx/deepseek-chat` - 汎用
- `cx/deepseek-reasoner` - 複雑な推論

**GLMモデル:**
- `glm/glm-4-plus` - 高度
- `glm/glm-4-flash` - 高速応答

### 4. 接続をテスト

統合を確認するためにテストメッセージを送信:

```
Hello! Can you confirm you're connected through 9Router?
```

## 使用例

### 基本チャット
```
Rooに質問: "Explain quantum computing in simple terms"
Model: cc/claude-sonnet-4-20250514
```

### コード生成
```
Rooに質問: "Write a Python function to calculate Fibonacci numbers"
Model: cx/deepseek-chat
```

### 複雑な推論
```
Rooに質問: "Analyze the trade-offs between microservices and monolithic architecture"
Model: cx/deepseek-reasoner
```

## モデル選択のヒント

- **クイックタスク**: `cc/claude-haiku-4-20250514` または `glm/glm-4-flash` を使用
- **バランスのとれたパフォーマンス**: `cc/claude-sonnet-4-20250514` または `cx/deepseek-chat` を使用
- **複雑な推論**: `cc/claude-opus-4-5-20251101` または `cx/deepseek-reasoner` を使用
- **コスト最適化**: DeepSeekまたはGLMモデルを使用

## トラブルシューティング

### 接続失敗
- 9Routerが動作中か確認: `curl http://localhost:20128/health`
- APIキーが正しいか確認
- Base URLに `/v1` サフィックスが含まれていることを確認

### モデルが利用不可
- モデル名が正確に一致するか確認 (大文字小文字を区別)
- 9Routerプランでモデルが有効か確認
- リストから別のモデルを試す

### 応答が遅い
- より高速なモデルへ切替 (haiku、flash)
- ネットワーク接続を確認
- 問題について9Routerログをモニター

## 高度な設定

### カスタムモデルエイリアス

Roo設定で頻繁に使うモデルのショートカットを作成:

```
エイリアス: "fast" → cc/claude-haiku-4-20250514
エイリアス: "smart" → cc/claude-opus-4-5-20251101
エイリアス: "code" → cx/deepseek-chat
```

### 複数のプロファイル

異なるユースケース用の異なるプロファイルをセットアップ:
- **開発**: コード用のDeepSeekモデル
- **執筆**: コンテンツ用のClaudeモデル
- **リサーチ**: 分析用のReasonerモデル

## 次のステップ

- [Cursorを設定](cursor.md) IDE統合用
- [Continueをセットアップ](continue.md) VSCode用
- [CLI使用法を確認](../cli/basic-usage.md)
