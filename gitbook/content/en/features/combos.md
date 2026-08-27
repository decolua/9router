# Combos (Custom Fallback Chains)

Combos let you define custom ordered sequences of models under a single alias name.

---

## How Combos Work

Instead of hardcoding a single model in your editor or CLI tool, you supply the name of a Combo. 9Router executes each model in the list until one responds successfully.

```
Request: model="daily-coding"
  ├─ 1. cc/claude-opus-4-7   (Primary choice)
  ├─ 2. glm/glm-5.1          (Fallback if Opus is rate limited)
  └─ 3. kr/claude-sonnet-4.5 (Fallback if GLM has no balance)
```

---

## Creating a Combo

1. Open Dashboard (`http://localhost:20128`) → **Combos**.
2. Click **Create Combo**.
3. Choose a name (e.g. `fast-dev`, `deep-reasoning`, `free-only`).
4. Select and order your models.
5. Click **Save**.

---

## Recommended Combo Recipes

### 1. Maximize Subscription + Cheap Backup
```
Name: smart-dev
1. cc/claude-opus-4-7
2. glm/glm-5.1
3. kr/claude-sonnet-4.5
```

### 2. Zero-Cost Free Chain
```
Name: free-dev
1. kr/claude-sonnet-4.5
2. kr/glm-5
3. oc/auto
```

### 3. Maximum Capability (Premium)
```
Name: apex-reasoning
1. cc/claude-opus-4-7
2. cx/gpt-5.5
3. gh/gpt-5.4
```
