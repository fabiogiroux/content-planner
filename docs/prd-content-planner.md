# Content Planner @girru.ai — Product Requirements Document (PRD)

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-04-08 | 1.0 | Versão inicial | Orion / Fabio Giroux |

---

## 1. Goals and Background Context

### Goals

- Permitir que Fabio visualize, num único painel, todos os posts e stories agendados para o mês no Instagram @girru.ai
- Automatizar a publicação de posts aprovados pelo time de conteúdo sem intervenção manual no Meta Business Suite
- Integrar o pipeline de criação de conteúdo (Squad Design → aprovação → publicação) de forma fluida e rastreável
- Eliminar o problema atual de imagens servidas via HTTP — garantir URLs HTTPS públicas para a Meta API aceitar
- Prover histórico de publicações (publicado, falhou, agendado) com visualização por calendário

### Background Context

O @girru.ai é o perfil de conteúdo do EasyVision (SaaS de ficha técnica para food service). O time de conteúdo roda 7 squads em sequência: estratégia → calendário → copy → design → revisão → vídeo → métricas. O Squad de Design gera slides visuais como PNGs via Playwright. Esses PNGs precisam ser publicados no Instagram no horário certo, sem que Fabio precise fazer upload manual.

Hoje existe um protótipo funcional em `/home/administrator/instagram-scheduler/` com backend Node.js, cron job e webapp de calendário. O bloqueio principal é a ausência de URLs HTTPS para as imagens — a Meta API rejeita URLs HTTP. A solução é deployar o scheduler no EasyPanel (projeto "Automation"), que já provê HTTPS automático via Let's Encrypt.

---

## 2. Functional Requirements

- **FR1:** O sistema deve servir as imagens dos posts via HTTPS publicamente acessível (URL formato `https://scheduler.dominio.com/uploads/arquivo.png`)
- **FR2:** O webapp deve exibir um calendário mensal com marcadores visuais por tipo de conteúdo (Carrossel, Reel, Post, Story) em cada dia
- **FR3:** Ao clicar em um dia do calendário, o sistema deve exibir todos os posts e stories agendados para aquele dia, separados por tipo
- **FR4:** O sistema deve suportar agendamento de posts do tipo: Carrossel (múltiplas imagens), Post simples, Reel (thumbnail), Story
- **FR5:** O sistema deve publicar automaticamente via Instagram Graph API quando chegar o horário agendado (cron a cada 5 minutos)
- **FR6:** O sistema deve permitir publicação imediata ("Publicar agora") com feedback de sucesso ou erro
- **FR7:** O sistema deve registrar o status de cada post: `scheduled` → `publishing` → `published` / `failed`
- **FR8:** O sistema deve expor um script CLI (`add-to-schedule.js`) chamável pelo Squad de Design ao final de cada rodada de aprovação, que copia as imagens para o volume de uploads e registra o post no schedule
- **FR9:** O script CLI deve receber como argumentos: `--type`, `--title`, `--caption`, `--date`, `--images`
- **FR10:** O sistema deve suportar carrossel com até 10 slides, criando containers filhos individuais e depois o container carousel na Meta API
- **FR11:** O webapp deve auto-atualizar o status dos posts a cada 30 segundos sem recarregar a página
- **FR12:** O sistema deve ter uma variável de ambiente `PUBLIC_URL` que define a URL base HTTPS para composição das URLs de imagem enviadas à Meta API

## 3. Non-Functional Requirements

- **NFR1:** A aplicação deve rodar como serviço Docker no EasyPanel, projeto "Automation", com HTTPS automático via Let's Encrypt
- **NFR2:** Os dados (schedule.json) e imagens (uploads/) devem persistir em volumes Docker — reinicializações do serviço não podem perder dados
- **NFR3:** O token de acesso Instagram deve ser armazenado como variável de ambiente no EasyPanel (nunca em código ou arquivos commitados)
- **NFR4:** O webapp deve usar o Design System Warm Indigo do EasyVision: bg `#131214`, primary `#8B82FF`, font Manrope, sem emojis excessivos
- **NFR5:** O cron de publicação deve rodar a cada 5 minutos e ser tolerante a falhas (falha em um post não impede os demais)
- **NFR6:** O sistema deve logar todas as operações de publicação com timestamp, post ID e resultado no stdout do container (acessível pelo EasyPanel)
- **NFR7:** O serviço deve iniciar na porta `3001` internamente, exposto via proxy reverso do EasyPanel

