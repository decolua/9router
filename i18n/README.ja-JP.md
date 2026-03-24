<div align="center">
  <img src="../images/9router.png?1" alt="9Router Dashboard" width="800"/>

  # 9Router - 無料 AI ルーター

  **コーディングを止めない。スマートフォールバックで無料＆格安AIモデルに自動ルーティング。**

  **すべてのAIコーディングツール（Claude Code、Cursor、Antigravity、Copilot、Codex、Gemini、OpenCode、Cline、OpenClaw...）を40以上のAIプロバイダーと100以上のモデルに接続。**

  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

  [🚀 クイックスタート](#-クイックスタート) • [💡 機能](#-主な機能) • [📖 セットアップ](#-セットアップガイド) • [🌐 ウェブサイト](https://9router.com)

  [🇻🇳 Tiếng Việt](./README.vi.md) • [🇨🇳 中文](./README.zh-CN.md) • [🇯🇵 日本語](./README.ja-JP.md)
</div>

---

## 🤔 なぜ9Router？

**お金の無駄遣いと制限に悩まされるのはもう終わりです：**

- ❌ サブスクリプションのクオータが毎月未使用のまま期限切れ
- ❌ レート制限でコーディング中に停止
- ❌ 高額なAPI（プロバイダーごとに月額$20〜50）
- ❌ プロバイダー間の手動切り替え

**9Routerが解決します：**

- ✅ **サブスクリプションを最大化** - クオータを追跡し、リセット前にすべて使い切る
- ✅ **自動フォールバック** - サブスクリプション → 格安 → 無料、ダウンタイムゼロ
- ✅ **マルチアカウント** - プロバイダーごとにアカウント間でラウンドロビン
- ✅ **ユニバーサル** - Claude Code、Codex、Gemini CLI、Cursor、Cline、あらゆるCLIツールに対応

---

## 🔄 仕組み

```
┌─────────────┐
│  あなたの    │  （Claude Code、Codex、Gemini CLI、OpenClaw、Cursor、Cline...）
│   CLIツール  │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────┐
│        9Router（スマートルーター）        │
│  • フォーマット変換（OpenAI ↔ Claude）   │
│  • クオータ追跡                          │
│  • 自動トークンリフレッシュ               │
└──────┬──────────────────────────────────┘
       │
       ├─→ [Tier 1: サブスクリプション] Claude Code、Codex、Gemini CLI
       │   ↓ クオータ消費済み
       ├─→ [Tier 2: 格安] GLM ($0.6/1M)、MiniMax ($0.2/1M)
       │   ↓ 予算上限
       └─→ [Tier 3: 無料] iFlow、Qwen、Kiro（無制限）

結果: コーディングが止まらない、最小コスト
```

---

## ⚡ クイックスタート

**1. グローバルインストール：**

```bash
npm install -g 9router
9router
```

🎉 ダッシュボードが `http://localhost:20128` で開きます

**2. 無料プロバイダーを接続（サインアップ不要）：**

ダッシュボード → Providers → **Claude Code** または **Antigravity** を接続 → OAuthログイン → 完了！

**3. CLIツールで使用：**

```
Claude Code/Codex/Gemini CLI/OpenClaw/Cursor/Clineの設定:
  エンドポイント: http://localhost:20128/v1
  APIキー: [ダッシュボードからコピー]
  モデル: if/kimi-k2-thinking
```

**これだけです！** 無料AIモデルでコーディングを始めましょう。

**代替方法: ソースから実行（このリポジトリ）：**

このリポジトリパッケージはプライベート（`9router-app`）のため、ソース/Docker実行がローカル開発の想定パスです。

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

本番モード：

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

デフォルトURL：
- ダッシュボード: `http://localhost:20128/dashboard`
- OpenAI互換API: `http://localhost:20128/v1`

---

## 🎥 動画チュートリアル

<div align="center">

### 📺 完全セットアップガイド - 9Router + Claude Code 無料

[![9Router + Claude Code Setup](https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg)](https://www.youtube.com/watch?v=raEyZPg5xE0)

**🎬 ステップバイステップのチュートリアルを視聴：**
- ✅ 9Routerのインストールとセットアップ
- ✅ 無料Claude Sonnet 4.5の設定
- ✅ Claude Codeとの統合
- ✅ ライブコーディングデモ

**⏱️ 所要時間:** 20分 | **👥 作成:** Developer Community

[▶️ YouTubeで視聴](https://www.youtube.com/watch?v=o3qYCyjrFYg)

</div>

---

## 🛠️ 対応CLIツール

9Routerはすべての主要AIコーディングツールとシームレスに連携します：

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 対応プロバイダー

### 🔐 OAuthプロバイダー

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 無料プロバイダー

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/iflow.png" width="70" alt="iFlow"/><br/>
        <b>iFlow AI</b><br/>
        <sub>8以上のモデル • 無制限</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/qwen.png" width="70" alt="Qwen"/><br/>
        <b>Qwen Code</b><br/>
        <sub>3以上のモデル • 無制限</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini-cli.png" width="70" alt="Gemini CLI"/><br/>
        <b>Gemini CLI</b><br/>
        <sub>月18万回無料</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude • 無制限</sub>
      </td>
    </tr>
  </table>
</div>

### 🔑 APIキープロバイダー（40以上）

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...その他Nebius、Chutes、Hyperbolic、カスタムOpenAI/Anthropic互換エンドポイントなど20以上のプロバイダー</i></p>
</div>

---

## 💡 主な機能

| 機能 | 概要 | メリット |
|------|------|----------|
| 🎯 **スマート3段階フォールバック** | 自動ルーティング: サブスクリプション → 格安 → 無料 | コーディングが止まらない、ダウンタイムゼロ |
| 📊 **リアルタイムクオータ追跡** | ライブトークン数 + リセットカウントダウン | サブスクリプション価値の最大化 |
| 🔄 **フォーマット変換** | OpenAI ↔ Claude ↔ Gemini シームレス対応 | あらゆるCLIツールで動作 |
| 👥 **マルチアカウント対応** | プロバイダーごとに複数アカウント | 負荷分散 + 冗長性 |
| 🔄 **自動トークンリフレッシュ** | OAuthトークンの自動更新 | 手動再ログイン不要 |
| 🎨 **カスタムコンボ** | 無制限のモデル組み合わせ作成 | ニーズに合わせたフォールバック |
| 📝 **リクエストログ** | リクエスト/レスポンスの完全ログ | 問題の簡単なトラブルシューティング |
| 💾 **クラウド同期** | デバイス間で設定を同期 | どこでも同じセットアップ |
| 📊 **使用状況分析** | トークン、コスト、トレンドの追跡 | 支出の最適化 |
| 🌐 **どこでもデプロイ** | Localhost、VPS、Docker、Cloudflare Workers | 柔軟なデプロイオプション |

<details>
<summary><b>📖 機能詳細</b></summary>

### 🎯 スマート3段階フォールバック

自動フォールバック付きコンボを作成：

```
コンボ: "my-coding-stack"
  1. cc/claude-opus-4-6        (サブスクリプション)
  2. glm/glm-4.7               (格安バックアップ、$0.6/1M)
  3. if/kimi-k2-thinking       (無料フォールバック)

→ クオータ切れやエラー発生時に自動切り替え
```

### 📊 リアルタイムクオータ追跡

- プロバイダーごとのトークン消費量
- リセットカウントダウン（5時間、日次、週次）
- 有料ティアのコスト見積もり
- 月間支出レポート

### 🔄 フォーマット変換

フォーマット間のシームレスな変換：
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **OpenAI Responses**
- CLIツールがOpenAIフォーマットで送信 → 9Routerが変換 → プロバイダーがネイティブフォーマットで受信
- カスタムOpenAIエンドポイントをサポートするすべてのツールで動作

### 👥 マルチアカウント対応

- プロバイダーごとに複数アカウント追加
- 自動ラウンドロビンまたは優先度ベースのルーティング
- 1つのアカウントがクオータに達したら次のアカウントにフォールバック

### 🔄 自動トークンリフレッシュ

- OAuthトークンが期限切れ前に自動リフレッシュ
- 手動の再認証不要
- すべてのプロバイダーでシームレスな体験

### 🎨 カスタムコンボ

- 無制限のモデル組み合わせ作成
- サブスクリプション、格安、無料ティアを混合
- コンボに名前を付けて簡単にアクセス
- クラウド同期でデバイス間でコンボを共有

### 📝 リクエストログ

- デバッグモードでリクエスト/レスポンスの完全ログ
- API呼び出し、ヘッダー、ペイロードの追跡
- 統合の問題をトラブルシューティング
- 分析用にログをエクスポート

### 💾 クラウド同期

- デバイス間でプロバイダー、コンボ、設定を同期
- 自動バックグラウンド同期
- 安全な暗号化ストレージ
- どこからでもセットアップにアクセス

#### クラウドランタイムに関する注意

- 本番環境ではサーバーサイドのクラウド変数を推奨：
  - `BASE_URL`（同期スケジューラで使用される内部コールバックURL）
  - `CLOUD_URL`（クラウド同期エンドポイントのベースURL）
- `NEXT_PUBLIC_BASE_URL` と `NEXT_PUBLIC_CLOUD_URL` は互換性/UI用にまだサポートされていますが、サーバーランタイムは `BASE_URL`/`CLOUD_URL` を優先します。
- クラウド同期リクエストはタイムアウト + フェイルファスト動作を使用し、クラウドDNS/ネットワークが利用できない場合のUIハングを回避します。

### 📊 使用状況分析

- プロバイダーおよびモデルごとのトークン使用量追跡
- コスト見積もりと支出トレンド
- 月次レポートとインサイト
- AI支出の最適化

> **💡 重要 - ダッシュボードのコストについて：**
>
> 使用状況分析に表示される「コスト」は**追跡と比較目的のみ**です。
> 9Router自体は**一切課金しません**。有料サービスを使用する場合のみ、プロバイダーに直接支払います。
>
> **例:** ダッシュボードにiFlowモデルの使用で「合計コスト$290」と表示されている場合、
> これは有料APIを直接使用した場合に支払うであろう金額を表しています。実際のコスト = **$0**（iFlowは無料無制限）。
>
> これは無料モデルや9Router経由のルーティングでどれだけ節約しているかを示す「節約トラッカー」と考えてください！

### 🌐 どこでもデプロイ

- 💻 **ローカルホスト** - デフォルト、オフラインで動作
- ☁️ **VPS/クラウド** - デバイス間で共有
- 🐳 **Docker** - ワンコマンドデプロイ
- 🚀 **Cloudflare Workers** - グローバルエッジネットワーク

</details>

---

## 💰 料金の概要

| ティア | プロバイダー | コスト | クオータリセット | 最適な用途 |
|--------|-------------|--------|-----------------|------------|
| **💳 サブスクリプション** | Claude Code (Pro) | $20/月 | 5時間 + 週次 | 既存のサブスク利用者 |
| | Codex (Plus/Pro) | $20-200/月 | 5時間 + 週次 | OpenAIユーザー |
| | Gemini CLI | **無料** | 月18万回 + 日1千回 | 全員！ |
| | GitHub Copilot | $10-19/月 | 月次 | GitHubユーザー |
| **💰 格安** | GLM-4.7 | $0.6/1M | 毎日午前10時 | 予算バックアップ |
| | MiniMax M2.1 | $0.2/1M | 5時間ローリング | 最安オプション |
| | Kimi K2 | $9/月固定 | 月1000万トークン | 予測可能なコスト |
| **🆓 無料** | iFlow | $0 | 無制限 | 8モデル無料 |
| | Qwen | $0 | 無制限 | 3モデル無料 |
| | Kiro | $0 | 無制限 | Claude無料 |

**💡 プロのヒント:** Gemini CLI（月18万回無料）+ iFlow（無制限無料）のコンボで $0 のコスト！

---

### 📊 9Routerのコストと課金について

**9Routerの課金の実態：**

✅ **9Routerソフトウェア = 永久無料**（オープンソース、課金なし）
✅ **ダッシュボードの「コスト」= 表示/追跡のみ**（実際の請求ではない）
✅ **プロバイダーに直接支払い**（サブスクリプションまたはAPI料金）
✅ **無料プロバイダーは無料のまま**（iFlow、Kiro、Qwen = $0 無制限）
❌ **9Routerは請求書を送ったり**カードに課金したりしません

**コスト表示の仕組み：**

ダッシュボードは有料APIを直接使用した場合の**推定コスト**を表示します。これは**課金ではなく**、節約額を示す比較ツールです。

**シナリオ例：**
```
ダッシュボード表示:
• 合計リクエスト: 1,662
• 合計トークン: 4700万
• 表示コスト: $290

実際の確認:
• プロバイダー: iFlow（無料無制限）
• 実際の支払い: $0.00
• $290の意味: 無料モデルの使用で節約した金額！
```

**支払いルール：**
- **サブスクリプションプロバイダー**（Claude Code、Codex）：各ウェブサイトで直接支払い
- **格安プロバイダー**（GLM、MiniMax）：直接支払い、9Routerはルーティングのみ
- **無料プロバイダー**（iFlow、Kiro、Qwen）：本当に永久無料、隠れた料金なし
- **9Router**：一切課金しない

---

## 🎯 ユースケース

### ケース1: 「Claude Proサブスクリプションを持っている」

**問題:** クオータが未使用のまま期限切れ、重いコーディング中にレート制限

**解決策:**
```
コンボ: "maximize-claude"
  1. cc/claude-opus-4-6        (サブスクリプションを最大限活用)
  2. glm/glm-4.7               (クオータ切れ時の格安バックアップ)
  3. if/kimi-k2-thinking       (無料の緊急フォールバック)

月額コスト: $20 (サブスクリプション) + ~$5 (バックアップ) = 合計$25
vs. $20 + 制限に引っかかる = フラストレーション
```

### ケース2: 「コストゼロにしたい」

**問題:** サブスクリプションを払えない、信頼性のあるAIコーディングが必要

**解決策:**
```
コンボ: "free-forever"
  1. gc/gemini-3-flash         (月18万回無料)
  2. if/kimi-k2-thinking       (無制限無料)
  3. qw/qwen3-coder-plus       (無制限無料)

月額コスト: $0
品質: 本番対応モデル
```

### ケース3: 「24時間365日コーディング、中断なし」

**問題:** 締め切り、ダウンタイムは許されない

**解決策:**
```
コンボ: "always-on"
  1. cc/claude-opus-4-6        (最高品質)
  2. cx/gpt-5.2-codex          (セカンドサブスクリプション)
  3. glm/glm-4.7               (格安、毎日リセット)
  4. minimax/MiniMax-M2.1      (最安、5時間リセット)
  5. if/kimi-k2-thinking       (無料無制限)

結果: 5層のフォールバック = ダウンタイムゼロ
月額コスト: $20-200 (サブスクリプション) + $10-20 (バックアップ)
```

### ケース4: 「OpenClawで無料AIを使いたい」

**問題:** メッセージングアプリ（WhatsApp、Telegram、Slack...）でAIアシスタントが必要、完全無料で

**解決策:**
```
コンボ: "openclaw-free"
  1. if/glm-4.7                (無制限無料)
  2. if/minimax-m2.1           (無制限無料)
  3. if/kimi-k2-thinking       (無制限無料)

月額コスト: $0
アクセス方法: WhatsApp、Telegram、Slack、Discord、iMessage、Signal...
```

---

## ❓ よくある質問

<details>
<summary><b>📊 ダッシュボードに高額なコストが表示されるのはなぜ？</b></summary>

ダッシュボードはトークン使用量を追跡し、有料APIを直接使用した場合の**推定コスト**を表示します。これは**実際の課金ではなく**、9Routerを通じて無料モデルや既存のサブスクリプションを使用することでどれだけ節約しているかを示すための参考値です。

**例：**
- **ダッシュボード表示:** 「合計コスト$290」
- **実際:** iFlow（無料無制限）を使用中
- **実際のコスト:** **$0.00**
- **$290の意味:** 有料APIの代わりに無料モデルを使用して**節約した**金額！

コスト表示は使用パターンと最適化の機会を理解するための「節約トラッカー」です。

</details>

<details>
<summary><b>💳 9Routerに課金されますか？</b></summary>

**いいえ。** 9Routerはあなたのコンピューター上で動作する無料のオープンソースソフトウェアです。一切課金しません。

**支払い先：**
- ✅ **サブスクリプションプロバイダー**（Claude Code $20/月、Codex $20-200/月）→ 各ウェブサイトで直接支払い
- ✅ **格安プロバイダー**（GLM、MiniMax）→ 直接支払い、9Routerはリクエストをルーティングするだけ
- ❌ **9Router自体** → **一切課金しない**

9Routerはローカルプロキシ/ルーターです。クレジットカード情報を持たず、請求書を送信できず、課金システムもありません。完全に無料のソフトウェアです。

</details>

<details>
<summary><b>🆓 無料プロバイダーは本当に無制限ですか？</b></summary>

**はい！** 無料と表示されているプロバイダー（iFlow、Kiro、Qwen）は本当に無制限で**隠れた料金はありません**。

これらは各企業が提供する無料サービスです：
- **iFlow**: OAuth経由で8以上のモデルに無料無制限アクセス
- **Kiro**: AWS Builder ID経由で無料無制限Claudeモデル
- **Qwen**: デバイス認証経由でQwenモデルに無料無制限アクセス

9Routerはリクエストをルーティングするだけで、「罠」や将来の課金はありません。本当に無料のサービスであり、9Routerはフォールバックサポートでそれらを使いやすくしています。

**注意:** 一部のサブスクリプションプロバイダー（Antigravity、GitHub Copilot）には無料プレビュー期間があり、後に有料になる可能性がありますが、それは9Routerではなく各プロバイダーから明確に告知されます。

</details>

<details>
<summary><b>💰 実際のAIコストを最小化するには？</b></summary>

**無料優先戦略：**

1. **100%無料コンボから始める：**
   ```
   1. gc/gemini-3-flash (Googleから月18万回無料)
   2. if/kimi-k2-thinking (iFlowから無制限無料)
   3. qw/qwen3-coder-plus (Qwenから無制限無料)
   ```
   **コスト: $0/月**

2. **必要な場合のみ格安バックアップを追加：**
   ```
   4. glm/glm-4.7 ($0.6/100万トークン)
   ```
   **追加コスト: 実際に使用した分だけ支払い**

3. **サブスクリプションプロバイダーは最後に使用：**
   - 既にお持ちの場合のみ
   - 9Routerがクオータ追跡で価値を最大化

**結果:** ほとんどのユーザーは無料ティアのみで月額$0で運用可能！

</details>

<details>
<summary><b>📈 使用量が突然急増したら？</b></summary>

9Routerのスマートフォールバックが予期しない課金を防止します：

**シナリオ:** コーディングスプリント中にクオータを使い切った

**9Routerなし：**
- ❌ レート制限に到達 → 作業停止 → フラストレーション
- ❌ または: 意図せず高額なAPI請求が発生

**9Routerあり：**
- ✅ サブスクリプションが上限に達する → 格安ティアに自動フォールバック
- ✅ 格安ティアが高くなる → 無料ティアに自動フォールバック
- ✅ コーディングが止まらない → 予測可能なコスト

**あなたがコントロール:** ダッシュボードでプロバイダーごとの支出上限を設定し、9Routerはそれを遵守します。

</details>

---

## 📖 セットアップガイド

<details>
<summary><b>🔐 サブスクリプションプロバイダー（価値の最大化）</b></summary>

### Claude Code (Pro/Max)

```bash
ダッシュボード → Providers → Claude Codeを接続
→ OAuthログイン → 自動トークンリフレッシュ
→ 5時間 + 週次クオータ追跡

モデル:
  cc/claude-opus-4-6
  cc/claude-sonnet-4-5-20250929
  cc/claude-haiku-4-5-20251001
```

**プロのヒント:** 複雑なタスクにはOpus、スピード重視ならSonnet。9Routerはモデルごとにクオータを追跡します！

### OpenAI Codex (Plus/Pro)

```bash
ダッシュボード → Providers → Codexを接続
→ OAuthログイン（ポート1455）
→ 5時間 + 週次リセット

モデル:
  cx/gpt-5.2-codex
  cx/gpt-5.1-codex-max
```

### Gemini CLI（月18万回無料！）

```bash
ダッシュボード → Providers → Gemini CLIを接続
→ Google OAuth
→ 月18万回 + 日1千回

モデル:
  gc/gemini-3-flash-preview
  gc/gemini-2.5-pro
```

**最高のコスパ:** 巨大な無料ティア！有料ティアの前にこちらを使用。

### GitHub Copilot

```bash
ダッシュボード → Providers → GitHubを接続
→ GitHub経由のOAuth
→ 月次リセット（毎月1日）

モデル:
  gh/gpt-5
  gh/claude-4.5-sonnet
  gh/gemini-3-pro
```

</details>

<details>
<summary><b>💰 格安プロバイダー（バックアップ）</b></summary>

### GLM-4.7（日次リセット、$0.6/1M）

1. サインアップ: [Zhipu AI](https://open.bigmodel.cn/)
2. Coding PlanからAPIキーを取得
3. ダッシュボード → APIキーを追加:
   - プロバイダー: `glm`
   - APIキー: `your-key`

**使用:** `glm/glm-4.7`

**プロのヒント:** Coding Planは1/7のコストで3倍のクオータを提供！毎日午前10:00にリセット。

### MiniMax M2.1（5時間リセット、$0.20/1M）

1. サインアップ: [MiniMax](https://www.minimax.io/)
2. APIキーを取得
3. ダッシュボード → APIキーを追加

**使用:** `minimax/MiniMax-M2.1`

**プロのヒント:** ロングコンテキスト（100万トークン）で最安オプション！

### Kimi K2（月額$9固定）

1. サブスクライブ: [Moonshot AI](https://platform.moonshot.ai/)
2. APIキーを取得
3. ダッシュボード → APIキーを追加

**使用:** `kimi/kimi-latest`

**プロのヒント:** 月額$9固定で1000万トークン = 実効コスト$0.90/1M！

</details>

<details>
<summary><b>🆓 無料プロバイダー（緊急バックアップ）</b></summary>

### iFlow（8つの無料モデル）

```bash
ダッシュボード → iFlowを接続
→ iFlow OAuthログイン
→ 無制限使用

モデル:
  if/kimi-k2-thinking
  if/qwen3-coder-plus
  if/glm-4.7
  if/minimax-m2
  if/deepseek-r1
```

### Qwen（3つの無料モデル）

```bash
ダッシュボード → Qwenを接続
→ デバイスコード認証
→ 無制限使用

モデル:
  qw/qwen3-coder-plus
  qw/qwen3-coder-flash
```

### Kiro（Claude無料）

```bash
ダッシュボード → Kiroを接続
→ AWS Builder IDまたはGoogle/GitHub
→ 無制限使用

モデル:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
```

</details>

<details>
<summary><b>🎨 コンボの作成</b></summary>

### 例1: サブスクリプション最大化 → 格安バックアップ

```
ダッシュボード → Combos → 新規作成

名前: premium-coding
モデル:
  1. cc/claude-opus-4-6 (サブスクリプション、プライマリ)
  2. glm/glm-4.7 (格安バックアップ、$0.6/1M)
  3. minimax/MiniMax-M2.1 (最安フォールバック、$0.20/1M)

CLIでの使用: premium-coding

月額コスト例（1億トークン）:
  8000万 Claude経由（サブスクリプション）: 追加$0
  1500万 GLM経由: $9
  500万 MiniMax経由: $1
  合計: $10 + サブスクリプション
```

### 例2: 無料のみ（コストゼロ）

```
名前: free-combo
モデル:
  1. gc/gemini-3-flash-preview (月18万回無料)
  2. if/kimi-k2-thinking (無制限)
  3. qw/qwen3-coder-plus (無制限)

コスト: 永久$0！
```

</details>

<details>
<summary><b>🔧 CLI統合</b></summary>

### Cursor IDE

```
設定 → Models → Advanced:
  OpenAI API Base URL: http://localhost:20128/v1
  OpenAI API Key: [9routerダッシュボードから]
  Model: cc/claude-opus-4-6
```

またはコンボを使用: `premium-coding`

### Claude Code

`~/.claude/config.json` を編集:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

### OpenClaw

**オプション1 — ダッシュボード（推奨）：**

```
ダッシュボード → CLI Tools → OpenClaw → モデルを選択 → 適用
```

**オプション2 — 手動:** `~/.openclaw/openclaw.json` を編集:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/if/glm-4.7"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "if/glm-4.7",
            "name": "glm-4.7"
          }
        ]
      }
    }
  }
}
```

> **注意:** OpenClawはローカルの9Routerのみで動作します。IPv6解決の問題を避けるため、`localhost` ではなく `127.0.0.1` を使用してください。

### Cline / Continue / RooCode

```
プロバイダー: OpenAI Compatible
Base URL: http://localhost:20128/v1
API Key: [ダッシュボードから]
Model: cc/claude-opus-4-6
```

</details>

<details>
<summary><b>🚀 デプロイ</b></summary>

### VPSデプロイ

```bash
# クローンとインストール
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# 設定
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# 起動
npm run start

