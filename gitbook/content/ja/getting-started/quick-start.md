# はじめに

9Routerを5分で起動し、AIリクエストをインテリジェントにルーティングし始めましょう。

---

## クイックスタート

### 1. インストール

```bash
npm install -g 9router
```

**要件:** Node.js 20+ ([インストール詳細](getting-started/installation.md))

### 2. 起動

```bash
9router
```

🎉 **ダッシュボードが自動的に開きます** (`http://localhost:20128`)

- デフォルトパスワード: `123456` (ダッシュボードで変更)
- APIキーは自動生成
- プロバイダー接続の準備完了

### 3. プロバイダーを接続

プロバイダーを接続する方法は3つあります:

#### オプションA: OAuth(サブスクリプションプロバイダー)

**最適:** Claude Code、Codex、Gemini CLI、GitHub Copilot

```
Dashboard → Providers → Connect [Provider]
→ OAuthログイン → トークン自動更新
→ クォータトラッキング有効化
```

**例: Claude Code**
1. 「Connect Claude Code」をクリック
2. Claudeアカウントでログイン
3. 9Routerを認可
4. ✅ 完了! モデルを使用: `cc/claude-opus-4-5-20251101`

#### オプションB: APIキー(低価格プロバイダー)

**最適:** GLM、MiniMax、Kimi、OpenRouter

```
Dashboard → Providers → Add API Key
→ プロバイダーを選択
→ APIキーを貼り付け
→ 保存
```

**例: GLM-4.7**
1. [Zhipu AI](https://open.bigmodel.cn/)でサインアップ
2. Coding PlanからAPIキーを取得
3. Dashboard → Add API Key → Provider: `glm` → キーを貼り付け
4. ✅ 完了! モデルを使用: `glm/glm-4.7`

#### オプションC: 無料プロバイダー(コストなし)

**最適:** iFlow、Qwen、Kiro

```
Dashboard → Providers → Connect [Free Provider]
→ デバイスコードまたはOAuth
→ 無制限利用
```

**例: iFlow**
1. 「Connect iFlow」をクリック
2. iFlowアカウントでログイン
3. 認可
4. ✅ 完了! 8モデルを使用: `if/kimi-k2-thinking`、`if/qwen3-coder-plus`など

---

## 4. CLIツールで使用

コーディングツールを9Routerに向けます:

### Cursor IDE

```
Settings → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9routerダッシュボードから取得]
  Model: cc/claude-opus-4-5-20251101
```

### Claude Desktop

`~/.claude/config.json`を編集:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Cline / Continue / RooCode

```
Provider: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [ダッシュボードから取得]
Model: cc/claude-opus-4-5-20251101
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

---

## 5. スマートコンボを作成(オプション)

コンボはモデル間の自動フォールバックを可能にします:

```
Dashboard → Combos → Create New

Name: premium-coding
Models:
  1. cc/claude-opus-4-5-20251101 (サブスクリプション優先)
  2. glm/glm-4.7 (低価格バックアップ、100万あたり$0.6)
  3. if/kimi-k2-thinking (無料フォールバック)

CLIで使用: premium-coding
```

**動作:**
1. 最初にClaude Opusを試行(サブスクリプション)
2. クォータ消費時 → GLM-4.7(超低価格)
3. 予算上限時 → iFlow(無料)
4. ダウンタイムゼロ、自動切替!

---

## 利用可能なモデル

### サブスクリプションモデル(最初に最大化)

**Claude Code (`cc/`)** - Pro/Maxサブスクリプション:
- `cc/claude-opus-4-5-20251101` - Claude 4.5 Opus
- `cc/claude-sonnet-4-5-20250929` - Claude 4.5 Sonnet
- `cc/claude-haiku-4-5-20251001` - Claude 4.5 Haiku

**Codex (`cx/`)** - Plus/Proサブスクリプション:
- `cx/gpt-5.2-codex` - GPT 5.2 Codex
- `cx/gpt-5.1-codex-max` - GPT 5.1 Codex Max

**Gemini CLI (`gc/`)** - 月18万無料:
- `gc/gemini-3-flash-preview` - Gemini 3 Flash Preview
- `gc/gemini-2.5-pro` - Gemini 2.5 Pro

**GitHub Copilot (`gh/`)** - サブスクリプション:
- `gh/gpt-5` - GPT-5
- `gh/claude-4.5-sonnet` - Claude 4.5 Sonnet

### 低価格モデル(バックアップ)

**GLM (`glm/`)** - 100万あたり$0.6/$2.2:
- `glm/glm-4.7` - GLM 4.7(毎日午前10時リセット)

**MiniMax (`minimax/`)** - 100万あたり$0.20/$1.00:
- `minimax/MiniMax-M2.1` - MiniMax M2.1(5時間リセット)

**Kimi (`kimi/`)** - 月$9(1000万トークン):
- `kimi/kimi-latest` - Kimi Latest

### 無料モデル(緊急時)

**iFlow (`if/`)** - 8モデル無料:
- `if/kimi-k2-thinking` - Kimi K2 Thinking
- `if/qwen3-coder-plus` - Qwen3 Coder Plus
- `if/glm-4.7` - GLM 4.7
- `if/deepseek-r1` - DeepSeek R1

**Qwen (`qw/`)** - 3モデル無料:
- `qw/qwen3-coder-plus` - Qwen3 Coder Plus
- `qw/qwen3-coder-flash` - Qwen3 Coder Flash

**Kiro (`kr/`)** - 2モデル無料:
- `kr/claude-sonnet-4.5` - Claude Sonnet 4.5
- `kr/claude-haiku-4.5` - Claude Haiku 4.5

---

## コスト最適化戦略

### 月予算: $10〜20/月

```
1. クイックタスクにGemini CLI無料プラン(月18万)を使用
2. Claude Codeサブスクリプションのクォータを完全利用(すでに支払い済み)
3. クォータ切れ時はGLM(100万あたり$0.6)へフォールバック
4. 緊急時: MiniMax M2.1(100万あたり$0.20)またはiFlow(無料)

実例(月1億トークン):
  Gemini CLI経由で6000万: $0(無料プラン)
  Claude Code経由で3000万: $0(既存サブスクリプション)
  GLM経由で800万: $4.80
  MiniMax経由で200万: $0.40
  合計: 月$5.20 + 既存サブスクリプション
```

### クォータリセット戦略

```
日課:
1. 朝: Claude Codeの新しいクォータ(5時間リセット)
2. 午後: Gemini CLIへ切替(1K/日)
3. 夕方: GLM日次クォータ(翌朝10時リセット)
4. 深夜: MiniMax(5時間ローリング)またはiFlow(無料)

→ 最小の追加コストで24時間コーディング!
```

---

## 次のステップ

- [インストール詳細](getting-started/installation.md) - 要件、トラブルシューティング
- [機能](features/) - クォータトラッキング、コンボ、デプロイを確認
- [FAQ](faq.md) - よくある質問と回答
- [トラブルシューティング](troubleshooting.md) - 一般的な問題の修正

---

## ヘルプが必要?

- **ウェブサイト**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
