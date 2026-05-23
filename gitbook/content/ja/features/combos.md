# コンボ - カスタムフォールバックチェーン

自動フォールバック付きのカスタムモデル組み合わせを作成。コンボを使って、コスト、品質、可用性に基づく独自のルーティング戦略を定義できます。

---

## コンボとは?

コンボはダッシュボードで作成する**カスタムフォールバックチェーン**です。単一モデルを使う代わりに、9Routerが順番に試すモデルのシーケンスを定義します。

**例:**
```
コンボ名: premium-coding
モデル:
  1. cc/claude-opus-4-5-20251101 (最初に試行)
  2. glm/glm-4.7 (#1のクォータ消費時)
  3. minimax/MiniMax-M2.1 (#2のクォータ消費時)
```

**CLIでの使用:**
```
Model: premium-coding
```

9Routerは成功するまで各モデルを順番に自動的に試します。

---

## なぜコンボを使うのか?

### 1. サブスクリプション価値を最大化
```
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

→ サブスクリプション優先、低価格バックアップ、無料緊急時
→ すでに支払っているサブスクリプションから完全な価値を得る
```

### 2. コストを最小化
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking

→ 最安の有料オプションから開始 (100万あたり$0.60)
→ さらに安いものへフォールバック (100万あたり$0.20)
→ 緊急時の無料階層
→ 総コスト: 月$5〜10 vs ChatGPT APIの$2000
```

### 3. 24時間可用性を確保
```
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7 → if/kimi-k2-thinking

→ 最後に常に無料階層を含める
→ クォータ切れにならない
→ いつでもどこでもコーディング
```

### 4. 品質に最適化
```
cc/claude-opus-4-5 → cx/gpt-5.2-codex → gc/gemini-3-pro

→ 最高のモデルが最初
→ 他のプレミアムモデルへフォールバック
→ フォールバックチェーン全体で高品質を維持
```

---

## コンボの作成方法

### ステップ1: ダッシュボードを開く

```
http://localhost:20128
→ パスワードでログイン
```

### ステップ2: コンボへ移動

```
Dashboard → Combos → Create New Combo
```

### ステップ3: コンボを設定

**コンボ名:**
```
premium-coding
```

**説明(任意):**
```
サブスクリプション優先、低価格バックアップ、無料緊急時
```

**モデルを選択:**
```
1. cc/claude-opus-4-5-20251101
2. glm/glm-4.7
3. minimax/MiniMax-M2.1
```

**ドラッグで並べ替え** - 上から下へ優先順位。

### ステップ4: 保存

```
「Save Combo」をクリック
→ コンボがモデルリストに表示
```

### ステップ5: CLIで使用

```
Cursor/Cline/任意のツール:
  Model: premium-coding
```

---

## コンボの例

### 例1: プレミアムコーディング (サブスク → 低価格 → 無料)

**目標**: サブスクリプション価値を最大化、追加コストを最小化。

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

**使用法:**
```
Cursor IDE:
  Model: premium-coding
```

**動作:**
```
朝 (新鮮なクォータ):
  Request → cc/claude-opus-4-5 ✅

午後 (Claudeクォータ切れ):
  Request → glm/glm-4.7 ✅ (自動切替)

夕方 (GLMクォータ切れ):
  Request → minimax/MiniMax-M2.1 ✅ (自動切替)
```

**月コスト (1億トークン):**
```
Claude Code経由で8000万: $0 (サブスクリプション)
GLM経由で1500万: $9
MiniMax経由で500万: $1
合計: $10 + サブスクリプション
```

**節約**: ChatGPT API ($2000) に対して約99%。

---

### 例2: バジェットコンボ (低価格 → 無料)

**目標**: コストを最小化、バックアップに無料階層を使用。

```
Dashboard → Combos → Create New

Name: budget-combo
Models:
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/kimi-k2-thinking
```

**使用法:**
```
Cline:
  Provider: OpenAI Compatible
  Base URL: http://localhost:20128/v1
  Model: budget-combo