# またはPM2を使用
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Docker

```bash
# イメージをビルド（リポジトリルートから）
docker build -t 9router .

# コンテナを実行（現在のセットアップで使用しているコマンド）
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file /root/dev/9router/.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

ポータブルコマンド（リポジトリルートにいる場合）：

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  --env-file ./.env \
  -v 9router-data:/app/data \
  -v 9router-usage:/root/.9router \
  9router
```

コンテナのデフォルト：
- `PORT=20128`
- `HOSTNAME=0.0.0.0`

便利なコマンド：

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
```

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `JWT_SECRET` | `9router-default-secret-change-me` | ダッシュボード認証クッキーのJWT署名シークレット（**本番環境では変更必須**） |
| `INITIAL_PASSWORD` | `123456` | 保存されたハッシュがない場合の初回ログインパスワード |
| `DATA_DIR` | `~/.9router` | メインアプリのデータベース格納場所（`db.json`） |
| `PORT` | フレームワークデフォルト | サービスポート（例では`20128`） |
| `HOSTNAME` | フレームワークデフォルト | バインドホスト（Dockerデフォルトは`0.0.0.0`） |
| `NODE_ENV` | ランタイムデフォルト | デプロイ時は`production`に設定 |
| `BASE_URL` | `http://localhost:20128` | クラウド同期ジョブで使用されるサーバーサイド内部ベースURL |
| `CLOUD_URL` | `https://9router.com` | サーバーサイドのクラウド同期エンドポイントベースURL |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | 後方互換/公開ベースURL（サーバーランタイムには`BASE_URL`を推奨） |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | 後方互換/公開クラウドURL（サーバーランタイムには`CLOUD_URL`を推奨） |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | 生成されたAPIキーのHMACシークレット |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | 安定したマシンIDハッシュのソルト |
| `ENABLE_REQUEST_LOGS` | `false` | `logs/` 配下のリクエスト/レスポンスログを有効化 |
| `AUTH_COOKIE_SECURE` | `false` | 認証クッキーに`Secure`を強制（HTTPSリバースプロキシの背後では`true`に設定） |
| `REQUIRE_API_KEY` | `false` | `/v1/*` ルートでBearer APIキーを必須にする（インターネット公開デプロイで推奨） |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | 空 | アップストリームプロバイダー呼び出し用のオプショナルアウトバウンドプロキシ |

