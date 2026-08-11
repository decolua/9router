<div align="center">
  <img src="../images/9router.png?1" alt="Painel do 9Router" width="800"/>

  # 9Router — roteador de IA gratuito e economizador de tokens

  **Continue programando sem interrupções. Economize de 20% a 40% dos tokens com o RTK e use fallback automático para modelos de IA gratuitos ou econômicos.**

  **Conecte Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw e outras ferramentas a mais de 40 provedores e 100 modelos.**

  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/master/LICENSE)

  [🚀 Início rápido](#-início-rápido) • [💡 Recursos](#-principais-recursos) • [📖 Configuração](#-guia-de-configuração) • [🌐 Site](https://9router.com)

  [🇺🇸 English](../README.md)
</div>

---

## 🤔 Por que usar o 9Router?

O 9Router centraliza diferentes provedores e modelos de IA em um único endpoint compatível com OpenAI. Ele ajuda a evitar interrupções por limite de uso, aproveitar melhor assinaturas existentes e reduzir custos com APIs.

Problemas que ele resolve:

- cotas de assinatura que expiram sem serem utilizadas;
- limites de requisição que interrompem o trabalho;
- resultados de ferramentas, como `git diff`, `grep` e `ls`, que consomem muitos tokens;
- troca manual entre provedores;
- custo de manter várias APIs separadas.

Com o 9Router, você pode:

- economizar de 20% a 40% dos tokens em resultados de ferramentas com o RTK Token Saver;
- acompanhar cotas e datas de renovação;
- alternar automaticamente entre assinatura, modelos econômicos e modelos gratuitos;
- usar várias contas do mesmo provedor em round-robin;
- conectar diferentes clientes a um único endpoint.

---

## 🔄 Como funciona

```text
Sua ferramenta de IA
        │
        │ http://localhost:20128/v1
        ▼
9Router
  • economia de tokens
  • conversão de formatos
  • acompanhamento de cotas
  • renovação automática de tokens
        │
        ├── Nível 1: assinatura
        ├── Nível 2: modelos econômicos
        └── Nível 3: modelos gratuitos
```

O resultado é um fluxo de trabalho mais estável, com fallback automático e menor custo.

---

## ⚡ Início rápido

### 1. Instale globalmente

```bash
npm install -g 9router
9router
```

O painel será aberto em `http://localhost:20128`.

### 2. Conecte um provedor

No painel, acesse **Providers** e conecte um provedor. Para começar sem chave de API, você pode experimentar o **OpenCode Free**. As opções e cotas gratuitas podem mudar ao longo do tempo.

### 3. Configure sua ferramenta

Use estes dados no Claude Code, Codex, OpenClaw, Cursor, Cline ou em outro cliente compatível:

```text
Endpoint: http://localhost:20128/v1
API Key:  copie a chave exibida no painel
Model:    selecione um modelo disponível no painel
```

Pronto: as requisições do cliente passarão pelo 9Router.

### Executar a partir do código-fonte

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

Modo de produção:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URLs padrão:

- painel: `http://localhost:20128/dashboard`;
- API compatível com OpenAI: `http://localhost:20128/v1`.

---

## 🛠️ Ferramentas compatíveis

O 9Router funciona com ferramentas que aceitam um endpoint de API configurável, incluindo:

- Claude Code;
- Codex;
- Cursor;
- Cline, Continue e Roo Code;
- OpenClaw;
- OpenCode;
- GitHub Copilot;
- Antigravity;
- Gemini e outros clientes compatíveis.

Consulte o [README principal](../README.md#%EF%B8%8F-supported-cli-tools) para ver a lista atualizada.

---

## 🌐 Provedores

O projeto oferece suporte a três grupos principais:

### Provedores com OAuth

Conexões baseadas em autenticação, como Claude Code, Codex, GitHub Copilot, Cursor e outros provedores disponíveis no painel.

### Provedores gratuitos

As opções gratuitas variam com o tempo e podem ter cotas, períodos promocionais ou requisitos específicos. Verifique no painel e no [README em inglês](../README.md#-free-providers) quais estão disponíveis atualmente.

### Provedores com chave de API

Entre os provedores compatíveis estão OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, Groq, Mistral, xAI, GLM, Kimi e MiniMax, além de endpoints personalizados compatíveis com OpenAI.

Também é possível conectar provedores executados localmente, como Ollama e LM Studio.

---

## 💡 Principais recursos

### 🚀 RTK Token Saver

Comprime automaticamente o conteúdo de `tool_result`, reduzindo o número de tokens enviados ao modelo. O recurso é especialmente útil em sessões de programação que produzem saídas extensas de terminal e leitura de arquivos.

### 🧠 Headroom Token Saver

Pode resumir o contexto antes que ele alcance o limite do modelo, preservando espaço para a resposta e para novas chamadas de ferramentas.

### 🎯 Fallback inteligente em três níveis

Permite definir uma sequência como:

1. usar primeiro a assinatura já paga;
2. ao atingir a cota, mudar para um modelo econômico;
3. se necessário, usar um provedor gratuito.

### 📊 Acompanhamento de cotas

Exibe uso, saldo e horários de renovação dos provedores compatíveis.

### 🔄 Conversão de formatos

Traduz requisições e respostas entre formatos como OpenAI, Anthropic e outros, permitindo que clientes e provedores diferentes trabalhem juntos.

### 👥 Várias contas

Distribui as requisições entre múltiplas contas do mesmo provedor e pode ignorar temporariamente contas sem cota disponível.

### 🎨 Combos personalizados

Permite agrupar modelos e definir prioridade, fallback e regras de roteamento para cada fluxo de trabalho.

### 📝 Logs e análise de uso

Registra requisições, latência, consumo de tokens, custos e falhas para facilitar o diagnóstico e o controle de gastos.

---

## 🎯 Exemplos de uso

### Aproveitar uma assinatura com segurança

Configure sua assinatura como primeira opção e adicione um modelo econômico como fallback. Assim, o trabalho continua quando a cota principal termina.

### Trabalhar sem custo de API

Crie um combo apenas com os provedores gratuitos disponíveis. Lembre-se de que disponibilidade e limites podem mudar.

### Operação contínua

Combine assinatura, API econômica e provedor gratuito para reduzir a chance de interrupção durante tarefas longas.

---

## 📖 Guia de configuração

### Claude Code

Conecte a conta do Claude no painel e configure o Claude Code para usar o endpoint do 9Router. Selecione no painel o modelo ou combo desejado.

### OpenAI Codex

Conecte sua conta OpenAI/Codex no painel. Em seguida, use o endpoint compatível com OpenAI e a chave gerada pelo 9Router na configuração do cliente.

### Cursor, Cline e clientes semelhantes

Procure a opção de provedor OpenAI-compatible ou Custom OpenAI e informe:

```text
Base URL: http://localhost:20128/v1
API Key:  chave exibida no painel
Model:    nome do modelo ou combo escolhido
```

Os campos podem ter nomes diferentes dependendo do cliente.

---

## 🐳 Docker

Consulte a configuração atual no [`docker-compose.yml`](../docker-compose.yml). Em geral, o serviço pode ser iniciado com:

```bash
docker compose up -d
```

Para acompanhar os logs:

```bash
docker compose logs -f
```

Não exponha o painel ou o endpoint publicamente sem autenticação, regras de firewall e uma configuração adequada de proxy reverso.

---

## 🔐 Segurança

- Não publique chaves, tokens OAuth, cookies ou arquivos `.env`.
- Restrinja o acesso ao painel e à API quando executar o serviço em um servidor.
- Use HTTPS e autenticação ao expor o serviço fora da máquina local.
- Revise os logs antes de compartilhá-los, pois podem conter dados das requisições.

---

## 🐛 Solução de problemas

### O painel não abre

Confirme se o processo está em execução e se a porta `20128` está livre. Verifique também as variáveis `PORT` e `NEXT_PUBLIC_BASE_URL`.

### O cliente não encontra modelos

Abra o painel, confirme que há um provedor conectado e atualize a lista de modelos. Verifique se o cliente usa a URL com `/v1`.

### Erro de autenticação

Copie novamente a chave exibida pelo 9Router e confirme que ela foi configurada no cliente, não a chave original do provedor, salvo quando a tela solicitar explicitamente essa credencial.

### O provedor atingiu o limite

Adicione outro modelo ao combo ou aguarde a renovação da cota. O fallback só funciona quando há uma alternativa válida configurada.

Para detalhes e problemas conhecidos, consulte as [issues do projeto](https://github.com/decolua/9router/issues).

---

## 📝 API

### Chat Completions

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer SUA_CHAVE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "SEU_MODELO",
    "messages": [{"role": "user", "content": "Olá!"}]
  }'
```

### Listar modelos

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer SUA_CHAVE"
```

---

## 🤝 Como contribuir

Contribuições são bem-vindas. Crie um fork, abra uma branch com uma alteração focada e envie um pull request para o repositório principal. Antes de publicar, evite incluir credenciais ou arquivos gerados localmente.

---

## 📧 Suporte

- [Issues](https://github.com/decolua/9router/issues)
- [Discussões](https://github.com/decolua/9router/discussions)
- [Site oficial](https://9router.com)

---

## 📄 Licença

Este projeto é distribuído sob a licença indicada no arquivo [LICENSE](../LICENSE).

---

<div align="center">

**Feito com ❤️ pela comunidade do 9Router.**

[Voltar ao início](#9router--roteador-de-ia-gratuito-e-economizador-de-tokens)

</div>
