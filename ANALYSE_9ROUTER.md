# Analyse du Projet 9Router

## 📋 Vue d'ensemble

**9Router** est un routeur AI local intelligent qui permet de connecter tous vos outils de développement AI (Claude Code, Cursor, Codex, Cline, etc.) à plus de 40 fournisseurs AI et 100+ modèles avec basculement automatique.

### Problème résolu
- ❌ Quotas d'abonnement qui expirent chaque mois sans être utilisés
- ❌ Limites de taux qui interrompent le codage
- ❌ APIs coûteuses ($20-50/mois par fournisseur)
- ❌ Changement manuel entre fournisseurs

### Solution apportée
- ✅ Maximise les abonnements - Suit les quotas, utilise tout avant réinitialisation
- ✅ Basculement automatique - Abonnement → Pas cher → Gratuit, zéro temps d'arrêt
- ✅ Multi-comptes - Round-robin entre comptes par fournisseur
- ✅ Universel - Fonctionne avec tous les outils CLI

---

## 🏗️ Architecture Technique

### Stack Technologique
- **Runtime**: Node.js 20+
- **Framework**: Next.js 16 (App Router)
- **UI**: React 19 + Tailwind CSS 4
- **Base de données**: LowDB (fichiers JSON)
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys


### Structure du Projet

```
9router/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API Routes
│   │   │   ├── v1/           # API compatible OpenAI
│   │   │   ├── v1beta/       # API beta
│   │   │   ├── auth/         # Authentification
│   │   │   ├── providers/    # Gestion des fournisseurs
│   │   │   ├── oauth/        # Flux OAuth
│   │   │   ├── combos/       # Combos de modèles
│   │   │   ├── usage/        # Suivi d''utilisation
│   │   │   └── ...
│   │   └── (dashboard)/       # Pages du dashboard
│   ├── sse/                   # Gestion SSE
│   │   ├── handlers/         # Gestionnaires de requêtes
│   │   └── services/         # Services métier
│   └── lib/                   # Bibliothèques
│       ├── localDb.js        # Persistance locale
│       └── usageDb.js        # Suivi d''utilisation
├── open-sse/                  # Cœur du routage SSE
│   ├── executors/            # Exécuteurs par fournisseur
│   ├── translator/           # Traduction de formats
│   │   ├── request/         # Traducteurs de requêtes
│   │   └── response/        # Traducteurs de réponses
│   ├── handlers/             # Gestionnaires principaux
│   ├── services/             # Services de routage
│   └── utils/                # Utilitaires
├── docs/                      # Documentation
├── tests/                     # Tests
└── cloud/                     # Sync cloud (optionnel)
```

---

## 🔄 Flux de Fonctionnement

### 1. Flux de Requête Principal

```
CLI Tool (Cursor/Claude Code/etc.)
    ↓ http://localhost:20128/v1/chat/completions
    ↓
src/app/api/v1/chat/completions/route.js
    ↓
src/sse/handlers/chat.js
    ↓ (détection format, validation API key)
    ↓
open-sse/handlers/chatCore.js
    ↓ (traduction format)
    ↓
open-sse/executors/{provider}.js
    ↓ (exécution vers fournisseur)
    ↓
Fournisseur AI (Claude/OpenAI/etc.)
    ↓ (streaming SSE)
    ↓
open-sse/translator/response/
    ↓ (traduction réponse)
    ↓
Retour au CLI Tool
```

### 2. Système de Basculement (Fallback)

**Niveau 1 - Basculement de compte:**
- Round-robin entre plusieurs comptes du même fournisseur
- Cooldown automatique en cas d''erreur

**Niveau 2 - Basculement de modèle (Combos):**
```
cc/claude-opus-4-6 (Abonnement)
  ↓ quota épuisé
glm/glm-4.7 ($0.6/1M tokens)
  ↓ limite budget
if/kimi-k2-thinking (GRATUIT)
```