注意事項：
- 小文字のプロキシ変数もサポート: `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`
- `.env` はDockerイメージにベイクされません（`.dockerignore`）; `--env-file` または `-e` でランタイム設定を注入してください。
- Windowsでは、`APPDATA` をローカルストレージパスの解決に使用できます。
- `INSTANCE_NAME` は古いドキュメント/envテンプレートに記載がありますが、現在ランタイムでは使用されていません。

### ランタイムファイルとストレージ

- メインアプリ状態: `${DATA_DIR}/db.json`（プロバイダー、コンボ、エイリアス、キー、設定）、`src/lib/localDb.js` で管理。
- 使用履歴とログ: `~/.9router/usage.json` と `~/.9router/log.txt`、`src/lib/usageDb.js` で管理。
- オプションのリクエスト/トランスレーターログ: `ENABLE_REQUEST_LOGS=true` 時に `<repo>/logs/...`。
- 使用状況ストレージは現在 `~/.9router` パスロジックに従い、`DATA_DIR` とは独立しています。

</details>

---

## 📊 利用可能なモデル

<details>
<summary><b>すべての利用可能なモデルを表示</b></summary>

**Claude Code (`cc/`)** - Pro/Max:
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**Gemini CLI (`gc/`)** - 無料:
- `gc/gemini-3-flash-preview`
- `gc/gemini-2.5-pro`

