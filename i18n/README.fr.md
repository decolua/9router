<div align="center">
  <img src="../images/9router.png?1" alt="Tableau de bord 9Router" width="800"/>
  
  # 9Router - Routeur IA GRATUIT et économiseur de tokens
  
  **N'arrêtez jamais de coder. Économisez 20 à 40 % de tokens avec RTK + bascule automatique vers des modèles d'IA GRATUITS et bon marché.**
  
  **Connectez tous vos outils de codage IA (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) à plus de 40 fournisseurs d'IA et plus de 100 modèles.**
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🚀 Démarrage rapide](#-démarrage-rapide) • [💡 Fonctionnalités](#-fonctionnalités-clés) • [📖 Configuration](#-guide-dinstallation) • [🌐 Site web](https://9router.com)

[🇻🇳 Tiếng Việt](./README.vi.md) • [🇨🇳 中文](./README.zh-CN.md) • [🇯🇵 日本語](./README.ja-JP.md) • [🇷🇺 Русский](./README.ru.md) • [🇹🇭 ไทย](./README.th.md) • [🇮🇷 فارسی](./README.fa_IR.md) • [🇮🇩 Indonesia](./README.id-ID.md) • [🇪🇸 Español](./README.es.md) • [🇫🇷 Français](./README.fr.md)

</div>

---

## 🤔 Pourquoi 9Router ?

**Arrêtez de gaspiller de l'argent, des tokens et de buter contre les limites :**

- ❌ Le quota de votre abonnement expire inutilisé chaque mois
- ❌ Les limites de débit vous interrompent en plein codage
- ❌ Les sorties des outils (git diff, grep, ls...) consomment vos tokens rapidement
- ❌ Des API coûteuses (20 à 50 $/mois par fournisseur)
- ❌ Changement manuel entre les fournisseurs

**9Router résout tout cela :**

- ✅ **Économiseur de tokens RTK** - Compresse automatiquement le contenu de tool_result et économise 20 à 40 % de tokens par requête
- ✅ **Maximise les abonnements** - Suit le quota et utilise chaque bit avant sa réinitialisation
- ✅ **Bascule automatique** - Abonnement → Bon marché → Gratuit, zéro temps d'arrêt
- ✅ **Multi-comptes** - Round-robin entre les comptes de chaque fournisseur
- ✅ **Universel** - Fonctionne avec Claude Code, Codex, Cursor, Cline et tout outil CLI

---

## 🔄 Comment ça marche

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router (Smart Router)            │
│  • RTK Token Saver (cut tool_result tokens) │
│  • Format translation (OpenAI ↔ Claude)     │
│  • Quota tracking                           │
│  • Auto token refresh                       │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [Tier 1: SUBSCRIPTION] Claude Code, Codex, GitHub Copilot
       │   ↓ quota exhausted
       ├─→ [Tier 2: CHEAP] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ budget limit
       └─→ [Tier 3: FREE] Kiro, OpenCode Free, Vertex ($300 credits)

Result: Never stop coding, minimal cost + 20-40% token savings via RTK
```

---

## ⚡ Démarrage rapide

**1. Installez globalement :**

```bash
npm install -g 9router
9router
```

🎉 Le tableau de bord s'ouvre sur `http://localhost:20128`

**2. Connectez un fournisseur GRATUIT (aucune inscription requise) :**

Tableau de bord → Providers → Connectez **Kiro AI** (Claude gratuit et illimité) ou **OpenCode Free** (sans authentification) → C'est tout !

**3. Utilisez-le dans votre outil CLI :**

```
Paramètres de Claude Code/Codex/OpenClaw/Cursor/Cline :
  Endpoint : http://localhost:20128/v1
  API Key : [copiez depuis le tableau de bord]
  Model : kr/claude-sonnet-4.5
```

**Et voilà !** Commencez à coder avec des modèles d'IA GRATUITS.

**Alternative : exécuter depuis le code source (ce dépôt) :**

Le paquet de ce dépôt est privé (`9router-app`), donc l'exécution depuis le code source/Docker est le chemin de développement local attendu.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Mode production :

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URL par défaut :

- Tableau de bord : `http://localhost:20128/dashboard`
- API compatible OpenAI : `http://localhost:20128/v1`

---

## 🎥 Guides vidéo

<div align="center">

<table>
  <tr>
  <td align="center" width="320">
  <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
    <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="Tiết kiệm chi phí LLM với 9Router" width="300"/>
  </a><br/>
  <b>🇻🇳 Tiếng Việt</b><br/>
  <sub>Tiết kiệm chi phí LLM cho OpenClaw với 9Router<br/>by <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
</td>
<td align="center" width="320">
      <a href="https://youtu.be/VQAw612S27Y">
        <img src="https://img.youtube.com/vi/VQAw612S27Y/maxresdefault.jpg" alt="9Router + Claude Code FREE Unlimited Setup" width="300"/>
      </a><br/>
      <b>🇵🇰 اردو / हिन्दी</b><br/>
      <sub>9Router + Claude Code FREE Unlimited Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    
  </tr>
  <tr>
  <td align="center" width="320">
      <a href="https://youtu.be/3dF5GIYMrcQ?si=bAyfyiHbARJQAHj_">
        <img src="https://img.youtube.com/vi/3dF5GIYMrcQ/hqdefault.jpg" alt="9Router Setup Tutorial" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>9Router + Claude Code FREE Setup<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code FREE Forever" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude Code FREE Forever — Unlimited Models<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
        <img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>Claude CLI Free Setup with 9Router 🚀<br/>by <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    
  </tr>
  <tr>
  <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="Cài đặt OpenClaw Free A-Z" width="300"/>
      </a><br/>
      <b>🇻🇳 Tiếng Việt</b><br/>
      <sub>Cài Đặt OpenClaw Free Từ A-Z + 9Router<br/>by <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="FREE OpenClaw with Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 English</b><br/>
      <sub>FREE OpenClaw + Claude Opus 4.6<br/>by <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=CkVZZUSTXAI">
        <img src="https://img.youtube.com/vi/CkVZZUSTXAI/mqdefault.jpg" alt="Claude CLI Free Setup" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Koding 24 Jam Anti Rate Limit! Hemat Token AI 65% | Tutorial Quick Setup 9Router 🚀<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
    
  </tr>
  
  <tr>
  <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=TXGv4eofe1I">
        <img src="https://img.youtube.com/vi/TXGv4eofe1I/mqdefault.jpg" alt="Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB" width="300"/>
      </a><br/>
      <b>🇮🇩 Indonesia</b><br/>
      <sub>Cara Deploy 9Router di Hugging Face GRATIS Non-Stop! | Alternatif VPS RAM 16GB<br/>by <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
  </tr>

</table>

</div>

> 🎬 **Vous avez réalisé une vidéo sur 9Router ?** Envoyez une [Pull Request](https://github.com/decolua/9router/pulls) en ajoutant votre vidéo à cette section — nous la fusionnerons !

---

## 🛠️ Outils CLI pris en charge

9Router fonctionne parfaitement avec tous les principaux outils de codage IA :

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

## 🌐 Fournisseurs pris en charge

### 🔐 Fournisseurs OAuth

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
      <td align="center" width="120">
        <img src="../public/providers/kimchi.png" width="60" alt="Kimchi"/><br/>
        <b>Kimchi</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 Fournisseurs gratuits

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>GRATUIT illimité</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>Sans authentification • Modèles automatiques<br/>GRATUIT illimité</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>300 $ de crédit gratuit</sub>
      </td>
    </tr>
  </table>
</div>

> **Remarque :** Les niveaux gratuits d'iFlow, Qwen et Gemini CLI ont été interrompus en 2026. Utilisez plutôt Kiro / OpenCode Free / Vertex.

### 🔑 Fournisseurs avec clé API (40+)

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
  <p><i>...et plus de 20 autres fournisseurs, dont Nebius, Chutes, Hyperbolic et des endpoints personnalisés compatibles OpenAI/Anthropic</i></p>
</div>

---

## 💡 Fonctionnalités clés

| Fonctionnalité                                                                         | Ce qu'elle fait                                                                                      | Pourquoi c'est important                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 🚀 **Économiseur de tokens RTK** ([RTK](https://github.com/rtk-ai/rtk) ⭐40K)           | Compresse les sorties des outils (`git diff`, `grep`, `ls`, `tree`...) avant de les envoyer au LLM    | Économise **20 à 40 % de tokens d'entrée** par requête    |
| 🧠 **Économiseur de tokens Headroom** ([Headroom](https://github.com/chopratejas/headroom)) | Proxy externe optionnel `/v1/compress` avant le routage vers le fournisseur                      | Économise plus de tokens de contexte sans changer les clients |
| 🪨 **Mode cavernicole** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K)     | Injecte un prompt en langage cavernicole → le LLM répond de manière concise, le contenu technique est conservé | Économise **jusqu'à 65 % de tokens de sortie** |
| 🐴 **Ponytail** ([Ponytail](https://github.com/DietrichGebert/ponytail))                | Injecte un prompt de "dev sénior fainéant" → le LLM écrit un code minimal, YAGNI d'abord (Lite/Full/Ultra) | **Moins de tokens de sortie, moins de refactorisation** |
| 🎯 **Repli intelligent à 3 niveaux**                                                    | Routage automatique : Abonnement → Bon marché → Gratuit                                              | N'arrêtez jamais de coder, zéro temps d'arrêt             |
| 📊 **Suivi de quota en temps réel**                                                     | Compteur de tokens en direct + compte à rebours de réinitialisation                                   | Maximisez la valeur de votre abonnement                   |
| 🔄 **Traduction de formats**                                                            | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex                                                   | Fonctionne avec n'importe quel outil CLI                  |
| 👥 **Prise en charge multi-comptes**                                                    | Plusieurs comptes par fournisseur                                                                    | Équilibrage de charge + redondance                        |
| 🔄 **Renouvellement automatique des tokens**                                            | Les tokens OAuth se renouvellent automatiquement                                                     | Plus besoin de se reconnecter manuellement                |
| 🎨 **Combos personnalisés**                                                             | Créez des combinaisons de modèles illimitées                                                         | Adaptez le repli à vos besoins                            |
| 📝 **Journalisation des requêtes**                                                      | Mode débogage avec journaux complets de requêtes/réponses                                            | Résolvez facilement les problèmes                         |
| 💾 **Synchronisation cloud**                                                            | Synchronisez la configuration entre vos appareils                                                    | La même configuration partout                             |
| 📊 **Analytique d'utilisation**                                                         | Suivez tokens, coûts et tendances au fil du temps                                                    | Optimisez vos dépenses                                    |
| 🌐 **Déployez partout**                                                                 | Localhost, VPS, Docker, Cloudflare Workers                                                           | Options de déploiement flexibles                          |

<details>
<summary><b>📖 Détails des fonctionnalités</b></summary>

### 🚀 Économiseur de tokens RTK

Les sorties des outils (`git diff`, `grep`, `find`, `ls`, `tree`, vidages de journaux...) consomment souvent 30 à 50 % de votre budget de prompt. RTK les détecte et applique une compression intelligente et sans perte **avant** que la requête n'atteigne le LLM :

- **Filtres :** `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`
- **Détection automatique :** Aucune configuration requise — RTK inspecte le premier 1 Ko de chaque `tool_result` et choisit le bon filtre.
- **Sûr par conception :** Si un filtre échoue, génère une erreur ou rend la sortie plus volumineuse, RTK conserve silencieusement le texte original. Les erreurs ne cassent jamais votre requête.
- **Universel :** Fonctionne dans tous les formats (OpenAI, Claude, Gemini, Cursor, Kiro, OpenAI Responses) car il s'exécute **avant** toute traduction de format.
- **Activé par défaut :** Activez-le ou désactivez-le à tout moment dans Tableau de bord → Paramètres d'Endpoint.

```
Sans RTK : 47K tokens envoyés au LLM
Avec RTK :   28K tokens envoyés au LLM   (40 % économisés · même contexte · même réponse)
```

### 🧠 Économiseur de tokens Headroom

Headroom est optionnel et s'exécute séparément. 9Router appelle l'endpoint local `/v1/compress` de Headroom, puis conserve le routage, le repli, l'authentification et le suivi d'utilisation normaux :

```
Client → 9Router → Headroom /v1/compress → 9Router → fournisseur
```

Configuration locale :

```bash
pip install "headroom-ai[proxy]>=0.5.21"
headroom proxy --port 8787
```

Activez-le dans Tableau de bord → Endpoint → Token Saver → Headroom. URL par défaut : `http://localhost:8787`.

Exemples Docker :

```bash
# Service Headroom dans le même réseau Docker
http://headroom:8787

# Headroom exécuté sur la machine hôte
http://host.docker.internal:8787
```

Si Headroom est indisponible ou renvoie une erreur, 9Router bascule en mode dégradé et envoie la requête originale.

### 🐴 Ponytail (Dev sénior fainéant)

Ponytail injecte un prompt système de _"dev sénior fainéant"_ dans chaque requête, orientant le LLM vers un code minimal et YAGNI d'abord — la suppression plutôt que l'ajout, la bibliothèque standard plutôt que de nouvelles dépendances, une ligne plutôt que des abstractions. Adapté de [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

- **Lite** — Construisez ce qui est demandé, nommez l'alternative plus fainéante.
- **Full** — Hiérarchie YAGNI appliquée : stdlib → natif → dépendances existantes → une ligne → code minimal.
- **Ultra** — Extrémiste du YAGNI : suppression d'abord, livrez la solution d'une ligne, remettez en question le reste de l'exigence dans la même réponse.

```
Sans Ponytail : code verbeux, abstractions superflues, échafaudage "au cas où"
Avec Ponytail :    diff fonctionnel le plus court, aucune abstraction non demandée, moins de tokens
```

Ne sacrifie jamais : la validation des entrées, la gestion des erreurs qui évite la perte de données, la sécurité, l'accessibilité ni rien d'explicitement demandé. Activez-le dans Tableau de bord → Endpoint → Ponytail. Se cumule avec Caveman (concision de sortie) et RTK (compression d'entrée).

### 🎯 Repli intelligent à 3 niveaux

Créez des combos avec repli automatique :

```
Combo : "my-coding-stack"
  1. cc/claude-opus-4-6        (votre abonnement)
  2. glm/glm-4.7               (sauvegarde économique, $0.6/1M)
  3. if/kimi-k2-thinking       (repli gratuit)

→ Bascule automatiquement quand le quota est épuisé ou en cas d'erreur
```

### 📊 Suivi de quota en temps réel

- Consommation de tokens par fournisseur
- Compte à rebours de réinitialisation (5 heures, quotidien, hebdomadaire)
- Estimation des coûts pour les niveaux payants
- Rapports de dépenses mensuels

### 🔄 Traduction de formats

Traduction transparente entre les formats :

- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- Votre outil CLI envoie le format OpenAI → 9Router le traduit → Le fournisseur reçoit le format natif
- Fonctionne avec tout outil prenant en charge les endpoints OpenAI personnalisés

### 👥 Prise en charge multi-comptes

- Ajoutez plusieurs comptes par fournisseur
- Routage automatique round-robin ou basé sur la priorité
- Repli vers le compte suivant quand un compte atteint son quota

### 🔄 Renouvellement automatique des tokens

- Les tokens OAuth se renouvellent automatiquement avant expiration
- Plus besoin de réauthentification manuelle
- Expérience transparente avec tous les fournisseurs

### 🎨 Combos personnalisés

- Créez des combinaisons de modèles illimitées
- Mélangez niveaux d'abonnement, économiques et gratuits
- Nommez vos combos pour un accès facile
- Partagez vos combos entre appareils grâce à la Synchronisation cloud

### 📝 Journalisation des requêtes

- Activez le mode débogage pour des journaux complets de requêtes/réponses
- Suivez les appels API, les en-têtes et les charges utiles
- Résolvez les problèmes d'intégration
- Exportez les journaux pour analyse

### 💾 Synchronisation cloud

- Synchronisez fournisseurs, combos et paramètres entre appareils
- Synchronisation automatique en arrière-plan
- Stockage chiffré et sécurisé
- Accédez à votre configuration depuis n'importe où

#### Remarques sur le runtime cloud

- Privilégiez les variables cloud côté serveur en production :
  - `BASE_URL` (URL de rappel interne utilisée par le planificateur de synchronisation)
  - `CLOUD_URL` (base de l'endpoint de synchronisation cloud)
- `NEXT_PUBLIC_BASE_URL` et `NEXT_PUBLIC_CLOUD_URL` restent prises en charge pour la compatibilité/UI, mais le runtime serveur privilégie désormais `BASE_URL`/`CLOUD_URL`.
- Les requêtes de synchronisation cloud utilisent désormais un délai d'expiration + un comportement de défaillance rapide pour éviter que l'UI ne se bloque quand le DNS/réseau cloud est indisponible.

### 📊 Analytique d'utilisation

- Suivez l'utilisation des tokens par fournisseur et modèle
- Estimation des coûts et tendances de dépenses
- Rapports et informations mensuels
- Optimisez vos dépenses IA

> **💡 IMPORTANT - Comprendre les coûts du tableau de bord :**
>
> Le "coût" affiché dans l'Analytique d'utilisation est **uniquement à des fins de suivi et de comparaison**.
> 9Router lui-même **ne vous facture jamais** quoi que ce soit. Vous ne payez que les fournisseurs directement (si vous utilisez des services payants).
>
> **Exemple :** Si votre tableau de bord affiche "coût total de 290 $" alors que vous utilisez les modèles iFlow, cela représente
> ce que vous auriez payé en utilisant des API payantes directement. Votre coût réel = **0 $** (iFlow est gratuit et illimité).
>
> Considérez-le comme un "suivi d'économies" qui montre combien vous économisez en utilisant des modèles gratuits ou
> en routant via 9Router !

### 🌐 Déployez partout

- 💻 **Localhost** - Par défaut, fonctionne hors ligne
- ☁️ **VPS/Cloud** - Partagez entre appareils
- 🐳 **Docker** - Déploiement en une commande
- 🚀 **Cloudflare Workers** - Réseau mondial de périphérie

</details>

---

## 💰 Tarifs en un coup d'œil

| Niveau                 | Fournisseur           | Coût            | Réinitialisation du quota | Idéal pour                                |
| ---------------------- | --------------------- | --------------- | ------------------------- | ----------------------------------------- |
| **🚀 ÉCONOMIE DE TOKENS** | **RTK (intégré)**     | **GRATUIT**     | Toujours actif            | **Économisez 20 à 40 % de tokens sur CHAQUE requête** |
| **💳 ABONNEMENT**      | Claude Code (Pro/Max) | 20 à 200 $/mois | 5 h + hebdomadaire        | Déjà abonné                                |
|                        | Codex (Plus/Pro)      | 20 à 200 $/mois | 5 h + hebdomadaire        | Utilisateurs d'OpenAI                      |
|                        | GitHub Copilot        | 10 à 19 $/mois  | Mensuelle                 | Utilisateurs de GitHub                     |
|                        | Cursor IDE            | 20 $/mois       | Mensuelle                 | Utilisateurs de Cursor                     |
| **💰 BON MARCHÉ**     | GLM-5.1 / GLM-4.7     | 0,6 $/1M        | Quotidienne 10 h          | Sauvegarde économique                      |
|                        | MiniMax M2.7          | 0,2 $/1M        | Fenêtre de 5 heures       | L'option la moins chère                    |
|                        | Kimi K2.5             | 9 $/mois forfait | 10M tokens/mois          | Coût prévisible                            |
| **🆓 GRATUIT**         | Kiro AI               | 0 $             | Illimité                  | Claude 4.5 + GLM-5 + MiniMax gratuits      |
|                        | OpenCode Free         | 0 $             | Illimité                  | Sans authentification, modèles automatiques |
|                        | Vertex AI             | 300 $ de crédit | Nouveaux comptes GCP      | Gemini 3 Pro + DeepSeek + GLM-5            |

**💡 Astuce pro :** Le combo RTK + Kiro AI + OpenCode Free = **0 $ de coût + 20 à 40 % d'économie de tokens** !

---

### 📊 Comprendre les coûts et la facturation de 9Router

**La réalité de la facturation de 9Router :**

✅ **Le logiciel 9Router = GRATUIT pour toujours** (open source, ne facture jamais)  
✅ **Les "coûts" du tableau de bord = Affichage/suivi uniquement** (pas de vraies factures)  
✅ **Vous payez les fournisseurs directement** (abonnements ou frais d'API)  
✅ **Les fournisseurs GRATUITS restent GRATUITS** (iFlow, Kiro, Qwen = 0 $ illimité)  
❌ **9Router n'envoie jamais de factures** et ne débite pas votre carte

**Comment fonctionne l'affichage des coûts :**

Le tableau de bord affiche des **coûts estimés** comme si vous utilisiez des API payantes directement. Ce n'est **pas une facturation** — c'est un outil de comparaison pour montrer vos économies.

**Scénario d'exemple :**

```
Affichage du tableau de bord :
• Total des requêtes : 1 662
• Total des tokens : 47M
• Coût affiché : 290 $

Vérification de la réalité :
• Fournisseur : iFlow (GRATUIT illimité)
• Paiement réel : 0,00 $
• Ce que signifie 290 $ : Le montant que vous avez ÉCONOMISÉ en utilisant des modèles gratuits !
```

**Règles de paiement :**

- **Fournisseurs par abonnement** (Claude Code, Codex) : Payez-les directement via leurs sites web
- **Fournisseurs bon marché** (GLM, MiniMax) : Payez-les directement, 9Router se contente de router
- **Fournisseurs GRATUITS** (iFlow, Kiro, Qwen) : Vraiment gratuits pour toujours, sans frais cachés
- **9Router** : Ne facture jamais rien, jamais

---

## 🎯 Cas d'utilisation

### Cas 1 : "J'ai un abonnement Claude Pro"

**Problème :** Le quota expire inutilisé, limites de débit pendant un codage intensif

**Solution :**

```
Combo : "maximize-claude"
  1. cc/claude-opus-4-7        (utilisez l'abonnement à fond)
  2. glm/glm-5.1               (sauvegarde économique quand le quota est épuisé)
  3. kr/claude-sonnet-4.5      (repli gratuit d'urgence)

Coût mensuel : 20 $ (abonnement) + ~5 $ (sauvegarde) = 25 $ au total
vs. 20 $ + buter sur les limites = frustration
```

### Cas 2 : "Je veux un coût zéro"

**Problème :** Impossible de payer un abonnement, besoin d'un codage IA fiable

**Solution :**

```
Combo : "free-forever"
  1. kr/claude-sonnet-4.5      (Claude 4.5 gratuit illimité)
  2. kr/glm-5                  (GLM-5 gratuit via Kiro)
  3. oc/<auto>                 (OpenCode Free, sans authentification)

Coût mensuel : 0 $
Qualité : Modèles prêts pour la production + RTK économise 20 à 40 % de tokens
```

### Cas 3 : "J'ai besoin de coder 24h/24 et 7j/7, sans interruptions"

**Problème :** Délais à respecter, pas de temps d'arrêt possible

**Solution :**

```
Combo : "always-on"
  1. cc/claude-opus-4-7        (meilleure qualité)
  2. cx/gpt-5.5                (deuxième abonnement)
  3. glm/glm-5.1               (bon marché, réinitialisation quotidienne)
  4. minimax/MiniMax-M2.7      (le moins cher, réinitialisation 5 h)
  5. kr/claude-sonnet-4.5      (gratuit illimité)

Résultat : 5 couches de repli = zéro temps d'arrêt
Coût mensuel : 20 à 200 $ (abonnements) + 10 à 20 $ (sauvegarde)
```

### Cas 4 : "Je veux une IA GRATUITE dans OpenClaw"

**Problème :** Besoin d'un assistant IA dans les applications de messagerie (WhatsApp, Telegram, Slack...), entièrement gratuit

**Solution :**

```
Combo : "openclaw-free"
  1. kr/claude-sonnet-4.5      (Claude 4.5 gratuit)
  2. kr/glm-5                  (GLM-5 gratuit)
  3. kr/MiniMax-M2.5           (MiniMax gratuit)

Coût mensuel : 0 $
Accès via : WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ Questions fréquemment posées

<details>
<summary><b>📊 Pourquoi mon tableau de bord affiche-t-il des coûts élevés ?</b></summary>

Le tableau de bord suit votre utilisation de tokens et affiche des **coûts estimés** comme si vous utilisiez des API payantes directement. Ce n'est **pas une facturation réelle** — c'est une référence pour montrer combien vous économisez en utilisant des modèles gratuits ou des abonnements existants via 9Router.

**Exemple :**

- **Le tableau de bord affiche :** "290 $ de coût total"
- **La réalité :** Vous utilisez iFlow (GRATUIT illimité)
- **Votre coût réel :** **0,00 $**
- **Ce que signifie 290 $ :** Le montant que vous avez **économisé** en utilisant des modèles gratuits au lieu d'API payantes !

L'affichage des coûts est un "suivi d'économies" qui vous aide à comprendre vos habitudes d'utilisation et vos opportunités d'optimisation.

</details>

<details>
<summary><b>💳 9Router me facturera-t-il ?</b></summary>

**Non.** 9Router est un logiciel gratuit et open source qui s'exécute sur votre propre ordinateur. Il ne vous facture jamais rien.

**Vous ne payez que :**

- ✅ **Fournisseurs par abonnement** (Claude Code 20 $/mois, Codex 20 à 200 $/mois) → Payez-les directement sur leurs sites web
- ✅ **Fournisseurs bon marché** (GLM, MiniMax) → Payez-les directement, 9Router route simplement vos requêtes
- ❌ **9Router lui-même** → **Ne facture jamais rien, jamais**

9Router est un proxy/routeur local. Il n'a pas votre carte bancaire, ne peut pas envoyer de factures et ne possède aucun système de facturation. C'est un logiciel entièrement gratuit.

</details>

<details>
<summary><b>🆓 Les fournisseurs GRATUITS sont-ils vraiment illimités ?</b></summary>

**Oui !** Les fournisseurs GRATUITS actuels (Kiro, OpenCode Free, Vertex) sont réellement gratuits et **sans frais cachés**.

Ce sont des services gratuits offerts par ces entreprises respectives :

- **Kiro AI** : Claude 4.5 + GLM-5 + MiniMax gratuits et illimités via AWS Builder ID / Google / GitHub OAuth
- **OpenCode Free** : Proxy de passage sans authentification, modèles récupérés automatiquement depuis `opencode.ai/zen/v1/models`
- **Vertex AI** : 300 $ de crédit gratuit pour les nouveaux comptes Google Cloud (90 jours)

9Router se contente de router vos requêtes vers eux — il n'y a pas de "piège" ni de facturation future. Ce sont de véritables services gratuits, et 9Router les rend faciles à utiliser avec le support du repli.

**Niveaux gratuits interrompus (non recommandés) :**

- ❌ **iFlow** : Était gratuit et illimité, désormais payant (2026)
- ❌ **Qwen Code** : Le niveau gratuit OAuth a été interrompu par Alibaba le 15/04/2026
- ❌ **Gemini CLI** : Fonctionne toujours, mais l'utiliser avec des outils non-CLI (Claude, Codex, Cursor...) peut entraîner des bannissements de compte — utilisez-le uniquement si vous restez sur le Gemini CLI lui-même

</details>

<details>
<summary><b>💰 Comment minimiser mes vrais coûts d'IA ?</b></summary>

**Stratégie gratuit-d'abord :**

1. **Commencez avec un combo 100 % gratuit :**

   ```
   1. gc/gemini-3-flash (180K/mois gratuit de Google)
   2. if/kimi-k2-thinking (gratuit illimité d'iFlow)
   3. qw/qwen3-coder-plus (gratuit illimité de Qwen)
   ```

   **Coût : 0 $/mois**

2. **Ajoutez une sauvegarde économique** uniquement si nécessaire :

   ```
   4. glm/glm-4.7 (0,6 $/1M de tokens)
   ```

   **Coût supplémentaire : Vous ne payez que ce que vous utilisez réellement**

3. **Utilisez les fournisseurs par abonnement en dernier :**
   - Uniquement si vous les possédez déjà
   - 9Router vous aide à maximiser leur valeur grâce au suivi de quota

**Résultat :** La plupart des utilisateurs peuvent fonctionner à 0 $/mois en utilisant uniquement les niveaux gratuits !

</details>

<details>
<summary><b>📈 Et si mon utilisation explose soudainement ?</b></summary>

Le repli intelligent de 9Router évite les frais surprises :

**Scénario :** Vous êtes en sprint de codage et vous épuisez vos quotas

**Sans 9Router :**

- ❌ Limite de débit atteinte → Le travail s'arrête → Frustration
- ❌ Ou : Vous accumulez accidentellement d'énormes factures d'API

**Avec 9Router :**

- ✅ L'abonnement atteint sa limite → Repli automatique vers le niveau économique
- ✅ Le niveau économique devient coûteux → Repli automatique vers le niveau gratuit
- ✅ N'arrêtez jamais de coder → Coûts prévisibles

**Vous gardez le contrôle :** Définissez des limites de dépenses par fournisseur dans le tableau de bord, et 9Router les respecte.

</details>

---

## 📖 Guide d'installation

<details>
<summary><b>🔐 Fournisseurs par abonnement (maximisez la valeur)</b></summary>

### Claude Code (Pro/Max)

```bash
Tableau de bord → Providers → Connectez Claude Code
→ Connexion OAuth → Renouvellement automatique des tokens
→ Suivi de quota de 5 heures + hebdomadaire

Modèles :
  cc/claude-opus-4-7
  cc/claude-opus-4-6
  cc/claude-sonnet-4-6
  cc/claude-haiku-4-5-20251001
```

**Astuce pro :** Utilisez Opus pour les tâches complexes et Sonnet pour la vitesse. 9Router suit le quota par modèle !

### OpenAI Codex (Plus/Pro)

```bash
Tableau de bord → Providers → Connectez Codex
→ Connexion OAuth (port 1455)
→ Réinitialisation de 5 heures + hebdomadaire

Modèles :
  cx/gpt-5.5
  cx/gpt-5.4
  cx/gpt-5.3-codex
  cx/gpt-5.2-codex
```

### GitHub Copilot

```bash
Tableau de bord → Providers → Connectez GitHub
→ OAuth via GitHub
→ Réinitialisation mensuelle (le 1er du mois)

Modèles :
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
Tableau de bord → Providers → Connectez Cursor
→ Connexion OAuth
→ Abonnement mensuel

Modèles :
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 Fournisseurs bon marché (sauvegarde)</b></summary>

### GLM-5.1 / GLM-4.7 (réinitialisation quotidienne, 0,6 $/1M)

1. Inscrivez-vous : [Zhipu AI](https://open.bigmodel.cn/)
2. Obtenez la clé API depuis le Coding Plan
3. Tableau de bord → Add API Key :
   - Fournisseur : `glm`
   - API Key : `votre-clé`

**Utilisation :** `glm/glm-5.1`, `glm/glm-5`, `glm/glm-4.7`

**Astuce pro :** Le Coding Plan offre un quota 3× pour 1/7 du coût ! Réinitialisation quotidienne à 10 h.

### MiniMax M2.7 (réinitialisation 5 h, 0,20 $/1M)

1. Inscrivez-vous : [MiniMax](https://www.minimax.io/)
2. Obtenez la clé API
3. Tableau de bord → Add API Key

**Utilisation :** `minimax/MiniMax-M2.7`, `minimax/MiniMax-M2.5`

**Astuce pro :** L'option la moins chère pour les longs contextes (1M de tokens) !

### Kimi K2.5 (9 $/mois forfaitaires)

1. Abonnez-vous : [Moonshot AI](https://platform.moonshot.ai/)
2. Obtenez la clé API
3. Tableau de bord → Add API Key

**Utilisation :** `kimi/kimi-k2.5`, `kimi/kimi-k2.5-thinking`

**Astuce pro :** 9 $/mois forfaitaires pour 10M de tokens = coût effectif de 0,90 $/1M !

</details>

<details>
<summary><b>🆓 Fournisseurs GRATUITS (recommandés)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax GRATUIT)

```bash
Tableau de bord → Connectez Kiro
→ AWS Builder ID, AWS IAM Identity Center, Google ou GitHub
→ Utilisation illimitée

Modèles :
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**Astuce pro :** La meilleure option gratuite pour Claude. Sans clé API, sans paiement, entièrement illimité.

### OpenCode Free (sans authentification, modèles automatiques)

```bash
Tableau de bord → Connectez OpenCode Free
→ Aucune connexion requise (proxy de passage)
→ Modèles récupérés automatiquement depuis opencode.ai/zen/v1/models
```

**Astuce pro :** La configuration la plus rapide. Connectez-vous et commencez à coder.

### Vertex AI (300 $ de crédit gratuit pour les nouveaux comptes GCP)

```bash
Tableau de bord → Connectez Vertex AI
→ Importez le JSON du compte de service Google Cloud
→ Activez l'API Vertex AI dans votre projet GCP

Modèles :
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex Partner (Anthropic / DeepSeek / GLM / Qwen via Vertex) :
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

**Astuce pro :** Les nouveaux comptes Google Cloud reçoivent 300 $ de crédit gratuit pendant 90 jours. Largement suffisant pour coder tous les jours.

</details>

<details>
<summary><b>🎨 Créez des combos</b></summary>

### Exemple 1 : Maximisez l'abonnement → Sauvegarde économique

```
Tableau de bord → Combos → Create New

Nom : premium-coding
Modèles :
  1. cc/claude-opus-4-7 (Abonnement principal)
  2. glm/glm-5.1 (Sauvegarde économique, 0,6 $/1M)
  3. minimax/MiniMax-M2.7 (Repli le moins cher, 0,20 $/1M)

Utilisation en CLI : premium-coding

Exemple de coût mensuel (100M de tokens) :
  80M via Claude (abonnement) : 0 $ supplémentaire
  15M via GLM : 9 $
  5M via MiniMax : 1 $
  Total : 10 $ + votre abonnement
```

### Exemple 2 : Gratuit uniquement (coût zéro)

```
Nom : free-combo
Modèles :
  1. kr/claude-sonnet-4.5 (Claude 4.5 gratuit illimité)
  2. kr/glm-5 (GLM-5 gratuit via Kiro)
  3. vertex/gemini-3.1-pro-preview (300 $ de crédit gratuit)

Coût : 0 $ pour toujours (+ 20 à 40 % d'économie de tokens via RTK) !
```

</details>

<details>
<summary><b>🔧 Intégration CLI</b></summary>

### Cursor IDE

```
Settings → Models → Advanced :
  OpenAI API Base URL : http://localhost:20128/v1
  OpenAI API Key : [depuis le tableau de bord 9router]
  Model : cc/claude-opus-4-7
```

Ou utilisez le combo : `premium-coding`

### Claude Code

Modifiez `~/.claude/config.json` :

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "votre-clé-api-9router"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="votre-clé-api-9router"

codex "votre prompt"
```

### OpenClaw

**Option 1 — Tableau de bord (recommandée) :**

```
Tableau de bord → CLI Tools → OpenClaw → Sélectionnez le modèle → Appliquer
```

**Option 2 — Manuel :** Modifiez `~/.openclaw/openclaw.json` :

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/kr/claude-sonnet-4.5"
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
            "id": "kr/claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5 (Kiro Free)"
          }
        ]
      }
    }
  }
}
```

> **Remarque :** OpenClaw ne fonctionne qu'avec un 9Router local. Utilisez `127.0.0.1` au lieu de `localhost` pour éviter les problèmes de résolution IPv6.

### Cline / Continue / RooCode

```
Provider : OpenAI Compatible
Base URL : http://localhost:20128/v1
API Key : [depuis le tableau de bord]
Model : cc/claude-opus-4-7
```

</details>

<details>
<summary><b>🚀 Déploiement</b></summary>

### Déploiement VPS

```bash
# Clonez et installez
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# Configuration
export JWT_SECRET="votre-secret-sécurisé-changez-le"
export INITIAL_PASSWORD="votre-mot-de-passe"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# Démarrage
npm run start

# Ou utilisez PM2
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### Docker

Images publiées (multi-plateformes `linux/amd64` + `linux/arm64`) :

- Docker Hub : [`decolua/9router`](https://hub.docker.com/r/decolua/9router)
- GHCR : [`ghcr.io/decolua/9router`](https://github.com/decolua/9router/pkgs/container/9router)

**Démarrage rapide (utilisez l'image publiée) :**

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

→ Ouvrez http://localhost:20128

**Compiler depuis le code source (dev) :**

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
docker build -t 9router .
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data 9router
```

**Valeurs par défaut du conteneur :**

- `PORT=20128`
- `HOSTNAME=0.0.0.0`

**Commandes utiles :**

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
docker pull decolua/9router:latest   # mise à jour vers la dernière version
```

**Persistance des données :** `$HOME/.9router/db/data.sqlite` sur l'hôte ↔ `/app/data/db/data.sqlite` dans le conteneur.

### Variables d'environnement

| Variable                                             | Par défaut                                  | Description                                                                                  |
| ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                         | Généré automatiquement (`~/.9router/jwt-secret`) | Secret de signature JWT pour le cookie d'authentification du tableau de bord (remplacez-le pour partager entre instances) |
| `INITIAL_PASSWORD`                                   | `123456`                                    | Mot de passe de première connexion quand aucun hash n'est enregistré                          |
| `DATA_DIR`                                           | `~/.9router`                                | Emplacement principal des données de l'app (SQLite dans `$DATA_DIR/db/data.sqlite`)          |
| `PORT`                                               | défaut du framework                         | Port du service (`20128` dans les exemples)                                                   |
| `HOSTNAME`                                           | défaut du framework                         | Hôte de liaison (Docker utilise `0.0.0.0` par défaut)                                         |
| `NODE_ENV`                                           | défaut du runtime                           | Définissez `production` pour le déploiement                                                   |
| `BASE_URL`                                           | `http://localhost:20128`                    | URL de base interne côté serveur utilisée par les tâches de synchronisation cloud             |
| `CLOUD_URL`                                          | `https://9router.com`                       | URL de base de l'endpoint de synchronisation cloud côté serveur                               |
| `NEXT_PUBLIC_BASE_URL`                               | `http://localhost:3000`                     | URL de base publique/rétrocompatible (préférez `BASE_URL` pour le runtime serveur)            |
| `NEXT_PUBLIC_CLOUD_URL`                              | `https://9router.com`                       | URL cloud publique/rétrocompatible (préférez `CLOUD_URL` pour le runtime serveur)             |
| `API_KEY_SECRET`                                     | `endpoint-proxy-api-key-secret`             | Secret HMAC pour les clés API générées                                                         |
| `MACHINE_ID_SALT`                                    | `endpoint-proxy-salt`                       | Sel pour le hachage stable de l'ID machine                                                    |
| `ENABLE_REQUEST_LOGS`                                | `false`                                     | Active les journaux de requêtes/réponses dans `logs/`                                         |
| `AUTH_COOKIE_SECURE`                                 | `false`                                     | Force le cookie d'authentification `Secure` (mettez `true` derrière un proxy inverse HTTPS)   |
| `REQUIRE_API_KEY`                                    | `false`                                     | Applique la clé API Bearer sur les routes `/v1/*` (recommandé pour les déploiements exposés à Internet) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | vide                                        | Proxy sortant optionnel pour les appels aux fournisseurs externes                              |
| `SEARXNG_URL`                                        | `http://localhost:8888/search`              | Endpoint du fournisseur de recherche web SearXNG intégré, sans authentification               |

Remarques :

- Les variables de proxy en minuscules sont également prises en charge : `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`.
- `.env` n'est pas intégré à l'image Docker (`.dockerignore`) ; injectez la configuration du runtime avec `--env-file` ou `-e`.
- Sous Windows, `APPDATA` peut être utilisé pour résoudre le chemin de stockage local.
- `INSTANCE_NAME` apparaît dans l'ancienne documentation/les anciens modèles d'environnement, mais n'est actuellement pas utilisé au runtime.

### Fichiers d'exécution et stockage

- État principal de l'app : `${DATA_DIR}/db/data.sqlite` (SQLite — fournisseurs, combos, alias, clés, paramètres, historique d'utilisation)
- Sauvegardes automatiques : `${DATA_DIR}/db/backups/`
- Journaux optionnels de requêtes/translator : `<repo>/logs/...` quand `ENABLE_REQUEST_LOGS=true`
- `${DATA_DIR}` et `~/.9router` résolvent tous deux le même emplacement dans un conteneur Docker — le lien symbolique `/root/.9router -> /app/data` est créé au moment de la compilation.

</details>

---

## 📊 Modèles disponibles

<details>
<summary><b>Afficher tous les modèles disponibles</b></summary>

**Claude Code (`cc/`)** - Pro/Max :

- `cc/claude-opus-4-7`
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro :

- `cx/gpt-5.5`
- `cx/gpt-5.4`
- `cx/gpt-5.3-codex`
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**GitHub Copilot (`gh/`)** :

- `gh/gpt-5.4`
- `gh/claude-opus-4.7`
- `gh/claude-sonnet-4.6`
- `gh/gemini-3.1-pro-preview`
- `gh/grok-code-fast-1`

**Cursor (`cu/`)** - Abonnement :

- `cu/claude-4.6-opus-max`
- `cu/claude-4.5-sonnet-thinking`
- `cu/gpt-5.3-codex`
- `cu/kimi-k2.5`

**GLM (`glm/`)** - 0,6 $/1M :

- `glm/glm-5.1`
- `glm/glm-5`
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - 0,2 $/1M :

- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.5`

**Kimi (`kimi/`)** - 9 $/mois forfaitaires :

- `kimi/kimi-k2.5`
- `kimi/kimi-k2.5-thinking`

**Kiro (`kr/`)** - GRATUIT illimité :

- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`
- `kr/glm-5`
- `kr/MiniMax-M2.5`
- `kr/qwen3-coder-next`
- `kr/deepseek-3.2`

**OpenCode Free (`oc/`)** - GRATUIT sans authentification :

- Récupérés automatiquement depuis `opencode.ai/zen/v1/models`

**Vertex AI (`vertex/`)** - 300 $ de crédit gratuit :

- `vertex/gemini-3.1-pro-preview`
- `vertex/gemini-3-flash-preview`
- `vertex/gemini-2.5-flash`
- `vertex-partner/glm-5-maas`
- `vertex-partner/deepseek-v3.2-maas`

</details>

---

## 🐛 Dépannage

**"Language model did not provide messages"**

- Quota du fournisseur épuisé → Consultez le suivi de quota du tableau de bord
- Solution : utilisez le repli du combo ou passez à un niveau moins cher

**Limites de débit**

- Quota d'abonnement épuisé → Repli vers GLM/MiniMax
- Ajoutez le combo : `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**Token OAuth expiré**

- Renouvelé automatiquement par 9Router
- Si les problèmes persistent : Tableau de bord → Provider → Reconnecter

**Coûts élevés**

- Activez RTK dans Tableau de bord → Paramètres d'Endpoint (activé par défaut, économise 20 à 40 % de tokens)
- Consultez les statistiques d'utilisation dans le tableau de bord
- Changez le modèle principal pour GLM/MiniMax
- Utilisez le niveau gratuit (Kiro, OpenCode Free, Vertex) pour les tâches non critiques

**Le tableau de bord s'ouvre sur le mauvais port**

- Définissez `PORT=20128` et `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**La première connexion ne fonctionne pas**

- Vérifiez `INITIAL_PASSWORD` dans `.env`
- S'il n'est pas défini, le mot de passe de secours est `123456`

**Pas de journaux de requêtes dans `logs/`**

- Définissez `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Pile technologique

- **Runtime** : Node.js 20+
- **Framework** : Next.js 16
- **UI** : React 19 + Tailwind CSS 4
- **Base de données** : SQLite (better-sqlite3 / node:sqlite / sql.js en secours)
- **Streaming** : Server-Sent Events (SSE)
- **Authentification** : OAuth 2.0 (PKCE) + JWT + clés API

---

## 📝 Référence de l'API

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer votre-clé-api
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Écrivez une fonction pour..."}
  ],
  "stream": true
}
```

### Lister les modèles

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer votre-clé-api

→ Renvoie tous les modèles et combos au format OpenAI
```

## 📧 Support

- **Site web** : [9router.com](https://9router.com)
- **GitHub** : [github.com/decolua/9router](https://github.com/decolua/9router)
- **Problèmes** : [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 Contributeurs

Merci à tous les contributeurs qui ont contribué à améliorer 9Router !

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 Graphique d'étoiles

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

## 🔀 Forks

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — Un fork TypeScript complet de 9Router. Ajoute plus de 36 fournisseurs, un repli automatique à 4 niveaux, des API multimodales (images, embeddings, audio, TTS), un disjoncteur, un cache sémantique, des évaluations de LLM et un tableau de bord soigné. Plus de 368 tests unitaires. Disponible via npm et Docker.

---

## 🙏 Remerciements

Construit sur les épaules de géants :

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — implémentation originale en Go qui a inspiré ce port JavaScript.
- **[RTK](https://github.com/rtk-ai/rtk)** ![Stars](https://img.shields.io/github/stars/rtk-ai/rtk?style=flat&color=yellow) — économiseur de tokens en Rust. 9Router porte son pipeline de compression en JS → **−20 à 40 % de tokens d'entrée** sur chaque requête.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** ![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow) par **[@JuliusBrussee](https://github.com/JuliusBrussee)** — viral _"why use many token when few token do trick"_. 9Router adapte son prompt → **−65 % de tokens de sortie**.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** ![Stars](https://img.shields.io/github/stars/DietrichGebert/ponytail?style=flat&color=yellow) par **[@DietrichGebert](https://github.com/DietrichGebert)** — compétence de _"dev sénior fainéant"_. 9Router injecte sa hiérarchie YAGNI-d'abord → **moins de tokens, moins de code, des diffs plus courts**.

Un immense merci à ces auteurs — sans leur travail, les fonctionnalités d'économie de tokens de 9Router n'existeraient pas. Mettez-leur une ⭐ sur GitHub !

---

## 📄 Licence

Licence MIT - voir [LICENSE](LICENSE) pour plus de détails.

---

<div align="center">
  <sub>Conçu avec ❤️ pour les développeurs qui codent 24h/24 et 7j/7</sub>
</div>

