# Deploy EasyPanel — Content Planner @girru.ai

## Pré-requisitos

- Acesso ao EasyPanel (projeto **Automation**)
- Repositório GitHub com o código (ou upload direto do Dockerfile)
- Token Instagram válido (ver `/root/assistente-pessoal/.env`)

---

## Passo 1 — Criar serviço no EasyPanel

1. Acesse o EasyPanel → projeto **Automation**
2. Clique em **+ Create Service** → escolha **App**
3. Nome do serviço: `scheduler`
4. Source: **GitHub** (apontar para o repo com este código) **OU** **Dockerfile** (upload manual)

---

## Passo 2 — Configurar volumes persistentes

No painel do serviço `scheduler`, vá em **Volumes** e adicione:

| Path no container | Descrição |
|---|---|
| `/app/data` | Banco de dados JSON (schedule.json) |
| `/app/uploads` | Imagens dos posts |

> Volumes garantem que os posts não se perdem ao reiniciar o serviço.

---

## Passo 3 — Configurar variáveis de ambiente

Em **Environment Variables**:

| Variável | Valor |
|---|---|
| `INSTAGRAM_USER_TOKEN` | Token do Graph API (ver .env) |
| `PUBLIC_URL` | URL HTTPS do serviço (ex: `https://scheduler.SEU-DOMINIO.easypanel.host`) |
| `PORT` | `3001` |

> ⚠️ O `PUBLIC_URL` é o domínio que o EasyPanel gerar automaticamente para o serviço `scheduler`.

---

## Passo 4 — Configurar domínio HTTPS

1. No EasyPanel, vá em **Domains** do serviço `scheduler`
2. Adicione o domínio gerado (ex: `scheduler.xxxxx.easypanel.host`)
3. O Let's Encrypt ativa automaticamente em ~2 minutos

---

## Passo 5 — Fazer deploy e testar

1. Clique em **Deploy** e aguarde o build
2. Acesse `https://SEU-DOMINIO/api/status` — deve retornar:
   ```json
   {"tokenConfigured":true,"total":0,"scheduled":0,"published":0,"failed":0,"draft":0}
   ```
3. Acesse a URL principal e verifique o calendário

---

## Passo 6 — Testar publicação real

> ⚠️ IMPORTANTE: O IP do VPS está bloqueado pelos crawlers da Meta.
> O servidor já integra catbox.moe automaticamente — as imagens são
> enviadas ao catbox.moe antes de ir à Meta API. Isso resolve o bloqueio.

1. Abra o Content Planner no browser
2. Adicione um post de teste (carrossel com 1–2 slides)
3. Clique em **Publicar agora**
4. Verifique se aparece no Instagram @girru.ai

---

## Como o time de conteúdo usa

Ao final de cada produção de conteúdo (squad design-posts), o agente Diego Design executa:

```bash
node /root/instagram-scheduler/add-to-schedule.js \
  --type carrossel \
  --title "Post 3 — Ficha Técnica" \
  --caption "Legenda completa do post..." \
  --date "2026-04-15T10:00:00" \
  --images /caminho/slide1.png /caminho/slide2.png /caminho/slide3.png
```

O post aparece imediatamente no calendário do Content Planner com status **Agendado**.
Na data/hora marcada, o cron publica automaticamente.

---

## Renovação do token Instagram

O token expira em ~60 dias. Para renovar:

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. App: **girru.ai** → Graph API Explorer
3. Gere novo token com permissões: `instagram_content_publish`, `instagram_basic`, `pages_show_list`, `pages_read_engagement`
4. Atualize a variável `INSTAGRAM_USER_TOKEN` no EasyPanel
5. Reinicie o serviço `scheduler`

**Próxima renovação:** ~60 dias após 08/04/2026 (≈ 07/06/2026)

---

## Arquitetura resumida

```
Time de Conteúdo
    ↓ add-to-schedule.js
Content Planner (webapp)
    ↓ cron a cada 5min
catbox.moe (CDN para imagens)
    ↓ URLs HTTPS
Meta Graph API
    ↓
Instagram @girru.ai
```