### 3. Traduction de Formats

9Router traduit automatiquement entre différents formats d''API:

**Formats supportés:**
- OpenAI (format standard)
- Claude (Anthropic)
- Gemini (Google)
- Antigravity
- Kiro
- Cursor
- OpenAI Responses API


---

## 🔌 Composants Clés

### 1. Exécuteurs (Executors)

Chaque fournisseur a son exécuteur dans `open-sse/executors/`:

- `antigravity.js` - Fournisseur Antigravity
- `codex.js` - OpenAI Codex
- `cursor.js` - Cursor AI
- `gemini-cli.js` - Google Gemini CLI
- `github.js` - GitHub Copilot
- `kiro.js` - Kiro AI
- `iflow.js` - iFlow
- `qwen.js` - Qwen
- `default.js` - Exécuteur par défaut pour autres fournisseurs

### 2. Traducteurs (Translators)

**Traducteurs de requêtes** (`open-sse/translator/request/`):
- `openai-to-claude.js`
- `claude-to-openai.js`
- `openai-to-gemini.js`
- `gemini-to-openai.js`
- `openai-to-kiro.js`
- `openai-to-cursor.js`
- `antigravity-to-openai.js`
- etc.

**Traducteurs de réponses** (`open-sse/translator/response/`):
- Conversion des réponses streaming
- Normalisation des métadonnées d''utilisation
- Gestion des erreurs

### 3. Base de Données Locale

**Fichier principal:** `~/.9router/db.json` (ou `$DATA_DIR/db.json`)

**Contenu:**
```json
{
  "providerConnections": [],
  "providerNodes": [],
  "modelAliases": {},
  "combos": [],
  "apiKeys": [],
  "settings": {},
  "pricing": {}
}
```

**Fichiers d''utilisation:**
- `~/.9router/usage.json` - Historique d''utilisation
- `~/.9router/log.txt` - Logs de requêtes

---

## 🔐 Système d''Authentification

### 1. Dashboard (Cookie-based)
- Login avec mot de passe (défaut: `123456` ou `$INITIAL_PASSWORD`)
- JWT stocké dans cookie HTTP-only
- Middleware de protection dans `src/proxy.js`

### 2. API v1 (Bearer Token)
- Clés API générées dans le dashboard
- Validation dans `src/sse/services/auth.js`
- Optionnel (configurable via `requireApiKey`)

### 3. OAuth Providers
- Flux OAuth 2.0 avec PKCE
- Refresh automatique des tokens
- Support device code flow
- Gestion dans `src/app/api/oauth/`

---

## 📊 Fournisseurs Supportés

### Fournisseurs OAuth (Gratuits/Abonnement)
- **Claude Code** (`cc/`) - Pro/Max
- **Codex** (`cx/`) - Plus/Pro  
- **Gemini CLI** (`gc/`) - GRATUIT
- **GitHub Copilot** (`gh/`)
- **Kiro** (`kr/`) - GRATUIT
- **Cursor** - Abonnement
- **Antigravity** - GRATUIT
- **iFlow** (`if/`) - GRATUIT
- **Qwen** (`qw/`) - GRATUIT

### Fournisseurs API Key
- **OpenAI** - API payante
- **Anthropic** - API payante
- **GLM** (`glm/`) - $0.6/1M tokens
- **MiniMax** (`minimax/`) - $0.2/1M tokens
- **OpenRouter** - Agrégateur
- **Kimi** - API

### Nœuds Compatibles
- Tout endpoint compatible OpenAI
- Tout endpoint compatible Anthropic


---

## 🛠️ Comment Contribuer au Projet

### 1. Configuration de l''Environnement de Développement

