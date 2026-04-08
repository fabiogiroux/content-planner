#!/usr/bin/env node
/**
 * add-to-schedule.js
 *
 * Adiciona um post aprovado ao Content Planner (@girru.ai).
 * Chamado automaticamente ao final de cada rodada de criação de conteúdo.
 *
 * Uso:
 *   node add-to-schedule.js \
 *     --type carrossel \
 *     --title "Post 2 — IA no Food Service" \
 *     --caption "Legenda do post..." \
 *     --date "2026-04-15T10:00:00" \
 *     --images /caminho/slide1.png /caminho/slide2.png
 *
 * Tipos: carrossel | post | reel | story
 */

const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, 'data', 'schedule.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1];
}

function getArgMulti(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return [];
  const values = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    values.push(args[i]);
  }
  return values;
}

const type     = getArg('type') || 'carrossel';
const title    = getArg('title') || '';
const caption  = getArg('caption') || '';
const dateStr  = getArg('date') || '';
const images   = getArgMulti('images');

// ── Validate ────────────────────────────────────────────────────────────────
if (!caption) { console.error('Erro: --caption obrigatório'); process.exit(1); }
if (!dateStr) { console.error('Erro: --date obrigatório (formato: 2026-04-15T10:00:00)'); process.exit(1); }

const scheduledAt = new Date(dateStr);
if (isNaN(scheduledAt.getTime())) { console.error('Erro: --date inválido'); process.exit(1); }

// ── Copy images to uploads ──────────────────────────────────────────────────
const copiedImages = [];
for (const imgPath of images) {
  if (!fs.existsSync(imgPath)) {
    console.error(`Aviso: imagem não encontrada: ${imgPath}`);
    continue;
  }
  const ext = path.extname(imgPath);
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2,6)}${ext}`;
  const dest = path.join(UPLOADS_DIR, filename);
  fs.copyFileSync(imgPath, dest);
  copiedImages.push(filename);
  console.log(`  Imagem copiada: ${path.basename(imgPath)} → ${filename}`);
}

// ── Add to schedule ─────────────────────────────────────────────────────────
let schedule = [];
try { schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); }
catch { schedule = []; }

const post = {
  id: `p_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
  title,
  type,
  caption,
  scheduledAt: scheduledAt.toISOString(),
  images: copiedImages,
  status: 'scheduled',
  createdAt: new Date().toISOString(),
  instagramPostId: null,
  publishedAt: null,
  errorMessage: null,
};

schedule.push(post);
fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));

// ── Output ──────────────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Post adicionado ao Content Planner');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ID:         ${post.id}`);
console.log(`  Título:     ${title || '(sem título)'}`);
console.log(`  Tipo:       ${type}`);
console.log(`  Agendado:   ${scheduledAt.toLocaleString('pt-BR')}`);
console.log(`  Slides:     ${copiedImages.length} imagem(ns)`);
console.log(`  Caption:    ${caption.slice(0, 60)}${caption.length > 60 ? '...' : ''}`);
console.log('\n  Acesse http://localhost:3001 para visualizar.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
