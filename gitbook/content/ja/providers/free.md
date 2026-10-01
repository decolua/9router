# 無料プロバイダー - ゼロコストフォールバック

他のすべてがクォータ制限に達した時の緊急バックアップ。ゼロコストで24時間コーディング!

---

## 概要

無料階層プロバイダーは、サブスクリプションと低価格クォータが消費された時の**フォールバック**:

- 🆓 **iFlow** - 8モデル無料 (Kimi K2、Qwen3、GLM 4.7、MiniMax M2...)
- 🆓 **Qwen** - 3モデル無料 (Qwen3 Coder Plus/Flash、Vision)
- 🆓 **Kiro** - 2モデル無料 (Claude Sonnet 4.5、Haiku 4.5)

**戦略:** 緊急バックアップとして使用。無制限利用、永久ゼロコスト!

---

## iFlow (8つの無料モデル)

### 料金

| プラン | 月額コスト | モデル | クォータ |
|------|--------------|--------|-------|
| FREE | $0 | 8モデル | 無制限 |

**最高の価値:** 無料階層で最も多くのモデル! Kimi K2、Qwen3、GLM、MiniMax、DeepSeek。

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect iFlow
```

**ステップ2: iFlow OAuthログイン**

- 「Connect iFlow」をクリック
- ブラウザが開く → iFlowログインページ
- アカウント作成またはログイン
- 権限を付与
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: if/kimi-k2-thinking
       if/kimi-k2
       if/qwen3-coder-plus
       if/glm-4.7
       if/minimax-m2
       if/deepseek-r1
       if/deepseek-v3.2-chat
       if/deepseek-v3.2-reasoner
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `if/kimi-k2-thinking` | Kimi K2 Thinking | 複雑な推論 |
| `if/kimi-k2` | Kimi K2 | 汎用コーディング |
| `if/qwen3-coder-plus` | Qwen3 Coder Plus | コード生成 |
| `if/glm-4.7` | GLM 4.7 | 中国語 + 英語 |
| `if/minimax-m2` | MiniMax M2 | 長いコンテキスト |
| `if/deepseek-r1` | DeepSeek R1 | 推論タスク |
| `if/deepseek-v3.2-chat` | DeepSeek V3.2 Chat | 会話 |
| `if/deepseek-v3.2-reasoner` | DeepSeek V3.2 Reasoner | 複雑なロジック |

### プロのヒント

- **8モデル無料** - 無料階層で最多種類
- **無制限利用** - クォータ制限なし
- **Kimi K2 Thinking** - 複雑な推論に最適
- **DeepSeek R1** - 強力な推論能力

---

## Qwen (3つの無料モデル)

### 料金

| プラン | 月額コスト | モデル | クォータ |
|------|--------------|--------|-------|
| FREE | $0 | 3モデル | 無制限 |

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect Qwen
```

**ステップ2: デバイスコード認可**

- 「Connect Qwen」をクリック
- ダッシュボードがデバイスコードを表示
- 認可URLを訪問
- デバイスコードを入力
- Qwenアカウントにログイン
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: qw/qwen3-coder-plus
       qw/qwen3-coder-flash
       qw/vision-model
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `qw/qwen3-coder-plus` | Qwen3 Coder Plus | 高度なコーディング |
| `qw/qwen3-coder-flash` | Qwen3 Coder Flash | 高速応答 |
| `qw/vision-model` | Qwen3 Vision | 画像分析 |

### プロのヒント

- **Qwen3 Coder Plus** - 強力なコーディング能力
- **Qwen3 Coder Flash** - クイックタスク用に高速
- **Visionモデル** - 無料画像分析
- **無制限利用** - クォータ制限なし

---

## Kiro (Claude無料)

### 料金

| プラン | 月額コスト | モデル | クォータ |
|------|--------------|--------|-------|
| FREE | $0 | Claude Sonnet 4.5、Haiku 4.5 | 無制限 |

**最高の価値:** 無料Claude! 有料Claude Codeと同じ品質。

### セットアップ