---

## 4. User Interface Design Goals

### UX Vision
Dashboard minimalista de controle editorial. O Fabio acessa uma vez por semana para conferir o que está agendado e uma vez ao mês para alimentar os novos posts aprovados. Não é uma ferramenta de uso diário — deve ser rápida de ler e confiável.

### Telas principais

| Tela | Descrição |
|------|-----------|
| **Calendário Mensal** | Visão do mês inteiro com pontinhos coloridos por tipo de conteúdo em cada dia. Click num dia abre o detalhe. |
| **Detalhe do Dia** | Lista de posts (feed) e stories do dia selecionado, com thumbnail, horário, status chip, caption preview e ações (Publicar agora / Cancelar) |
| **Painel de Agendamento** | Formulário lateral para adicionar novo post: tipo, título interno, upload de imagens (múltiplas para carrossel em ordem), caption, data/hora |

### Branding
Design System EasyVision "Warm Indigo":
- Background: `#131214` | Surface: `#1B191D` | Surface-2: `#24212A`
- Primary: `#8B82FF` (lavanda) | Success: `#5BD98B` | Warning: `#F0C246` | Danger: `#F07070`
- Font: **Manrope** (todos os pesos)
- Feed posts: `1080×1080px` | Stories: `1080×1920px`

### Target platform
Web — acesso via browser desktop (SSH tunnel ou URL HTTPS direta)

---

## 5. Technical Assumptions

### Stack
- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js (já implementado)
- **Frontend:** Vanilla HTML/CSS/JS (sem build step — single file `public/index.html`)
- **Storage:** File-based (`data/schedule.json` + `uploads/`) via volumes Docker
- **Scheduler:** `node-cron` (já implementado)
- **Upload:** `multer` (já implementado)

### Infraestrutura
- **Deploy:** EasyPanel — projeto **"Automation"** — novo serviço `scheduler`
- **HTTPS:** Let's Encrypt automático via EasyPanel (subdomínio a definir: ex. `scheduler.girru.ai`)
- **Volumes Docker:** dois volumes persistentes — `/app/data` e `/app/uploads`
- **Env vars no EasyPanel:**
  - `INSTAGRAM_USER_TOKEN` — Facebook User Access Token com `instagram_content_publish`
  - `PUBLIC_URL` — URL HTTPS pública do serviço (ex: `https://scheduler.girru.ai`)
  - `PORT=3001`

### Instagram Graph API
- **App:** `girru.ai` (developers.facebook.com) — modo Development
- **Page ID:** `968835909655890`
- **IG Business Account ID:** `17841440286252925`
- **Limitação:** App em Development mode — `scheduled_publish_time` nativo não funciona. **Workaround:** cron local publica no horário (resultado prático idêntico)
- **Token expira em:** ~60 dias — deve ser renovado manualmente no Graph API Explorer

### Descoberta crítica — VPS IP bloqueado pelos crawlers da Meta (2026-04-08)

Testado em 08/04/2026: a Meta API rejeita imagens hospedadas no VPS (`62.169.27.232`), incluindo via EasyPanel (`web.easyvision.h4xjiq.easypanel.host`). O erro retornado é `error_subcode: 2207052` — "Falha ao baixar mídia. O URI da mídia não atende aos nossos requisitos."

**Causa:** Os crawlers da Meta não conseguem acessar o IP do VPS. Imagens em domínios de CDN conhecidos (Unsplash, catbox.moe) funcionam normalmente.

**Implicação para o deploy:** O serviço `scheduler` no EasyPanel Automation receberá um **novo domínio** (`scheduler.h4xjiq.easypanel.host` ou domínio customizado). Esse domínio ainda não foi testado com a Meta API. **Deve-se testar a publicação de imagem imediatamente após o deploy (Story 1.3) antes de considerar o Epic 1 concluído.** Se o novo domínio também for bloqueado, o `PUBLIC_URL` deverá apontar para um CDN externo (opção catbox.moe ou Cloudinary).

