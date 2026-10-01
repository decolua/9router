# サブスクリプションプロバイダー - 価値を最大化

スマートクォータトラッキングと自動フォールバックで既存のAIサブスクリプションを最大化。リセット前にサブスクリプションを余すことなく使用しましょう!

---

## 概要

サブスクリプション階層プロバイダーは**プライマリ**選択です - すでに支払っているので、完全な価値を引き出しましょう:

- ✅ **Claude Code** (Pro/Max) - Claude 4.5 Opus/Sonnet/Haiku
- ✅ **OpenAI Codex** (Plus/Pro) - GPT 5.2 Codex、GPT 5.1 Codex Max
- ✅ **Gemini CLI** (無料階層!) - 月18万コンプリーション
- ✅ **GitHub Copilot** - GPT-5、Claude 4.5、Gemini 3
- ✅ **Antigravity** (Google) - Gemini 3 Pro、Claude Sonnet 4.5

**戦略:** これらを最初に使用、クォータをリアルタイムで追跡、消費時に低価格/無料へフォールバック。

---

## Claude Code (Pro/Max)

### 料金

| プラン | 月額コスト | クォータリセット | モデル |
|------|--------------|-------------|--------|
| Pro | $20 | 5時間 + 週次 | Opus、Sonnet、Haiku |
| Max | $100 | 5時間 + 週次 | Opus、Sonnet、Haiku |

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard開く → Providers → Connect Claude Code
```

**ステップ2: OAuthログイン**

- 「Connect Claude Code」をクリック
- ブラウザが開く → Claude.aiにログイン
- 自動トークン更新有効化
- クォータトラッキング開始

**ステップ3: CLIで使用**

```
Model: cc/claude-opus-4-5-20251101
       cc/claude-sonnet-4-5-20250929
       cc/claude-haiku-4-5-20251001
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `cc/claude-opus-4-5-20251101` | Claude 4.5 Opus | 複雑なタスク、アーキテクチャ |
| `cc/claude-sonnet-4-5-20250929` | Claude 4.5 Sonnet | バランスのとれた速度/品質 |
| `cc/claude-haiku-4-5-20251001` | Claude 4.5 Haiku | 高速応答 |

### プロのヒント

- **複雑なタスクにOpusを使用** - アーキテクチャ決定、リファクタリング
- **速度にSonnetを使用** - クイック編集、コード生成
- **モデルごとのクォータを追跡** - ダッシュボードがモデルごとの使用量を表示
- **5時間リセット** - 5時間ごとの新鮮なクォータ + 週次リセット

---

## OpenAI Codex (Plus/Pro)

### 料金

| プラン | 月額コスト | クォータリセット | モデル |
|------|--------------|-------------|--------|
| Plus | $20 | 5時間 + 週次 | GPT 5.2、GPT 5.1 |
| Pro | $200 | 5時間 + 週次 | GPT 5.2 Codex、GPT 5.1 Max |

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect Codex
```

**ステップ2: OAuthログイン**

- 「Connect Codex」をクリック
- ブラウザが `http://localhost:1455` を開く
- OpenAIアカウントにログイン
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: cx/gpt-5.2-codex
       cx/gpt-5.1-codex-max
       cx/gpt-5.2
       cx/gpt-5.1-codex
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `cx/gpt-5.2-codex` | GPT 5.2 Codex | 最新コーディングモデル |
| `cx/gpt-5.1-codex-max` | GPT 5.1 Codex Max | 最大コンテキスト |
| `cx/gpt-5.2` | GPT 5.2 | 汎用タスク |
| `cx/gpt-5.1-codex` | GPT 5.1 Codex | 安定したコーディング |

### プロのヒント

- **5時間ローリングクォータ** - 5時間ごとに新鮮なクォータ
- **週次リセット** - 週次フルクォータリセット
- **Pro階層** - Plusの10倍のクォータ

---

## Gemini CLI (月18万無料!)

### 料金

| プラン | 月額コスト | クォータ | リセット |
|------|--------------|-------|-------|
| FREE | $0 | 月18万コンプリーション + 1K/日 | 日次 + 月次 |

**最高の価値:** 巨大な無料階層! 有料階層の前にこれを使用。

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect Gemini CLI
```

**ステップ2: Google OAuth**

- 「Connect Gemini CLI」をクリック
- ブラウザが開く → Googleアカウントにログイン
- 権限を付与
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: gc/gemini-3-flash-preview
       gc/gemini-3-pro-preview
       gc/gemini-2.5-pro
       gc/gemini-2.5-flash
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `gc/gemini-3-flash-preview` | Gemini 3 Flash Preview | 高速応答 |
| `gc/gemini-3-pro-preview` | Gemini 3 Pro Preview | 複雑なタスク |
| `gc/gemini-2.5-pro` | Gemini 2.5 Pro | 安定した本番 |
| `gc/gemini-2.5-flash` | Gemini 2.5 Flash | クイックタスク |

### プロのヒント

- **月18万コンプリーション** - 巨大な無料階層
- **1K/日制限** - 日次クォータは深夜にリセット
- **最初に使用** - 無料階層、有料サブスクリプションの前に使用
- **クレジットカード不要** - Googleアカウントで完全無料

---

## GitHub Copilot

### 料金

| プラン | 月額コスト | クォータリセット | モデル |
|------|--------------|-------------|--------|
| Individual | $10 | 月次 (1日) | GPT-5、Claude 4.5、Gemini 3 |
| Business | $19 | 月次 (1日) | GPT-5、Claude 4.5、Gemini 3 |

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect GitHub
```

**ステップ2: GitHub経由のOAuth**