```

**動作:**
```
Request → glm/glm-4.7
  ✅ 日次クォータ利用可 → GLMを使用 (100万あたり$0.60)
  ❌ クォータ消費 → MiniMaxを試行 (100万あたり$0.20)
  ❌ MiniMaxクォータ切れ → iFlowを使用 (無料)
```

**月コスト (1億トークン):**
```
GLM経由で7000万: $42
MiniMax経由で2000万: $4
iFlow経由で1000万: $0
合計: $46 vs ChatGPT APIの$2000
```

**節約**: 97%。

---

### 例3: フリーコンボ (ゼロコスト)

**目標**: 100%無料、コストはゼロ。

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking
  2. qw/qwen3-coder-plus
  3. kr/claude-sonnet-4.5
```

**使用法:**
```
Claude Desktop:
  Model: free-combo
```

**動作:**
```
Request → if/kimi-k2-thinking
  ✅ 利用可 → iFlowを使用
  ❌ エラー → Qwenを試行
  ❌ エラー → Kiroを試行
```

**月コスト:**
```
無料プロバイダー経由で1億トークン: $0
合計: 永久に$0
```

**ユースケース**: 個人プロジェクト、学習、実験。

---

### 例4: 品質優先 (プレミアムモデルのみ)

**目標**: 最高の品質、低価格フォールバックなし。

```
Dashboard → Combos → Create New

Name: quality-first
Models:
  1. cc/claude-opus-4-5-20251101
  2. cx/gpt-5.2-codex
  3. gc/gemini-3-pro-preview
```

**使用法:**
```
Codex CLI:
  export OPENAI_BASE_URL="http://localhost:20128"
  Model: quality-first
```

**動作:**
```
Request → cc/claude-opus-4-5
  ❌ クォータ切れ → cx/gpt-5.2-codex
  ❌ クォータ切れ → gc/gemini-3-pro-preview
  ❌ すべて切れ → エラーを返す (低価格フォールバックなし)
```

**ユースケース**: クリティカルな本番コード、複雑なリファクタリング。

---

### 例5: マルチサブスクリプション (すべてを最大化)

**目標**: 追加料金前にすべてのサブスクリプションを利用。

```
Dashboard → Combos → Create New

Name: multi-sub
Models:
  1. gc/gemini-3-flash-preview (月18万無料)
  2. cc/claude-opus-4-5-20251101 (Proサブスクリプション)
  3. cx/gpt-5.2-codex (Plusサブスクリプション)
  4. gh/gpt-5 (Copilotサブスクリプション)
  5. glm/glm-4.7 (低価格バックアップ)
  6. if/kimi-k2-thinking (無料緊急時)
```

**月コスト (2億トークン):**
```
Gemini CLI経由で5000万: $0 (無料プラン)
Claude Code経由で8000万: $0 (サブスクリプション)
Codex経由で4000万: $0 (サブスクリプション)
Copilot経由で2000万: $0 (サブスクリプション)
GLM経由で800万: $4.80
iFlow経由で200万: $0
合計: $4.80 + 既存サブスクリプション
```

**結果**: サブスクリプションから1.9億トークン使用、わずか$4.80の追加料金。

---

### 例6: クォータリセット最適化

**目標**: リセット時間に基づいて使用量を分散。

```
Dashboard → Combos → Create New

Name: reset-optimized
Models:
  1. cc/claude-opus-4-5 (5時間リセット、朝に使用)
  2. gc/gemini-3-flash (1K/日、午後に使用)
  3. glm/glm-4.7 (毎日午前10時リセット、夕方に使用)
  4. minimax/MiniMax-M2.1 (5時間ローリング、夜に使用)
  5. if/kimi-k2-thinking (無制限、緊急時)
```

**日課:**
```
08:00 - 13:00: Claude Code (新鮮な5時間クォータ)
13:00 - 18:00: Gemini CLI (1K/日クォータ)
18:00 - 22:00: GLM (翌朝10時リセット)
22:00 - 08:00: MiniMax (5時間ローリング) または iFlow
```

**結果**: 最小コストで24時間コーディング。

---

## CLIツールでコンボを使用

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [ダッシュボードから取得]
  Model: premium-coding
