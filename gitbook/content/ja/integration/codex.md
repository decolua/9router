# OpenAI Codex CLI統合

ebRouterをOpenAI Codex CLIと統合し、OpenAI APIリクエストをebRouterのインテリジェントルーティングシステム経由でルーティングします。

## 前提条件

- OpenAI Codex CLIがインストール済み
- ebRouterがローカルで動作中、またはクラウドエンドポイントが設定済み
- ebRouterダッシュボードからのAPIキー

## セットアップ

### 1. 環境変数を設定

シェル設定ファイル (`~/.bashrc`、`~/.zshrc`、または `~/.bash_profile`) で以下の環境変数を設定:

```bash
# ebRouter用Base URL
export OPENAI_BASE_URL="http://localhost:20128/v1"

# ebRouterダッシュボードからのAPIキー
export OPENAI_API_KEY="your-ebrouter-api-key"
```

### 2. シェル設定をリロード

```bash
source ~/.zshrc  # または ~/.bashrc
```

### 3. 設定を確認

環境変数が正しく設定されているか確認:

```bash
echo $OPENAI_BASE_URL
echo $OPENAI_API_KEY
```

## 利用可能なモデル

ebRouterは以下のCodexモデルを提供します:

| モデルID | 説明 |
|----------|-------------|
| `cx/gpt-5.2-codex` | GPT-5.2 Codex - 最新バージョン |
| `cx/gpt-5.1-codex-max` | GPT-5.1 Codex Max - 拡張コンテキスト |

## 使用例

### 基本的な使用法

```bash
# GPT-5.2 Codexを使用
codex --model cx/gpt-5.2-codex "Write a function to sort an array"

# GPT-5.1 Codex Maxを使用
codex --model cx/gpt-5.1-codex-max "Explain this complex algorithm"
```

### コード生成

```bash
codex --model cx/gpt-5.2-codex "Create a REST API endpoint for user authentication"
```

### コード説明

```bash
codex --model cx/gpt-5.1-codex-max "Explain what this code does: $(cat myfile.js)"
```

## 設定ファイル

設定ファイルを使ってCodex CLIを設定することもできます。`~/.codex/config.json` を作成または編集:

```json
{
  "baseUrl": "http://localhost:20128/v1",
  "apiKey": "your-ebrouter-api-key",
  "defaultModel": "cx/gpt-5.2-codex"
}
```

## トラブルシューティング

### 認証エラー

認証エラーが発生した場合:

1. ebRouterダッシュボードでAPIキーが正しいか確認
2. `OPENAI_API_KEY` 環境変数が設定されているか確認
3. APIキーが期限切れでないか確認

### 接続の問題

接続エラーが発生した場合:

1. ebRouterが動作中か確認: `curl http://localhost:20128/health`
2. 環境変数が正しく設定されているか確認
3. ファイアウォールがポート20128をブロックしていないか確認

### モデルが利用不可

「model not available」エラーが発生した場合:

1. モデル名がebRouter設定と一致するか確認
2. ebRouterダッシュボードでOpenAIプロバイダー接続がアクティブか確認
3. 接続されたプロバイダーでモデルが利用可能か確認

## クラウドエンドポイント

localhostの代わりにebRouterクラウドエンドポイントを使用するには:

```bash
export OPENAI_BASE_URL="https://ebrouter.example.com"
```

ebRouterクラウドダッシュボードでAPIキーが設定されていることを確認してください。

## 高度な設定

### カスタムタイムアウト

```bash
export OPENAI_TIMEOUT=60  # 秒
```

### デバッグモード

詳細なリクエスト/レスポンスログを表示するため、デバッグモードを有効化:

```bash
export CODEX_DEBUG=true
codex --model cx/gpt-5.2-codex "Your prompt"
```