**ステップ1: ダッシュボード経由で接続**

```bash
9router
# Dashboard → Providers → Connect Kiro
```

**ステップ2: AWS Builder IDまたはOAuth**

- 「Connect Kiro」をクリック
- ログイン方法を選択:
  - AWS Builder ID (推奨)
  - Googleアカウント
  - GitHubアカウント
- 権限を付与
- 自動トークン更新有効化

**ステップ3: CLIで使用**

```
Model: kr/claude-sonnet-4.5
       kr/claude-haiku-4.5
```

### 利用可能なモデル

| モデルID | 説明 | 最適用途 |
|----------|-------------|----------|
| `kr/claude-sonnet-4.5` | Claude Sonnet 4.5 | バランスのとれた品質/速度 |
| `kr/claude-haiku-4.5` | Claude Haiku 4.5 | 高速応答 |

### プロのヒント

- **無料Claude** - 有料階層と同じ品質
- **AWS Builder ID** - AWSアカウントで簡単セットアップ
- **無制限利用** - クォータ制限なし
- **最高品質** - Claude 4.5を無料で!

---

## 機能比較

| プロバイダー | モデル | 最高のモデル | セットアップ | クォータ |
|----------|--------|------------|-------|-------|
| **iFlow** | 8 | Kimi K2 Thinking | OAuth | 無制限 |
| **Qwen** | 3 | Qwen3 Coder Plus | デバイスコード | 無制限 |
| **Kiro** | 2 | Claude Sonnet 4.5 | AWS Builder ID | 無制限 |

**勝者:** 種類はiFlow、品質はKiro!

---

## 使用例

### Cursor IDEセットアップ

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9routerダッシュボードから取得]
  Model: if/kimi-k2-thinking
```

### コンボを作成 (推奨)

```
Dashboard → Combos → Create New

Name: free-combo
Models:
  1. if/kimi-k2-thinking (iFlowプライマリ)
  2. qw/qwen3-coder-plus (Qwenバックアップ)
  3. kr/claude-sonnet-4.5 (Kiro品質)

CLIで使用: free-combo
```

**結果:** ゼロコスト、最大アップタイム!

---

## 完全なフォールバック戦略

### 完全な3階層コンボ

```
Dashboard → Combos → Create New

Name: complete-fallback
Models:
  1. gc/gemini-3-flash-preview (無料サブスクリプション)
  2. cc/claude-opus-4-5 (有料サブスクリプション)
  3. glm/glm-4.7 (低価格バックアップ、100万あたり$0.6)
  4. minimax/MiniMax-M2.1 (最安、100万あたり$0.2)
  5. if/kimi-k2-thinking (無料フォールバック)
  6. kr/claude-sonnet-4.5 (無料品質)

CLIで使用: complete-fallback
```

**結果:**
- Tier 1: 無料サブスクリプション (Gemini CLI)
- Tier 2: 有料サブスクリプション (Claude Code)
- Tier 3: 低価格バックアップ (GLM、MiniMax)
- Tier 4: 無料フォールバック (iFlow、Kiro)

**コーディングが止まらない!**

---

## ベストプラクティス

### 1. 緊急バックアップとして使用

```
優先順位:
1. サブスクリプション階層 (有料クォータを最大化)
2. 低価格階層 (100万トークンあたりセント)
3. 無料階層 (無制限、ゼロコスト)

以下の時のみ無料階層を使用:
- サブスクリプションクォータ消費
- 予算上限到達
- テスト/クリティカルでないタスク
```

### 2. 適切なモデルを選択

```
複雑な推論: if/kimi-k2-thinking
高速コーディング: qw/qwen3-coder-flash
最高品質: kr/claude-sonnet-4.5
長いコンテキスト: if/minimax-m2
Visionタスク: qw/vision-model
```

### 3. 無料のみのコンボを作成

```
ゼロコストコーディング用:

Name: zero-cost
Models:
  1. kr/claude-sonnet-4.5 (最高品質)
  2. if/kimi-k2-thinking (複雑なタスク)
  3. qw/qwen3-coder-plus (高速コーディング)