```bash
# Cloner votre fork
git clone https://github.com/VOTRE-USERNAME/9router.git
cd 9router

# Installer les dépendances
npm install

# Copier le fichier d''environnement
cp .env.example .env

# Éditer .env avec vos paramètres
# Minimum requis:
# JWT_SECRET=votre-secret-jwt
# INITIAL_PASSWORD=votre-mot-de-passe

# Lancer en mode développement
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

**Accès:**
- Dashboard: http://localhost:20128/dashboard
- API: http://localhost:20128/v1

### 2. Structure de Contribution

**Branches:**
```bash
# Créer une branche pour votre feature
git checkout -b feature/nom-de-votre-feature

# Ou pour un bugfix
git checkout -b fix/description-du-bug
```

**Commits:**
```bash
# Format recommandé
git commit -m "feat: ajouter support pour nouveau fournisseur X"
git commit -m "fix: corriger traduction OpenAI vers Claude"
git commit -m "docs: mettre à jour guide de contribution"
```

### 3. Types de Contributions

#### A. Ajouter un Nouveau Fournisseur

**Étape 1: Créer l''exécuteur**

Créer `open-sse/executors/nouveau-provider.js`:

```javascript
import { BaseExecutor } from "./base.js";

export class NouveauProviderExecutor extends BaseExecutor {
  async execute(translatedBody, credentials, log) {
    const response = await fetch(credentials.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${credentials.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(translatedBody)
    });
    return response;
  }
}
```

**Étape 2: Enregistrer l''exécuteur**

Dans `open-sse/executors/index.js`:

```javascript
import { NouveauProviderExecutor } from "./nouveau-provider.js";

const executors = {
  "nouveau-provider": new NouveauProviderExecutor(),
};
```

**Étape 3: Ajouter la configuration**

Dans `open-sse/config/providerModels.js`:

```javascript
export const PROVIDER_CONFIGS = {
  "nouveau-provider": {
    format: FORMATS.OPENAI,
    models: ["model-1", "model-2"],
    requiresAuth: true,
  }
};
```

**Étape 4: Tester**

```bash
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d ''{
    "model": "nouveau-provider/model-1",
    "messages": [{"role": "user", "content": "test"}]
  }''
```

#### B. Corriger un Bug

1. Identifier le bug dans les issues GitHub
2. Reproduire localement
3. Écrire un test (si applicable)
4. Corriger le bug
5. Vérifier que le test passe
6. Soumettre une PR

#### C. Améliorer la Documentation

**Fichiers à éditer:**
- `README.md` - Documentation principale
- `docs/ARCHITECTURE.md` - Architecture technique
- `i18n/README.*.md` - Traductions
- Commentaires dans le code

#### D. Ajouter des Tests

Le projet utilise Vitest dans le dossier `tests/`:

```javascript
import { describe, it, expect } from ''vitest'';
import { translateRequest } from ''../open-sse/translator/index.js'';

describe(''Translator'', () => {
  it(''should translate OpenAI to Claude'', () => {
    const input = {
      messages: [{role: "user", content: "Hello"}]
    };
    const result = translateRequest(''openai'', ''claude'', ''model'', input);
    expect(result).toBeDefined();
  });
});
```


### 4. Checklist Avant de Soumettre une PR

- [ ] Le code compile sans erreur (`npm run build`)
- [ ] Le code suit le style du projet
- [ ] Les tests passent (si applicable)
- [ ] La documentation est à jour
- [ ] Les commits sont clairs et descriptifs
- [ ] La PR décrit clairement les changements
- [ ] Pas de secrets/tokens dans le code
- [ ] Testé localement

### 5. Processus de Pull Request

**1. Push vers votre fork:**
```bash
git push origin feature/votre-feature
```

**2. Créer la PR sur GitHub:**
- Aller sur https://github.com/decolua/9router
- Cliquer "New Pull Request"
- Sélectionner votre branche
- Remplir le template de PR

**3. Template de PR:**
```markdown
## Description
Brève description des changements

## Type de changement
- [ ] Bug fix
- [ ] Nouvelle fonctionnalité
- [ ] Breaking change
- [ ] Documentation

## Tests effectués
Décrire les tests effectués