**GitHub Copilot (`gh/`)**:
- `gh/gpt-5`
- `gh/claude-4.5-sonnet`

**GLM (`glm/`)** - $0.6/1M:
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - $0.2/1M:
- `minimax/MiniMax-M2.1`

**iFlow (`if/`)** - 無料:
- `if/kimi-k2-thinking`
- `if/qwen3-coder-plus`
- `if/deepseek-r1`

**Qwen (`qw/`)** - 無料:
- `qw/qwen3-coder-plus`
- `qw/qwen3-coder-flash`

**Kiro (`kr/`)** - 無料:
- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`

</details>

---

## 🐛 トラブルシューティング

**「Language model did not provide messages」**
- プロバイダーのクオータが使い果たされた → ダッシュボードのクオータトラッカーを確認
- 解決策: コンボフォールバックを使用するか、より安いティアに切り替え

**レート制限**
- サブスクリプションクオータ切れ → GLM/MiniMaxにフォールバック
- コンボを追加: `cc/claude-opus-4-6 → glm/glm-4.7 → if/kimi-k2-thinking`

**OAuthトークンの期限切れ**
- 9Routerが自動リフレッシュ
- 問題が続く場合: ダッシュボード → Provider → 再接続

**高コスト**
- ダッシュボードで使用状況を確認
- プライマリモデルをGLM/MiniMaxに切り替え
- 重要でないタスクには無料ティア（Gemini CLI、iFlow）を使用

**ダッシュボードが違うポートで開く**
- `PORT=20128` と `NEXT_PUBLIC_BASE_URL=http://localhost:20128` を設定