```

### Claude Desktop

`~/.claude/config.json`を編集:
```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key",
  "model": "budget-combo"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex --model quality-first "your prompt"
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [ダッシュボードから取得]
Model: free-combo
```

### APIリクエスト

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [
      {"role": "user", "content": "Write a function to..."}
    ],
    "stream": true
  }'
```

---

## ベストプラクティス

### 1. 常に無料階層を含める

```
✅ 良い:
cc/claude-opus → glm/glm-4.7 → if/kimi-k2-thinking

❌ 悪い:
cc/claude-opus → glm/glm-4.7
(無料フォールバックなし、クォータ切れの可能性)
```

**理由**: 24時間可用性を確保、クォータでブロックされない。

### 2. コスト順に並べる (安価→高価)

```
✅ 良い:
glm/glm-4.7 → minimax/MiniMax-M2.1 → cc/claude-opus

❌ 悪い:
cc/claude-opus → glm/glm-4.7
(シンプルなタスクにサブスクリプションクォータを浪費)
```

**例外**: サブスクリプション価値を最大化したい場合は、サブスクリプションを最初に。

### 3. 品質要件に合わせる

```
本番コードの場合:
cc/claude-opus → cx/gpt-5.2-codex → glm/glm-4.7

クイックタスクの場合:
glm/glm-4.7 → if/kimi-k2-thinking

実験用:
if/kimi-k2-thinking → qw/qwen3-coder-plus
```

### 4. クォータリセット時間を考慮

```
朝のコンボ (新鮮なクォータ):
cc/claude-opus → cx/gpt-5.2-codex

夕方のコンボ (クォータが消費されている可能性):
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/kimi-k2-thinking
```

### 5. 異なるユースケース用に複数のコンボを作成

```
premium-coding: 複雑なタスク用
budget-combo: シンプルなタスク用
free-combo: 実験用
quality-first: 本番コード用
```

**タスク要件に基づいてコンボを切り替え**ます。

### 6. コンボパフォーマンスをモニター

```
Dashboard → Analytics → Combo Usage:
  premium-coding:
    80% cc/claude-opus経由 (良好、サブスクリプション使用)
    15% glm/glm-4.7経由 (許容バックアップ)
    5% minimax経由 (まれなフォールバック)
```

**最適化**: フォールバック使用が多すぎる場合、プライマリクォータを増やすかモデルを並べ替え。

---

## 高度な設定

### コンボごとに予算上限を設定

```
Dashboard → Combos → Edit → Budget:
  Daily limit: $5
  Monthly limit: $50
```

上限に達すると、9Routerは有料モデルをスキップして無料階層のみを使用。

### コンボ内のモデルを有効/無効

```
Dashboard → Combos → Edit → Models:
  ✅ cc/claude-opus-4-5 (有効)
  ❌ glm/glm-4.7 (一時的に無効)
  ✅ if/kimi-k2-thinking (有効)
```

**ユースケース**: コンボを削除せずに高価なモデルを一時的に無効化。

### 既存のコンボを複製

```
Dashboard → Combos → Clone "premium-coding"
→ "-copy" サフィックス付きのコピーを作成
→ 変更して新しいコンボとして保存
```

**ユースケース**: 異なるシナリオ用のバリエーションを作成。

---

## トラブルシューティング

**問題: コンボがモデルリストに表示されない**

**解決策:**
1. ダッシュボードを更新
2. コンボが保存されていることを確認 (緑のチェック)
3. CLIツールを再起動してモデルリストを更新

**問題: コンボが常に最後のモデル (無料階層) を使用**

**解決策:**
1. プライマリモデルのクォータを確認 (Dashboard → Quota)
2. APIキーが有効か確認 (Dashboard → Providers)
3. 予算上限を超えていないか確認

**問題: コンボのコストが予想より高い**

**解決策:**
1. Dashboard → Analytics → コンボ使用量を確認
2. プライマリモデルがクォータ切れか確認
3. モデルを並べ替え (安価を先に)
4. 予算上限を設定

---

## 関連

- [スマートルーティング](./smart-routing.md) - 自動フォールバックの仕組み
- [クォータトラッキング](./quota-tracking.md) - 使用量とコストを監視