コスト: 永久に$0!
```

### 4. 本番前にテスト

```
無料階層を使用して:
- プロンプトをテスト
- 機能のプロトタイプを作成
- 新しいフレームワークを学ぶ
- クリティカルでないタスク

有料クォータを以下に節約:
- 本番コード
- 複雑なリファクタリング
- クリティカルな機能
```

---

## 実例

### 例1: 学生/学習者 (ゼロ予算)

```
セットアップ:
1. kr/claude-sonnet-4.5 (最高品質)
2. if/kimi-k2-thinking (複雑な推論)
3. qw/qwen3-coder-plus (高速コーディング)

月次コスト: $0
利用: 無制限

最適:
- コーディング学習
- 個人プロジェクト
- 宿題/課題
```

### 例2: フリーランサー (予算意識)

```
セットアップ:
1. gc/gemini-3-flash-preview (月18万無料)
2. glm/glm-4.7 (低価格バックアップ、100万あたり$0.6)
3. if/kimi-k2-thinking (無料フォールバック)

月次コスト: $5〜10
利用: 1億以上のトークン

最適:
- クライアントプロジェクト (有料階層)
- テスト (無料階層)
- 緊急バックアップ
```

### 例3: ヘビーユーザー (すべてを最大化)

```
セットアップ:
1. gc/gemini-3-flash-preview (月18万無料)
2. cc/claude-opus-4-5 (サブスクリプション$20〜100)
3. cx/gpt-5.2-codex (サブスクリプション$20〜200)
4. glm/glm-4.7 (低価格 100万あたり$0.6)
5. minimax/MiniMax-M2.1 (最安 100万あたり$0.2)
6. if/kimi-k2-thinking (無料無制限)
7. kr/claude-sonnet-4.5 (無料品質)

月次コスト: $40〜320 (サブスクリプション) + $10〜20 (低価格階層)
利用: 5億以上のトークン

最適:
- プロフェッショナル開発
- チームプロジェクト
- 24時間コーディング
```

---

## コスト比較

### シナリオ: 月1億トークン

**オプション1: ChatGPT APIのみ**
```
1億 × $20/1M = 月$2,000
```

**オプション2: 9Router無料階層のみ**
```
無料階層経由で1億 = 月$0
節約: 月$2,000 (100%)
```

**オプション3: 9Router完全戦略**
```
Gemini CLI経由で6000万 (無料): $0
Claude Code経由で3000万 (サブスクリプション): $0追加
GLM経由で800万 (低価格): $4.80
iFlow経由で200万 (無料): $0
合計: 月$4.80 + すでに持っているサブスクリプション
節約: 月$1,995 (99.76%)
```

---

## トラブルシューティング

### "OAuth failed"

**解決策:**
- インターネット接続を確認
- 別のブラウザを試す
- ブラウザキャッシュをクリア
- ダッシュボードで再接続

### "モデルが利用不可"

**解決策:**
- ダッシュボードでプロバイダーが接続されているか確認
- OAuthトークンが有効か確認
- 必要に応じてプロバイダーを再接続

### "応答が遅い"

**解決策:**
- 無料階層は優先度が低い可能性
- ピーク外時間に使用
- 別の無料プロバイダーへ切替
- 速度のため低価格階層へアップグレード

---

## 制限事項

### 無料階層の考慮事項

- **速度** - 有料階層より遅い可能性
- **優先度** - ピーク時間中は優先度が低い
- **レート制限** - レート制限の可能性 (ただしクォータは無制限)
- **可用性** - 時折ダウンタイムがある可能性

**解決策:** 信頼性のため3階層フォールバック戦略を使用!

---

## 次のステップ

- **サブスクリプションをセットアップ:** [サブスクリプションプロバイダー](./subscription.md)
- **低価格バックアップを追加:** [低価格プロバイダー](./cheap.md)
- **コンボを作成:** Dashboard → Combos → Create New
- **コーディング開始:** 最大の信頼性のため `complete-fallback` コンボを使用
