# OpenDesign 統合

[OpenDesign](https://github.com/Diwak4r/OpenDesign)(AI ネイティブなデザインエージェント IDE)と 9Router を統合し、あらゆるビジュアル生成・コード生成リクエストを 9Router のインテリジェントルーティング経由でルーティングします。

## なぜ OpenDesign + 9Router か

OpenDesign はプロンプトをデザインスペックとして扱います——画像認識入力、レイアウト意図、パレット制約、構造化出力。9Router と組み合わせると:

- **クォータ安全なイテレーション**——有料シートを燃やさずにサブスクリプション/フォールバック層で設計継続
- **マルチモデルファンアウト**——同じブリーフでビジョン対応モデルとコード対応モデルを比較
- **自動フォールバック**——イテレーション中にプロバイダがレート制限を発動しても、9Router は次の設定済みプロバイダへ静かにローテーション
- **統合利用テレメトリ**——すべての render、generate、edit リクエストを 1 つのダッシュボードで確認

## 前提条件

- OpenDesign がインストール済み(CLI またはデスクトップビルド)
- 9Router がローカルで稼働中 **または** 9Router クラウドエンドポイントが設定済み
- 9Router ダッシュボードからの API キー

> **注意**:OpenDesign は `localhost` とクラウドエンドポイントの両方をサポートします。セットアップに合わせて選んでください。

## セットアップ

### 1. OpenDesign Settings を開く

1. OpenDesign を起動
2. **Settings → Providers** を開く
3. **Add Custom Provider** をクリック

### 2. Base URL を設定

Base URL に 9Router エンドポイントを指定:

**ローカル 9Router:**
```
http://localhost:20128/v1
```

**クラウド 9Router:**
```
https://9router.com/v1
```

**手順:**
1. **Base URL** フィールドに 9Router エンドポイントを貼り付け
2. パスが `/v1` で終わることを確認

### 3. API Key を追加

1. **API Key** フィールドに 9Router API キーを入力
2. 9Router ダッシュボードの **Settings → API Keys** で取得
3. キーは `sk-9router-` で始まる

### 4. デフォルトモデルを選択

OpenDesign では chat 用と generation 用に別々のデフォルトモデルを設定できます。推奨ペア:

| タスク | モデルプレフィックス | 例 |
|---|---|---|
| ビジュアル推論(デフォルト) | `cc/` | `cc/claude-sonnet-4-20250514` |
| 高速イテレーション | `glm/` | `glm/glm-4-flash` |
| コード重視のレイアウト作業 | `cx/` | `cx/deepseek-chat` |

OpenDesign は `/v1/models` エンドポイント経由で 9Router インスタンス上の全モデルを自動検出します。

### 5. Image-Aware モードを有効化

**Settings → Generation** で **Image-aware prompts** を有効化。添付画像を OpenAI ペイロード内の正規の `image_url` パートとしてラップし、9Router が背後のプロバイダに透過します。

### 6. 保存して検証

**Test Connection** をクリック。OpenDesign が 9Router に `GET /v1/models` を送信します。緑のチェックマークでルーティング稼働を確認できます。

## 設定例

OpenDesign のプロバイダエントリは次のようになります:

```
Name:        9Router
Base URL:    http://localhost:20128/v1
API Key:     sk-9router-xxxxxxxxxxxxx
Chat Model:  cc/claude-sonnet-4-20250514
Gen Model:   glm/glm-4-plus
Streaming:   on
Image-aware: on
```

## 利用可能モデル

9Router ダッシュボードが露出する全モデルを使用できます。デザインフローに特に適したもの:

| モデル名 | プロバイダ | 用途 |
|---|---|---|
| `cc/claude-sonnet-4-20250514` | Anthropic | ビジュアル推論、レイアウト批評 |
| `cc/claude-opus-4-5-20251101` | Anthropic | 高忠実度スペック執筆 |
| `cx/deepseek-chat` | DeepSeek | コード生成、コンポーネントスキャフォールド |
| `glm/glm-4-plus` | Zhipu AI | 高速イテレーション、カラー/パレット作業 |
| `gemini/gemini-2.0-flash` | Google | マルチモーダル添付、高速プレビュー |

**Project → Model** でプロジェクトごとにモデルを切り替えられます。

## 使い方

### デザインコンテキストでチャット

1. デザインファイル(`.opendsg`、Figma JSON、画像、スケッチ)を開く
2. チャットパネルを開く(`Cmd/Ctrl + Shift + L`)
3. 特定のレイヤーを参照:*「hero の padding を 32px に締め、CTA のコントラストを AA まで上げろ」*
4. OpenDesign は現在の canvas を `image_url` コンテキストとして添付し、9Router が chat モデルへ転送

### コンポーネント生成

1. `Cmd/Ctrl + G` で generate ダイアログを開く
2. コンポーネントを記述:*「3 ティアの価格カード、sticky CTA、ダークモード」*
3. OpenDesign が 9Router 経由でコード対応モデルにリクエストし、結果をインラインでレンダリング

### モック上でのイテレーション

1. スクリーンショットやワイヤーフレームを canvas にドロップ
2. 質問:*「これの高忠実度 Tailwind 版を生成、スペーシングは保持」*
3. OpenDesign がトークンを 9Router 経由でストリーミング返信。いつでも割り込んで方向転換可能

### パレットとトークン作業

1. canvas 上で色を選択
2. 質問:*「このベースを起点に 12 ステップ、知覚的に均一なトークンスケールを組め」*
3. 生成されたトークンは名前付き変数として着地し、プロジェクト全体で再利用可能

## トラブルシューティング

### "Connection Failed"

1. 9Router が稼働中か確認:`curl http://localhost:20128/health`
2. base URL が `/v1` で終わることを確認
3. ファイアウォールが 20128 ポートを塞いでいないか確認
4. OpenDesign で再度 **Test Connection** をクリック

### "Invalid API Key"

1. 9Router ダッシュボードからキーを再コピー
2. `sk-9router-` プレフィックスが無傷か確認
3. **Settings → API Keys** でキーが失効していないか確認

### "Model Not Found"

1. `curl http://localhost:20128/v1/models` を実行し、正確なモデル id を確認
2. 9Router ダッシュボードで対象プロバイダが接続済み(緑ステータス)であることを確認
3. 修飾名を使用:`claude-sonnet-4` ではなく `cc/claude-sonnet-4-20250514`

### 画像添付が尊重されない

1. OpenDesign 設定で **Image-aware prompts** が有効か確認
2. アクティブなモデルがビジョン対応か確認(プロバイダドキュメント参照)
3. 9Router ログを確認——画像パートは `messages[].content[].type == "image_url` に現れるはず

### 最初のトークンが遅い

1. OpenDesign は最初のバイトを待ってからレンダリングするため、大きいプロンプトほど遅くなる
2. chat では **Streaming** を有効化し高速モデルを使う。重量級モデルは generation 用に確保
3. 9Router ダッシュボードでコンボを予熱し、フォールバック経路を接続済みにしておく

## ベストプラクティス

1. **モデルとタスクを合わせる**——ビジュアル批評にはビジョン対応モデル、スキャフォールドにはコードモデル、パレット作業には高速モデル
2. **コンボで構成**——9Router で同じブリーフを 2 モデルへファンし、安価で有効なレスポンスを選ぶコンボを構築
3. **クォータを監視**——デザインイテレーションはトークンを大量に消費するため、作業中はダッシュボードを開きっぱなしに
4. **プロジェクトで再利用**——モデル + base URL をプロジェクトレベルで固定し、異なるプロジェクトで異なる層を固定できるようにする
5. **API キーをローテーション**——60 日ごとに新しい `sk-9router-` キーを生成

## 9Router 機能との統合

### スマートルーティング

9Router はモデルの可用性とヘルス制約を満たす最も安価なプロバイダを選びます。きついイテレーションループに最適。

### コンボ

2〜3 プロバイダをチェーンし、Claude ビジョンパスが GLM へ、そして Gemini Flash へフォールバックするのを OpenDesign が気づかないまま実現。

### クォータ追跡

すべての render、generate、edit コールがダッシュボードの **Usage** に着地。`provider=opendesign` でフィルタすればデザイン作業を分離可能。

### トークンセーバー

OpenDesign を 9Router 上流の [RTK](https://github.com/rtk-ai/rtk) または [Headroom](https://github.com/chopratejas/headroom) と組み合わせ、モデル到達前に長い canvas 説明を圧縮。

## 次のステップ

- [他の統合を探索](other-tools.md)
- [スマートルーティングを設定](../features/smart-routing.md)
- [コンボとフォールバックを構成](../features/combos.md)
- [プロバイダ横断でクォータを追跡](../features/quota-tracking.md)