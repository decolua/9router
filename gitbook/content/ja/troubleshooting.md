# トラブルシューティング

9Router利用時の一般的な問題と解決策。

---

## "Language model did not provide messages"

**問題:** リクエストが空のレスポンスまたはエラーメッセージで失敗。

**原因:**
- プロバイダーのクォータが消費された
- APIキーが無効または期限切れ
- モデルが利用不可

**解決策:**

1. **クォータ状況を確認:**
   ```
   Dashboard → Providers → クォータトラッカーを表示
   ```
   クォータが消費されている場合、リセットを待つかプロバイダーを切替。

2. **コンボフォールバックを使用:**
   ```
   Dashboard → Combos → フォールバックチェーンを作成
   例: cc/claude-opus → glm/glm-4.7 → if/kimi-k2
   ```

3. **プロバイダー接続を確認:**
   ```
   Dashboard → Providers → 必要に応じて再接続
   ```

---

## レート制限

**問題:** 「Rate limit exceeded」または「Too many requests」エラー。

**原因:**
- サブスクリプションのクォータが枯渇(5時間/日次/週次の制限)
- APIレート制限に達した
- 同時リクエストが多すぎる

**解決策:**

1. **リセット時間を確認:**
   ```
   Dashboard → Quota Tracking → リセットカウントダウンを表示
   ```

2. **低価格階層へ切替:**
   ```
   使用: glm/glm-4.7 (100万トークンあたり$0.6)
        minimax/MiniMax-M2.1 (100万トークンあたり$0.20)
   ```

3. **フォールバックコンボを追加:**
   ```
   Dashboard → Combos → バックアップモデルを追加
   優先: cc/claude-opus (サブスクリプション)
   バックアップ: glm/glm-4.7 (低価格)
   緊急時: if/kimi-k2 (無料)
   ```

---

## OAuthトークン期限切れ

**問題:** 「Unauthorized」または「Token expired」エラー。

**原因:**
- OAuthトークンが期限切れ(自動更新失敗)
- プロバイダーセッションが無効化された
- 更新中のネットワーク問題

**解決策:**

1. **自動更新(デフォルト):**
   9Routerは自動的にトークンを更新します。30秒待ってから再試行。

2. **手動で再接続:**
   ```
   Dashboard → Providers → [プロバイダー名] → Reconnect
   → OAuthフローを再度完了
   ```

3. **プロバイダーステータスを確認:**
   プロバイダーサービスがオンラインであることを確認(Claude Code、Codexなど)

---

## 高コスト

**問題:** 予期しない高使用量またはコスト。

**原因:**
- 不必要に高価なモデルを使用
- 低価格階層へのフォールバックがない
- 大きなコンテキストウィンドウ

**解決策:**

1. **使用統計を確認:**
   ```
   Dashboard → Usage Stats → トークン消費量を表示
   → 高コストモデルを特定
   ```

2. **より安いモデルへ切替:**
   ```
   置換: cc/claude-opus (月$20〜100サブスクリプション)
   へ: glm/glm-4.7 (100万トークンあたり$0.6)
       minimax/MiniMax-M2.1 (100万トークンあたり$0.20)
   ```

3. **無料階層を使用:**
   ```
   if/kimi-k2-thinking (無料)
   qw/qwen3-coder-plus (無料)
   kr/claude-sonnet-4.5 (無料)
   gc/gemini-3-flash-preview (月18万無料)
   ```

4. **プロンプトを最適化:**
   - コンテキストサイズを削減
   - 長い応答にストリーミングを使用
   - 一般的なプロンプトをキャッシュ

---

## Connection Refused

**問題:** 「ECONNREFUSED」または「Cannot connect to localhost:20128」。

**原因:**
- 9Routerが起動していない
- ポート20128がブロックされている
- ファイアウォールが接続をブロック

**解決策:**

1. **9Routerを起動:**
   ```bash
   9router
   ```
   ダッシュボードがhttp://localhost:3000で開くはず

2. **ポート20128を確認:**
   ```bash
   # ポートがリッスンしているか確認
   lsof -i :20128
   
   # またはWindowsで
   netstat -ano | findstr :20128
   ```

3. **ファイアウォールを確認:**
   - macOS: システム設定 → ネットワーク → ファイアウォール
   - Windows: Windows Defenderファイアウォール → アプリを許可
   - Linux: `sudo ufw allow 20128`