## Checklist
- [ ] Code testé localement
- [ ] Documentation mise à jour
- [ ] Pas de breaking changes
```

**4. Répondre aux reviews:**
- Les mainteneurs vont review votre code
- Répondre aux commentaires
- Faire les modifications demandées
- Push les changements (la PR se met à jour automatiquement)

### 6. Zones Prioritaires pour Contributions

**Facile (Good First Issue):**
- Corriger des typos dans la documentation
- Ajouter des traductions (i18n)
- Améliorer les messages d''erreur
- Ajouter des exemples dans la doc

**Moyen:**
- Ajouter un nouveau fournisseur
- Améliorer l''UI du dashboard
- Ajouter des tests
- Optimiser les performances

**Avancé:**
- Améliorer le système de traduction
- Optimiser le streaming SSE
- Ajouter des fonctionnalités de cache
- Améliorer la gestion des erreurs

### 7. Ressources Utiles

**Documentation:**
- Architecture: `docs/ARCHITECTURE.md`
- Changelog: `CHANGELOG.md`
- Docker: `DOCKER.md`

**Code Important:**
- Point d''entrée API: `src/app/api/v1/chat/completions/route.js`
- Cœur du routage: `open-sse/handlers/chatCore.js`
- Traduction: `open-sse/translator/index.js`
- Base de données: `src/lib/localDb.js`
- Gestion usage: `src/lib/usageDb.js`

**Outils de Debug:**
```bash
# Activer les logs détaillés
ENABLE_REQUEST_LOGS=true npm run dev

# Les logs seront dans:
# - logs/requests/
# - logs/translator/
```

### 8. Communication

**Où poser des questions:**
- GitHub Issues: https://github.com/decolua/9router/issues
- GitHub Discussions: Pour questions générales
- Pull Request comments: Pour questions spécifiques au code

**Avant de commencer:**
- Vérifier les issues existantes
- Commenter l''issue pour dire que vous travaillez dessus
- Demander des clarifications si nécessaire


---

## 🎯 Exemples de Contributions Réussies

### Exemple 1: Ajout du Provider Cursor

**Commits:**
- `137f315` - Add Cursor executor
- `0a026c7` - Add Cursor OAuth flow

**Fichiers modifiés:**
- `open-sse/executors/cursor.js` (nouveau)
- `open-sse/executors/index.js`
- `open-sse/translator/request/openai-to-cursor.js` (nouveau)
- `src/app/api/oauth/cursor/` (nouveau)

### Exemple 2: Fix de Bug

**Issue:** GitHub Copilot model mapping issues
**Commit:** `95fd950` - Fix GitHub Copilot model mapping/selection issues
**Fichiers:** `open-sse/executors/github.js`

### Exemple 3: Amélioration Documentation

**Commit:** Architecture documentation updates
**Fichiers:** `docs/ARCHITECTURE.md`

---

## 📝 Conventions de Code

### Style JavaScript
```javascript
// Utiliser import/export ES6
import { something } from "./module.js";

// Fonctions async/await
async function handleRequest() {
  const result = await fetchData();
  return result;
}

// Destructuring
const { provider, model } = modelInfo;

// Template literals
log.debug(`Processing ${model} from ${provider}`);
```

### Nommage
- **Fichiers:** kebab-case (`chat-handler.js`)
- **Classes:** PascalCase (`ChatHandler`)
- **Fonctions:** camelCase (`handleChat`)
- **Constants:** UPPER_SNAKE_CASE (`DEFAULT_TIMEOUT`)

### Logs
```javascript
import * as log from "../utils/logger.js";

log.debug("CATEGORY", "Message de debug");
log.info("CATEGORY", "Message d''info");
log.warn("CATEGORY", "Message d''avertissement");
log.error("CATEGORY", "Message d''erreur");
```

---

## 🚀 Déploiement

### Build Production
```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 npm run start
```

### Docker
```bash
# Build
docker build -t 9router .

