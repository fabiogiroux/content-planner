# EPIC-CP-01 — Content Planner v2: Multi-projeto + Auth + Conversor HTML

**Status:** InProgress  
**Branch:** feat/conversor-html-imagem  
**Aprovado por:** Fabio (2026-04-24)

## Objetivo

Transformar o content-planner de app single-account para multi-projeto,
adicionar autenticação por senha e implementar conversor HTML → PNG via Puppeteer.

## Stories

| Story | Título | Status |
|---|---|---|
| CP-01.1 | Refatoração env vars multi-projeto | Ready |
| CP-01.2 | Autenticação por senha simples | Ready |
| CP-01.3 | Backend conversor HTML → PNG | Ready |
| CP-01.4 | UI conversor drag & drop | Ready |
| CP-01.5 | Dockerfile + Chromium + fontes Alpine | Ready |

## Decisões do Fabio

1. Escopo: tudo junto — 2 instâncias + conversor
2. Auth: APP_PASSWORD env var, cookie 7 dias
3. Fontes Alpine: atenção especial (font-noto, ttf-*)

## Checkpoints

- [ ] CP1: implementação local completa (ANTES de push)
- [ ] CP2: deploy girru validado
- [ ] CP3: deploy jnc validado
