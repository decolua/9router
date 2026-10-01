# Continue VSCode拡張機能統合

9RouterをContinue拡張機能と統合し、Visual Studio Codeに直接AIアシスタンスを導入します。

## 前提条件

- Visual Studio Codeがインストール済み
- VSCodeマーケットプレイスからContinue拡張機能がインストール済み
- [ダッシュボード](https://9router.com/dashboard)からの9Router APIキー
- 9Routerが動作中 (ローカルまたはクラウド)

## 設定手順

### 1. Continue設定を開く

1. VSCodeを開く
2. `Cmd+Shift+P` (Mac) または `Ctrl+Shift+P` (Windows/Linux) を押す
3. 「Continue: Open Config」と入力して選択
4. `~/.continue/config.json` が開きます

### 2. 9Routerモデル設定を追加

以下の設定を `config.json` に追加:

**単一モデルセットアップ:**
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

**複数モデルセットアップ:**
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

**クラウド9Router用:**
`apiBase` を以下に置き換え:
```json
"apiBase": "https://9router.com/v1"
```

### 3. 保存してリロード

1. 設定ファイルを保存
2. VSCodeウィンドウをリロード: `Cmd+Shift+P` → 「Developer: Reload Window」
3. Continue拡張機能が新しい設定を読み込みます

### 4. モデルを選択

1. Continueサイドバーを開く (左パネルのContinueアイコンをクリック)
2. 上部のモデルセレクタードロップダウンをクリック
3. お好みの9Routerモデルを選択

## 利用可能なモデル

### Claudeモデル (Anthropic)
- `cc/claude-opus-4-5-20251101` - 最も高性能、複雑なタスクに最適
- `cc/claude-sonnet-4-20250514` - パフォーマンスと速度のバランス
- `cc/claude-haiku-4-20250514` - 最速、シンプルなタスクに適している

### DeepSeekモデル
- `cx/deepseek-chat` - コード生成に優れている
- `cx/deepseek-reasoner` - 複雑な問題解決に最適

### GLMモデル (Zhipu AI)
- `glm/glm-4-plus` - 高度な中国語と英語
- `glm/glm-4-flash` - 高速応答

## 使用例

### コード説明
1. エディタでコードを選択
2. Continueサイドバーを開く
3. 入力: 「Explain this code」
4. Model: `cc/claude-sonnet-4-20250514`

### コード生成
1. Continueサイドバーを開く
2. 入力: 「Create a React component for user profile card」
3. Model: `cx/deepseek-chat`

### リファクタリング
1. リファクタリングするコードを選択
2. 入力: 「Refactor this to use async/await」
3. Model: `cc/claude-sonnet-4-20250514`

### バグ修正
1. 問題のあるコードを選択
2. 入力: 「Find and fix the bug in this code」
3. Model: `cx/deepseek-reasoner`

## 高度な設定

### カスタムシステムプロンプト

特定の動作のためのカスタムシステムプロンプトを追加:

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

### Temperatureとパラメータ

パラメータでモデルの動作を調整:

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

### コンテキストプロバイダー

Continueがモデルに送信するコンテキストを設定:

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

## キーボードショートカット

- `Cmd+L` (Mac) / `Ctrl+L` (Windows/Linux) - Continueチャットを開く
- `Cmd+I` (Mac) / `Ctrl+I` (Windows/Linux) - インライン編集
- `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux) - 応答を再生成

## トラブルシューティング

### モデルが応答しない
- 9Routerが動作中か確認: `curl http://localhost:20128/health`
- config.jsonのAPIキーを確認
- エラーについてVSCode開発者コンソールを確認: `Help` → `Toggle Developer Tools`

### 間違ったモデルが選択されている
- Continueサイドバーのモデルドロップダウンをクリック
- 正しい9Routerモデルを選択
- モデル名は正確に一致する必要があります (大文字小文字を区別)

### 設定が読み込まれない
- JSON構文が有効であることを確認 (JSONバリデータを使用)
- ファイルの場所を確認: `~/.continue/config.json`
- 変更後にVSCodeウィンドウをリロード

### パフォーマンスが遅い
- より高速なモデルへ切替 (haiku、flash)
- contextProvidersでコンテキストサイズを削減
- 9Routerへのネットワークレイテンシを確認

## ベストプラクティス

### モデル選択戦略
- **クイック編集**: `cc/claude-haiku-4-20250514` を使用
- **コード生成**: `cx/deepseek-chat` を使用
- **複雑なリファクタリング**: `cc/claude-opus-4-5-20251101` を使用
- **問題解決**: `cx/deepseek-reasoner` を使用

### コンテキスト管理
- 質問する前に関連コードのみを選択
- 具体的で明確なプロンプトを使用
- 複雑なタスクを小さなステップに分解

### コスト最適化
- シンプルなタスクには高速/安価なモデルを使用
- 可能な場合はコンテキストサイズを制限
- 頻繁に使用される応答をキャッシュ

## 次のステップ

- [Cursorを設定](cursor.md) IDE統合を強化
- [Rooをセットアップ](roo.md) AIアシスタント用
- [CLI使用法を確認](../cli/basic-usage.md)
- [モデル選択について学ぶ](../models/overview.md)