# Run
docker run -p 20128:20128 \
  -e JWT_SECRET=your-secret \
  -e INITIAL_PASSWORD=your-password \
  -v ~/.9router:/root/.9router \
  9router
```

### Variables d''Environnement Importantes

```bash
# Authentification
JWT_SECRET=votre-secret-jwt-aleatoire
INITIAL_PASSWORD=votre-mot-de-passe
API_KEY_SECRET=secret-pour-generer-api-keys

# Stockage
DATA_DIR=/chemin/vers/data  # Défaut: ~/.9router

# URLs
NEXT_PUBLIC_BASE_URL=http://localhost:20128
NEXT_PUBLIC_CLOUD_URL=https://cloud.9router.com  # Optionnel

# Logs
ENABLE_REQUEST_LOGS=true  # Pour debug

# Proxy sortant (optionnel)
HTTP_PROXY=http://proxy:8080
HTTPS_PROXY=http://proxy:8080
```

---

## 💡 Conseils pour Bien Démarrer

### 1. Comprendre le Flux de Requête

Commencez par suivre une requête du début à la fin:

1. Ouvrir `src/app/api/v1/chat/completions/route.js`
2. Suivre l''appel vers `src/sse/handlers/chat.js`
3. Puis vers `open-sse/handlers/chatCore.js`
4. Observer la traduction dans `open-sse/translator/`
5. Voir l''exécution dans `open-sse/executors/`

### 2. Tester Localement

```bash
# Terminal 1: Lancer 9Router
npm run dev

# Terminal 2: Tester avec curl
curl -X POST http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d ''{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }''
```

### 3. Explorer le Dashboard

1. Ouvrir http://localhost:20128/dashboard
2. Login avec le mot de passe (défaut: `123456`)
3. Explorer:
   - Providers: Voir les fournisseurs connectés
   - Combos: Voir les combos de basculement
   - Usage: Voir l''historique d''utilisation
   - Endpoint: Générer des clés API

### 4. Lire le Code Existant

Avant d''ajouter un nouveau fournisseur, étudiez un fournisseur similaire:

- Pour OAuth: Regarder `open-sse/executors/github.js`
- Pour API Key: Regarder `open-sse/executors/default.js`
- Pour format spécial: Regarder `open-sse/executors/gemini-cli.js`

### 5. Utiliser les Logs

```bash
# Activer tous les logs
ENABLE_REQUEST_LOGS=true npm run dev

# Observer les logs en temps réel
tail -f logs/requests/*.log
tail -f logs/translator/*.log
```

---

## 🔍 Points d''Attention

### Sécurité
- Ne jamais commiter de tokens/secrets
- Utiliser `.env` pour les secrets
- Masquer les clés dans les logs avec `log.maskKey()`

### Performance
- Le streaming SSE doit être efficace
- Éviter les buffers trop larges
- Utiliser les streams Node.js correctement

### Compatibilité
- Tester avec plusieurs CLI tools (Cursor, Claude Code, etc.)
- Vérifier la compatibilité OpenAI API
- Tester le streaming et non-streaming

---

## 📞 Support et Ressources

- **Website:** https://9router.com
- **GitHub:** https://github.com/decolua/9router
- **Issues:** https://github.com/decolua/9router/issues
- **Discussions:** https://github.com/decolua/9router/discussions

---

## 📄 Licence

MIT License - Voir `LICENSE` pour détails

---

## 🎉 Conclusion

9Router est un projet open-source actif qui accueille les contributions. Que vous soyez débutant ou expérimenté, il y a toujours des façons de contribuer:

- 📝 Améliorer la documentation
- 🐛 Corriger des bugs
- ✨ Ajouter de nouvelles fonctionnalités
- 🌐 Ajouter des traductions
- 🧪 Tester et reporter des problèmes

**Bon courage pour vos contributions !**

---

*Document créé le 2026-04-15*
