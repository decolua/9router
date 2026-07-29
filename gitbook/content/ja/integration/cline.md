# Cline統合

ebRouterをCline VSCode拡張機能と統合し、AIリクエストをebRouterのインテリジェントルーティングシステム経由でルーティングします。

## 前提条件

- Visual Studio Codeがインストール済み
- VSCodeマーケットプレイスからCline拡張機能がインストール済み
- ebRouterがローカルで動作中、またはクラウドエンドポイントが設定済み
- ebRouterダッシュボードからのAPIキー

## セットアップ

### 1. Cline設定を開く

1. Visual Studio Codeを開く
2. Cline拡張機能パネルを開く (サイドバーのClineアイコンをクリック)
3. Clineパネルの **Settings** アイコン (歯車アイコン) をクリック

### 2. APIプロバイダーを選択

1. Cline設定で **API Provider** ドロップダウンを見つける
2. リストから **Ollama** を選択
   - 注: OpenAIスタイルAPIと互換性があるためOllamaプロバイダータイプを使用します

### 3. Base URLを設定

Base URLをebRouterエンドポイントに設定:

**ローカルebRouter用:**
```
http://localhost:20128/v1
```

**クラウドebRouter用:**
```
https://ebrouter.example.com
```

**手順:**
1. **Base URL** フィールドにebRouterエンドポイントを入力
2. 末尾に `/v1` を必ず含める

### 4. APIキーを追加

1. **API Key** フィールドにebRouter APIキーを入力
2. APIキーはebRouterダッシュボードの **Settings → API Keys** で確認できます
3. キーは `sk-ebrouter-` で始まります

### 5. モデルを選択

1. **Model** ドロップダウンで、次のいずれかを実行:
   - 利用可能なモデルから選択 (Clineが自動検出した場合)
   - ebRouter設定からモデル名を手動で入力

2. 一般的なモデル名:
   - `gpt-4`
   - `gpt-4o`
   - `claude-opus-4-5`
   - `claude-sonnet-4-5`
   - `gemini-2.0-flash`

### 6. 設定を保存

**Save** をクリックするか、設定パネルを閉じます。Clineは設定を自動的に保存します。

## 設定例

Cline設定は次のようになります:

```
API Provider: Ollama
Base URL: http://localhost:20128/v1
API Key: sk-ebrouter-xxxxxxxxxxxxx
Model: gpt-4
```

## 利用可能なモデル

ebRouterダッシュボードで設定されたモデルを使用できます。一般的な例:

| モデル名 | プロバイダー | 説明 |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## 使用法

### AIとチャット

1. VSCodeでClineパネルを開く
2. チャット入力にメッセージを入力
3. Enterを押して送信
4. ClineはebRouterを使用してリクエストを処理

### コード生成

1. Clineにコード生成を依頼: 「Create a React component for a login form」
2. ClineはebRouterを使用してコードを生成
3. 生成されたコードを確認して受け入れる

### コード説明

1. エディタでコードを選択
2. Clineに質問: 「Explain this code」
3. ebRouter経由でAIによる説明を取得

### ファイル操作

1. Clineにファイルの作成、変更、削除を依頼
2. ClineはebRouterを使用してコンテキストを理解し変更を加える
3. 受け入れる前に変更を確認

## トラブルシューティング

### 「Connection Failed」エラー

1. ebRouterが動作中か確認: `curl http://localhost:20128/health`
2. Base URLが正しく、`/v1` を含むことを確認
3. ファイアウォールがポート20128をブロックしていないか確認
4. VSCodeを再起動してみる

### 「Invalid API Key」エラー

1. ebRouterダッシュボードでAPIキーを確認
2. `sk-ebrouter-` プレフィックスを含むキー全体をコピーしたか確認
3. APIキーが期限切れでないか確認
4. 新しいAPIキーを再生成してみる

### 「Model Not Found」エラー

1. モデル名がebRouter設定と正確に一致するか確認
2. ebRouterダッシュボードでプロバイダー接続がアクティブか確認
3. 接続されたプロバイダーでモデルが利用可能か確認
4. フルモデル名を使用してみる (例: `gpt-4` の代わりに `openai/gpt-4`)

### Clineが応答しない

1. エラーメッセージについてCline出力パネルを確認
2. ebRouterインスタンスが動作中で正常か確認
3. VSCodeウィンドウをリロードしてみる (Cmd/Ctrl + Shift + P → 「Reload Window」)
4. エラーについてebRouterログを確認

## 高度な設定

### クラウドエンドポイントを使用

localhostの代わりにebRouterクラウドエンドポイントを使用:

1. Cline設定で、Base URLを設定: `https://ebrouter.example.com`
2. ebRouterクラウドダッシュボードでAPIキーが設定されていることを確認
3. クラウドエンドポイントがアクティブでアクセス可能か確認

### 複数のモデル

モデルをすばやく切り替えることができます:

1. Cline設定を開く
2. **Model** フィールドを別のモデルに変更
3. 保存して新しいモデルでチャットを続行

### カスタムタイムアウト

大きなリクエストでタイムアウトの問題が発生した場合:

1. VSCode設定を開く (Cmd/Ctrl + ,)
2. 「Cline timeout」を検索
3. タイムアウト値を増やす (デフォルトは通常30秒)

## ベストプラクティス

1. **適切なモデルを使用**: シンプルなタスクには高速モデル (HaikuやFlash) を、複雑なタスクには強力なモデル (OpusやGPT-4) を選択
2. **使用量をモニター**: ebRouterダッシュボードで使用統計とコストを確認
3. **コンテキスト管理**: トークン使用量を減らすため、会話を焦点を絞ったものに保つ
4. **モデル切替**: タスクの複雑さに基づいてモデルを切り替え、コストとパフォーマンスを最適化
5. **APIキーセキュリティ**: APIキーをバージョン管理にコミットしない

## ebRouter機能との統合

### モデルルーティング

ebRouterは以下に基づいて最適な利用可能なプロバイダーにリクエストを自動的にルーティング:
- モデル可用性
- プロバイダーヘルスステータス
- コスト最適化
- ロードバランシング

### フォールバックサポート

プロバイダーが失敗した場合、ebRouterは自動的にダッシュボードで設定された代替プロバイダーにフォールバックします。

### 使用量トラッキング

ebRouterダッシュボード経由でCline使用量をモニター:
- 総リクエスト数
- トークン使用量
- モデルごとのコスト
- プロバイダー分布
