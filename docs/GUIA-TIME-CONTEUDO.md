# Guia de Uso — Content Planner @girru.ai

**Para:** Time de Conteúdo Instagram  
**Acesso:** https://automation-scheduler.h4xjiq.easypanel.host

---

## O que é isso

O Content Planner é onde o time agenda e acompanha todos os posts do @girru.ai no Instagram.
Você cria o post aqui, define data e hora, e o sistema publica sozinho na hora marcada.

---

## Visão geral da tela

```
┌─────────────────────────────────┬────────────────────┐
│  CALENDÁRIO (lado esquerdo)     │  FORMULÁRIO        │
│                                 │  (lado direito)    │
│  Clica num dia → vê os posts    │                    │
│  daquele dia abaixo             │  Aqui você cria    │
│                                 │  novos posts       │
└─────────────────────────────────┴────────────────────┘
```

No topo da tela tem os contadores: **Agendados / Publicados / Rascunhos / Falhas**

---

## Como agendar um post novo

### Passo 1 — Preencher o formulário (painel direito)

| Campo | O que colocar |
|-------|---------------|
| **Tipo** | Carrossel, Post, Reel ou Story |
| **Título** | Nome interno (ex: "Post 3 — Ficha Técnica") |
| **Caption** | Legenda completa do post (pode incluir emojis e hashtags) |
| **Data e hora** | Quando publicar (formato: dia/mês/ano hora:minuto) |
| **Imagens** | Upload dos slides (PNG ou JPG, máx 30MB por arquivo) |

### Passo 2 — Enviar

- Clica em **Agendar** para programar a publicação
- Clica em **Rascunho** se as imagens ainda não estão prontas

### Passo 3 — Confirmar no calendário

O post aparece no dia escolhido com uma bolinha colorida:
- 🟣 Carrossel | 🔵 Post | 🟢 Reel | 🟡 Story

---

## Status dos posts

| Status | Cor | Significa |
|--------|-----|-----------|
| **Agendado** | amarelo | Vai publicar na hora marcada |
| **Publicado** | verde | Já está no Instagram |
| **Rascunho** | cinza | Falta imagem ou aprovação |
| **Falhou** | vermelho | Erro na publicação (ver seção abaixo) |

---

## Publicar na hora (sem esperar o horário)

Nos cards dos posts tem o botão **Publicar agora** — clica para publicar imediatamente.

Útil para posts aprovados de última hora ou testes.

---

## O que fazer se um post falhou

1. Clica no post com status **Falhou** — aparece a mensagem de erro
2. Os erros mais comuns são:
   - **Token expirado** → avisar o Fabio para renovar (ele reconfigura em ~5 min)
   - **Imagem muito grande** → reduzir para menos de 30MB
   - **Formato inválido** → converter para PNG ou JPG
3. Depois de corrigir, clica em **Publicar agora** para tentar de novo

---

## Para o Diego Design — registrar posts via linha de comando

Quando o squad de design finaliza um post, registrar direto no schedule:

```bash
node /root/instagram-scheduler/add-to-schedule.js \
  --type carrossel \
  --title "Post 3 — Ficha Técnica" \
  --caption "Legenda completa aqui...

#girruai #foodservice #cmv" \
  --date "2026-04-22T10:00:00" \
  --images /caminho/slide1.png /caminho/slide2.png /caminho/slide3.png
```

O post aparece imediatamente no calendário com status **Agendado**.

### Datas e horários sugeridos para @girru.ai

| Dia | Horário | Tipo |
|-----|---------|------|
| Terça | 10h ou 12h | Carrossel educativo |
| Quinta | 10h ou 12h | Carrossel educativo |
| Sábado | 9h | Post ou Reels |

---

## Limites da plataforma (Instagram)

- Máximo **10 slides** por carrossel
- Formatos aceitos: **PNG, JPG** (não WebP, não GIF)
- Tamanho máximo: **30MB por imagem**
- Proporção ideal: **1:1 (quadrado)** ou **4:5 (retrato)**
- Máximo **25 posts por 24h** (raramente chegamos perto)

---

## Token Instagram — quando renovar

O token de acesso à API do Instagram expira a cada ~60 dias.

**Próxima renovação:** ~07/06/2026

Se os posts começarem a falhar com erro de "autenticação" ou "token inválido", avisar o **Fabio** para renovar. Ele acessa o developers.facebook.com e resolve em 5 minutos.

---

## Dúvidas e suporte

Qualquer problema com o sistema, falar com o **Fabio**.  
Não mexa nos arquivos `schedule.json` ou `uploads/` diretamente.

---

*Última atualização: 08/04/2026*