**Workaround validado (publicações manuais):** Upload para `catbox.moe` via API pública (sem conta, sem API key, limite 200MB/arquivo):
```bash
curl -F "reqtype=fileupload" -F "fileToUpload=@/caminho/slide.png" https://catbox.moe/user/api.php
# retorna: https://files.catbox.moe/xxxx.png
```
Esse método foi usado para publicar o Post 6 (08/04/2026) com sucesso.

### Código base existente
Todo o código está em `/home/administrator/instagram-scheduler/` no VPS. A implementação na próxima sessão é essencialmente:
1. Criar `Dockerfile`
2. Criar serviço no EasyPanel com volumes e env vars
3. Ajustar `server.js` para usar `PUBLIC_URL` do env
4. Testar publicação real com um slide via POST `/api/posts/:id/publish-now` — **confirmar que o novo domínio não está bloqueado pela Meta antes de avançar**

---

## 6. Epics

### Epic 1 — Deploy & Infraestrutura HTTPS
**Objetivo:** Dockerizar o scheduler e deployar no EasyPanel com HTTPS, volumes persistentes e env vars configuradas. Publicação de carrossel funcionando de ponta a ponta.

#### Story 1.1 — Dockerfile e configuração Docker
Como desenvolvedor, quero um Dockerfile para o scheduler, para que o EasyPanel possa buildar e rodar o serviço.

**Acceptance Criteria:**
1. `Dockerfile` criado em `/home/administrator/instagram-scheduler/` com Node.js 20 Alpine
2. `.dockerignore` excluindo `node_modules`, `uploads/`, `data/`
3. `docker build` executa sem erro localmente
4. Container sobe e responde em `GET /api/status` com `200 OK`
5. Volumes `/app/data` e `/app/uploads` declarados no Dockerfile

#### Story 1.2 — Serviço no EasyPanel (Automation)
Como Fabio, quero o scheduler rodando no projeto Automation do EasyPanel, para que tenha URL HTTPS pública.

**Acceptance Criteria:**
1. Serviço `scheduler` criado no projeto `Automation` do EasyPanel
2. Build via GitHub repo (ou upload direto) configurado
3. Volumes persistentes mapeados: `/app/data` e `/app/uploads`
4. Env vars configuradas: `INSTAGRAM_USER_TOKEN`, `PUBLIC_URL`, `PORT=3001`
5. Domínio HTTPS ativo e acessível no browser
6. `GET https://[dominio]/api/status` retorna `{"tokenConfigured":true,...}`

#### Story 1.3 — Publicação real de carrossel
Como Fabio, quero publicar um carrossel via botão "Publicar agora" no webapp, para validar o fluxo completo com HTTPS do novo domínio.

> **Nota (08/04/2026):** O Post 6 (CMV Real, 6 slides) já foi publicado manualmente via catbox.moe (Instagram Post ID: `18049067291720654`). Esta story deve usar um post de teste novo para validar o fluxo completo via EasyPanel.

**Acceptance Criteria:**
1. Post de teste adicionado ao schedule com slides via `add-to-schedule.js`
2. URLs das imagens usam `PUBLIC_URL` HTTPS do novo domínio EasyPanel
3. Meta API aceita as URLs (confirmar que o IP do EasyPanel Automation não está bloqueado)
4. Botão "Publicar agora" chama a Meta API com sucesso e post aparece no Instagram
5. Status atualizado para `published` no webapp com o Instagram Post ID
6. **Se domínio bloqueado:** implementar fallback para upload automático via catbox.moe antes de enviar à Meta API

---

### Epic 2 — Integração com Pipeline de Conteúdo
**Objetivo:** O Squad de Design chama o script de agendamento automaticamente ao final de cada rodada aprovada. O Content Planner reflete o calendário editorial completo.

#### Story 2.1 — Pipeline design → schedule integrado
Como Diego Design (squad), quero que ao final de cada rodada aprovada o script `add-to-schedule.js` seja executado automaticamente, para que o post apareça no Content Planner sem etapa manual.

**Acceptance Criteria:**
1. `add-to-schedule.js` atualizado para usar `PUBLIC_URL` do `.env` como base das URLs
2. Script copia imagens para o volume de uploads do serviço EasyPanel (via scp ou mount compartilhado)
3. Memória do Squad de Design atualizada com instrução de chamada do script
4. Teste: executar script com Post 3 (Ficha Técnica) após design aprovado → aparece no calendário