- 「Connect GitHub」をクリック
- ブラウザが開く → GitHubにログイン
- GitHub Copilotを認可
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: gh/gpt-5
       gh/gpt-5.1-codex-max
       gh/claude-4.5-sonnet
       gh/gemini-3-pro
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `gh/gpt-5` | GPT-5 | 最新OpenAIモデル |
| `gh/gpt-5.1-codex-max` | GPT-5.1 Codex Max | 最大コンテキスト |
| `gh/claude-4.5-sonnet` | Claude 4.5 Sonnet | Anthropic品質 |
| `gh/gemini-3-pro` | Gemini 3 Pro | Google品質 |

### プロのヒント

- **月次リセット** - 月1日にフルクォータリセット
- **複数モデル** - 一つのサブスクリプションでGPT、Claude、Geminiにアクセス
- **Business階層** - チーム用の高クォータ

---

## Antigravity (Googleアカウント)

### 料金

| プラン | 月額コスト | クォータ | モデル |
|------|--------------|-------|--------|
| FREE | $0 | Gemini CLIと同様 | Gemini 3 Pro、Claude Sonnet 4.5 |

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect Antigravity
```

**ステップ2: Google OAuth**

- 「Connect Antigravity」をクリック
- ブラウザが開く → Googleアカウントにログイン
- 権限を付与
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: ag/gemini-3-pro-high
       ag/claude-sonnet-4-5
       ag/claude-opus-4-5-thinking
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `ag/gemini-3-pro-high` | Gemini 3 Pro High | 高品質応答 |
| `ag/claude-sonnet-4-5` | Claude Sonnet 4.5 | Anthropic品質 |
| `ag/claude-opus-4-5-thinking` | Claude Opus 4.5 Thinking | 複雑な推論 |

### プロのヒント

- **無料階層** - Googleアカウントでコストなし
- **Claudeアクセス** - 無料Claude Sonnet/Opus
- **Gemini CLIと同様のクォータ** - 日次/月次制限

---

## 料金比較

| プロバイダー | 月額コスト | クォータリセット | 価値 |
|----------|--------------|-------------|-------|
| **Claude Code Pro** | $20 | 5時間 + 週次 | ⭐⭐⭐⭐⭐ 最高品質 |
| **Claude Code Max** | $100 | 5時間 + 週次 | ⭐⭐⭐⭐⭐ 最高クォータ |
| **Codex Plus** | $20 | 5時間 + 週次 | ⭐⭐⭐⭐ 良い価値 |
| **Codex Pro** | $200 | 5時間 + 週次 | ⭐⭐⭐⭐⭐ 10×クォータ |
| **Gemini CLI** | **$0** | 日次 + 月次 | ⭐⭐⭐⭐⭐ 月18万無料! |
| **GitHub Copilot** | $10〜19 | 月次 (1日) | ⭐⭐⭐⭐ マルチモデル |
| **Antigravity** | **$0** | 日次 + 月次 | ⭐⭐⭐⭐ 無料Claude! |

---

## 使用例

### Cursor IDEセットアップ

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9routerダッシュボードから取得]
  Model: cc/claude-opus-4-5-20251101
```

### コンボを作成 (推奨)

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. gc/gemini-3-flash-preview (無料、最初に使用)
  2. cc/claude-opus-4-5-20251101 (サブスクリプション)
  3. cx/gpt-5.2-codex (サブスクリプションバックアップ)

CLIで使用: premium-coding
```

**結果:** 無料階層を最大化 → サブスクリプションを使用 → 自動フォールバック

---

## クォータトラッキング

9Routerはクォータをリアルタイムで追跡:

- **トークン消費** - リクエストごとの入出力トークン
- **リセットカウントダウン** - 次のクォータリセットまでの時間
- **使用量パーセンテージ** - クォータの使用量
- **自動フォールバック** - 消費時に次の階層へ切替

**ダッシュボード表示:**

```
Claude Code Pro
├─ Quota: 75% used
├─ Reset: 2h 15m (5-hour)
├─ Weekly reset: 3 days
└─ Fallback: glm/glm-4.7 (cheap tier)
```

---

## ベストプラクティス

### 1. 無料階層を最初に使用

```
優先順位:
1. Gemini CLI (月18万無料)
2. Antigravity (無料Claude)
3. Claude Code/Codex (有料サブスクリプション)
```

### 2. クォータを毎日追跡

- 毎朝ダッシュボードを確認
- クォータリセットに合わせて重いタスクを計画
- クリティカルでないタスクには低価格/無料階層を使用

### 3. スマートコンボを作成

```
コンボ例:
1. gc/gemini-3-flash-preview (無料プライマリ)
2. cc/claude-opus-4-5 (複雑なタスク)
3. glm/glm-4.7 (低価格バックアップ)
4. if/kimi-k2-thinking (無料フォールバック)
```

### 4. 時間別に最適化

```
朝: 新鮮な5時間クォータ (Claude/Codex)
午後: Gemini CLI (1K/日)
夕方: サブスクリプションクォータ
夜: 低価格/無料階層
```

---

## トラブルシューティング

### 「クォータ消費」

**解決策:**
- ダッシュボードクォータトラッカーを確認
- リセットを待つ (5時間または日次)
- 低価格/無料階層へのコンボフォールバックを使用

### 「OAuthトークン期限切れ」

**解決策:**
- 9Routerにより自動更新
- 問題がある場合: Dashboard → Provider → Reconnect

### 「レート制限」

**解決策:**
- サブスクリプションクォータ切れ
- フォールバックを追加: `cc/claude-opus → glm/glm-4.7`
- 無料階層を使用: `if/kimi-k2-thinking`

---

## 次のステップ

- **低価格バックアップをセットアップ:** [低価格プロバイダー](./cheap.md)
- **無料フォールバックを追加:** [無料プロバイダー](./free.md)
- **コンボを作成:** Dashboard → Combos → Create New