4. **クラウドエンドポイントを使用:**
   localhostが動作しない場合(例: Cursor IDE):
   ```
   Endpoint: https://9router.com/v1
   ```

---

## ダッシュボードが開かない

**問題:** ダッシュボードがhttp://localhost:3000で読み込まれない。

**原因:**
- ポート3000がすでに使用中
- 9Routerがクラッシュした
- ブラウザキャッシュの問題

**解決策:**

1. **9Routerが実行中か確認:**
   ```bash
   # プロセスを確認
   ps aux | grep 9router
   
   # ポート3000を確認
   lsof -i :3000
   ```

2. **競合するプロセスを終了:**
   ```bash
   # macOS/Linux
   lsof -ti:3000 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

3. **9Routerを再起動:**
   ```bash
   # 停止
   pkill -f 9router
   
   # 起動
   9router
   ```

4. **ブラウザキャッシュをクリア:**
   - Chrome: Ctrl+Shift+Delete → キャッシュをクリア
   - シークレットモードを試す

5. **ファイアウォール設定を確認:**
   ポート3000がブロックされていないことを確認。

---

## モデルが見つからない

**問題:** 「Model not found」または「Invalid model」エラー。

**原因:**
- プロバイダーが接続されていない
- モデルIDのタイポ
- プロバイダーが非アクティブ

**解決策:**

1. **プロバイダー接続を確認:**
   ```
   Dashboard → Providers → ステータスを確認(緑 = アクティブ)
   ```

2. **モデルID形式を確認:**
   ```
   正しい: cc/claude-opus-4-5-20251101
   誤り: claude-opus-4-5-20251101
   
   形式: [provider-prefix]/[model-name]
   ```

3. **利用可能なモデルを一覧表示:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer your-api-key"
   ```

4. **プロバイダーを再接続:**
   ```
   Dashboard → Providers → [Provider] → Reconnect
   ```

---

## 応答が遅い

**問題:** リクエストに時間がかかりすぎる、またはタイムアウト。

**原因:**
- プロバイダーのレイテンシ
- ネットワーク問題
- 大きなコンテキスト/応答
- プロバイダーのレート制限

**解決策:**

1. **プロバイダーステータスを確認:**
   ```
   Dashboard → Providers → レイテンシ統計を表示
   ```

2. **高速モデルへ切替:**
   ```
   高速: cc/claude-haiku-4-5 (HaikuはOpusより高速)
         gc/gemini-3-flash-preview
         qw/qwen3-coder-flash
   ```

3. **ストリーミングを使用:**
   ```json
   {
     "model": "cc/claude-opus-4-5",
     "messages": [...],
     "stream": true
   }
   ```

4. **ネットワークを確認:**
   ```bash
   # レイテンシをテスト
   ping api.anthropic.com
   ping api.openai.com
   ```

5. **コンテキストサイズを削減:**
   - メッセージ履歴をトリミング
   - 短いプロンプトを使用
   - CLIツールでコンテキストの剪定を有効化

---

## APIキー無効

**問題:** 「Invalid API key」または「Authentication failed」エラー。

**原因:**
- 間違ったAPIキーをコピー
- APIキーが期限切れ
- APIキーが生成されていない

**解決策:**

1. **APIキーを再生成:**
   ```
   Dashboard → Settings → API Keys → Generate New Key
   → 新しいキーをコピーして使用
   ```

2. **キー形式を確認:**
   ```
   正しい: 9r_xxxxxxxxxxxxxxxxxxxxxxxx
   誤り: 9r_プレフィックスがない
   ```

3. **CLI設定でキーを確認:**
   ```bash
   # Cursor
   Settings → Models → OpenAI API Key
   
   # Cline
   Settings → API Key
   
   # 環境変数
   export OPENAI_API_KEY="9r_your_key"
   ```

4. **APIキーをテスト:**
   ```bash
   curl http://localhost:20128/v1/models \
     -H "Authorization: Bearer 9r_your_key"
   ```

---

## さらにヘルプが必要?

- **GitHub Issues:** [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)
- **ドキュメント:** [9router.com/docs](https://9router.com/docs)
- **FAQ:** [faq.md](faq.md)