**初回ログインできない**
- `.env` の `INITIAL_PASSWORD` を確認
- 未設定の場合、デフォルトパスワードは `123456`

**`logs/` にリクエストログがない**
- `ENABLE_REQUEST_LOGS=true` に設定

---

## 🛠️ 技術スタック

- **ランタイム**: Node.js 20+
- **フレームワーク**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **データベース**: LowDB（JSONファイルベース）
- **ストリーミング**: Server-Sent Events (SSE)
- **認証**: OAuth 2.0 (PKCE) + JWT + APIキー

---

## 📝 APIリファレンス

### チャット補完

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Write a function to..."}
  ],
  "stream": true
}
```

### モデル一覧

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ すべてのモデル + コンボをOpenAI形式で返却
```

## 📧 サポート

- **ウェブサイト**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 コントリビューター

9Routerの改善に貢献してくださったすべてのコントリビューターに感謝します！

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 スターチャート

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)



## 🔀 フォーク

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — 9RouterのフルフィーチャーTypeScriptフォーク。36以上のプロバイダー、4段階自動フォールバック、マルチモーダルAPI（画像、埋め込み、音声、TTS）、サーキットブレーカー、セマンティックキャッシュ、LLM評価、洗練されたダッシュボードを追加。368以上のユニットテスト。npmとDockerで利用可能。

---

## 🙏 謝辞

**CLIProxyAPI** に特別な感謝を — このJavaScriptポートのインスピレーションとなったオリジナルのGo実装です。

---

## 📄 ライセンス

MITライセンス - 詳細は [LICENSE](LICENSE) を参照してください。

---

<div align="center">
  <sub>24時間365日コーディングする開発者のために ❤️ で構築</sub>
</div>