#### Story 2.2 — Calendário editorial pré-populado
Como Fabio, quero ver os 17 posts de Abril 2026 no calendário mesmo antes de todas as artes estarem prontas, para ter visão do mês completo.

**Acceptance Criteria:**
1. Script de seed `seed-calendar.js` criado que lê `calendario-aprovado.md` e popula o schedule com status `draft` para posts sem imagem
2. Posts `draft` aparecem no calendário com marcador diferente (pontinho vazio/outline)
3. Quando design for aprovado e `add-to-schedule.js` rodar, status sobe de `draft` para `scheduled`
4. Posts dos dias 14, 15, 16, 17, 18, 19, 20 de Abril visíveis no calendário

---

## 7. Contexto técnico para a próxima sessão

### Arquivos existentes no VPS

```
/home/administrator/instagram-scheduler/
├── server.js          ← backend completo (Express + cron + Instagram API)
├── add-to-schedule.js ← CLI para registrar posts aprovados
├── publish.js         ← módulo de publicação Meta API
├── start.sh           ← inicia com token do .env
├── package.json       ← deps: express, multer, node-cron
├── public/
│   └── index.html     ← webapp calendário mensal (Warm Indigo)
├── data/
│   └── schedule.json  ← 2 posts: Post1 (published) + Post6 (scheduled)
└── uploads/           ← 11 PNGs dos slides já copiados
```

### Credenciais conhecidas

| Variável | Valor |
|----------|-------|
| `INSTAGRAM_USER_TOKEN` | Ver `/home/administrator/assistente-pessoal/.env` |
| `INSTAGRAM_PAGE_ID` | `968835909655890` |
| `INSTAGRAM_USER_ID` (IG Business) | `17841440286252925` |
| EasyPanel URL | `https://[ip-do-vps]` (autenticação via GitHub secrets) |
| EasyPanel projeto alvo | `Automation` |

### O que NÃO fazer na próxima sessão
- Não tentar servir imagens via porta 3001 HTTP — Meta rejeita
- Não tentar agendamento nativo (`scheduled_publish_time`) — app em Development mode
- Não reescrever o frontend do zero — só ajustar `PUBLIC_URL`
- Não assumir que o domínio EasyPanel vai funcionar com a Meta sem testar — ver descoberta de bloqueio de IP

### Próximo passo imediato
Criar `Dockerfile` → criar serviço EasyPanel → configurar env vars → **testar imediatamente se o novo domínio é aceito pela Meta API** → se aceito, fluxo normal; se bloqueado, implementar upload automático via catbox.moe como fallback.

### Estado de publicações (08/04/2026)
- **Post 1 — CMV** (08/04): publicado manualmente via app Instagram
- **Post 6 — CMV Real** (08/04): publicado via Meta API usando catbox.moe (ID: `18049067291720654`)

---

## 8. Checklist PM

- [x] Goals claros e mensuráveis
- [x] Problema de negócio descrito
- [x] Requisitos funcionais numerados com prefixo FR
- [x] Requisitos não-funcionais numerados com prefixo NFR
- [x] Stack técnica definida
- [x] Epics sequenciais e lógicos
- [x] Stories com AC testáveis
- [x] Contexto de retomada para próxima sessão documentado
- [x] Credenciais e arquivos existentes mapeados

---

## 9. Prompts para próxima sessão

### Para o @dev (Dex) — Story 1.1
> "Implemente a Story 1.1 do PRD em `/home/administrator/instagram-scheduler/docs/prd-content-planner.md`. Crie o `Dockerfile` e `.dockerignore` para o scheduler Node.js em `/home/administrator/instagram-scheduler/`. Node 20 Alpine, volumes `/app/data` e `/app/uploads`, porta 3001. Teste o build localmente."

### Para o @devops (Gage) — Story 1.2
> "Implemente a Story 1.2 do PRD. Configure o serviço `scheduler` no EasyPanel projeto `Automation`. Dockerfile em `/home/administrator/instagram-scheduler/`. Volumes persistentes para `/app/data` e `/app/uploads`. Env vars: `INSTAGRAM_USER_TOKEN`, `PUBLIC_URL`, `PORT=3001`. Configure domínio HTTPS."
