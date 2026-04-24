const express = require('express');
const multer = require('multer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const session = require('express-session');
const puppeteer = require('puppeteer');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Variáveis de ambiente obrigatórias ──────────────────────────────────────

const USER_TOKEN = process.env.INSTAGRAM_USER_TOKEN || '';
const PAGE_ID = process.env.IG_PAGE_ID || '';
const IG_USER_ID = process.env.IG_USER_ID || '';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

// Validação de startup — não sobe sem as vars críticas
const missingVars = [];
if (!APP_PASSWORD) missingVars.push('APP_PASSWORD');
if (!PAGE_ID) missingVars.push('IG_PAGE_ID');
if (!IG_USER_ID) missingVars.push('IG_USER_ID');

if (missingVars.length > 0) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════╗');
  console.error('║  ERRO: Variáveis de ambiente obrigatórias ausentes   ║');
  console.error('╚══════════════════════════════════════════════════════╝');
  console.error('');
  missingVars.forEach(v => console.error(`  ✗ ${v} não está setada`));
  console.error('');
  console.error('  Configure antes de iniciar:');
  console.error('    APP_PASSWORD=sua_senha_aqui');
  console.error('    IG_PAGE_ID=id_da_sua_pagina');
  console.error('    IG_USER_ID=id_do_usuario_instagram');
  console.error('    INSTAGRAM_USER_TOKEN=token_de_acesso (opcional no start)');
  console.error('');
  process.exit(1);
}

// ─── Storage & dirs ───────────────────────────────────────────────────────────

const SCHEDULE_FILE = path.join(__dirname, 'data', 'schedule.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(path.dirname(SCHEDULE_FILE))) fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

// ─── Middlewares globais ──────────────────────────────────────────────────────

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: APP_PASSWORD + '_cp_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// ─── Auth middleware ──────────────────────────────────────────────────────────

const PUBLIC_PATHS = ['/login', '/favicon.ico', '/api/health'];

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (PUBLIC_PATHS.includes(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado' });
  res.redirect('/login');
}

app.use(requireAuth);

// Arquivos estáticos (após auth, mas /login.html é servido diretamente pelo GET /login)
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Login routes ─────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    req.session.authenticated = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Servir static após auth
app.use(express.static(path.join(__dirname, 'public')));

// ─── Data helpers ─────────────────────────────────────────────────────────────

function read() {
  try { return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); }
  catch { return []; }
}

function save(data) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2));
}

function genId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── catbox.moe upload ────────────────────────────────────────────────────────
// Workaround validado: VPS IP bloqueado pelos crawlers da Meta.
// Imagens são enviadas ao catbox.moe antes de publicar.
// catbox.moe é uma CDN pública aceita pela Meta API (testado 08/04/2026).

async function uploadToCatbox(filePath) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', fs.createReadStream(filePath));

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  const text = await res.text();
  if (!text.startsWith('https://')) {
    throw new Error(`catbox.moe recusou o upload: ${text}`);
  }
  return text.trim();
}

async function resolvePublicUrl(filename) {
  if (filename.startsWith('https://')) return filename;

  const filePath = path.join(UPLOADS_DIR, filename);

  try {
    const catboxUrl = await uploadToCatbox(filePath);
    console.log(`[catbox] Upload OK: ${filename} → ${catboxUrl}`);
    return catboxUrl;
  } catch (err) {
    console.warn(`[catbox] Falha no upload, usando PUBLIC_URL como fallback: ${err.message}`);
    const host = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    return `${host}/uploads/${filename}`;
  }
}

// ─── Instagram Graph API ──────────────────────────────────────────────────────

async function getPageToken() {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${PAGE_ID}?fields=access_token&access_token=${USER_TOKEN}`
  );
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.access_token;
}

async function createImageContainer(imageUrl, caption, pageToken, isCarouselItem = false) {
  const params = new URLSearchParams({ image_url: imageUrl, access_token: pageToken });
  if (isCarouselItem) {
    params.set('is_carousel_item', 'true');
  } else {
    params.set('caption', caption);
  }

  const res = await fetch(`https://graph.facebook.com/v25.0/${IG_USER_ID}/media`, {
    method: 'POST', body: params,
  });
  return res.json();
}

async function createCarouselContainer(childIds, caption, pageToken) {
  const params = new URLSearchParams({
    media_type: 'CAROUSEL',
    caption,
    children: childIds.join(','),
    access_token: pageToken,
  });
  const res = await fetch(`https://graph.facebook.com/v25.0/${IG_USER_ID}/media`, {
    method: 'POST', body: params,
  });
  return res.json();
}

async function publishContainer(containerId, pageToken) {
  const params = new URLSearchParams({ creation_id: containerId, access_token: pageToken });
  const res = await fetch(`https://graph.facebook.com/v25.0/${IG_USER_ID}/media_publish`, {
    method: 'POST', body: params,
  });
  return res.json();
}

async function doPublish(post, pageToken) {
  if (post.type === 'carrossel' && post.images && post.images.length > 1) {
    console.log(`[publish] Carrossel com ${post.images.length} slides — fazendo upload para catbox.moe...`);
    const publicUrls = await Promise.all(post.images.map(img => resolvePublicUrl(img)));

    const childIds = [];
    for (const imgUrl of publicUrls) {
      const c = await createImageContainer(imgUrl, '', pageToken, true);
      if (c.error) return { success: false, error: c.error.message };
      childIds.push(c.id);
    }

    const carousel = await createCarouselContainer(childIds, post.caption, pageToken);
    if (carousel.error) return { success: false, error: carousel.error.message };

    const pub = await publishContainer(carousel.id, pageToken);
    if (pub.error) return { success: false, error: pub.error.message };
    return { success: true, instagramPostId: pub.id };

  } else {
    const imgFile = post.images && post.images[0];
    if (!imgFile) return { success: false, error: 'Nenhuma imagem disponível' };

    console.log(`[publish] Post simples — fazendo upload para catbox.moe...`);
    const imgUrl = await resolvePublicUrl(imgFile);

    const container = await createImageContainer(imgUrl, post.caption, pageToken, false);
    if (container.error) return { success: false, error: container.error.message };

    const pub = await publishContainer(container.id, pageToken);
    if (pub.error) return { success: false, error: pub.error.message };
    return { success: true, instagramPostId: pub.id };
  }
}

// ─── Conversor HTML → PNG ─────────────────────────────────────────────────────

app.get('/conversor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'conversor.html'));
});

app.post('/api/convert', async (req, res) => {
  const { html, width, height, filename } = req.body;

  if (!html) return res.status(400).json({ success: false, error: 'HTML é obrigatório' });
  if (html.length > 5 * 1024 * 1024) return res.status(400).json({ success: false, error: 'HTML excede 5MB' });

  const w = Math.max(100, Math.min(4000, parseInt(width) || 1080));
  const h = Math.max(100, Math.min(4000, parseInt(height) || 1080));

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const buffer = await page.screenshot({ type: 'png', omitBackground: false });
    const base64 = buffer.toString('base64');

    const outName = (filename || 'output').replace(/\.html$/i, '') + '.png';
    res.json({ success: true, png: base64, filename: outName });

  } catch (err) {
    console.error('[convert] Erro:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

app.post('/api/convert-zip', async (req, res) => {
  const items = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Array de itens obrigatório' });
  }
  if (items.length > 10) {
    return res.status(400).json({ success: false, error: 'Máximo 10 arquivos por lote' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    });

    const timestamp = Date.now();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="conversoes-${timestamp}.zip"`);

    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.pipe(res);

    for (const item of items) {
      const { html, width, height, filename } = item;
      if (!html) continue;

      const w = Math.max(100, Math.min(4000, parseInt(width) || 1080));
      const h = Math.max(100, Math.min(4000, parseInt(height) || 1080));

      const page = await browser.newPage();
      try {
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
        const buffer = await page.screenshot({ type: 'png', omitBackground: false });
        const outName = (filename || 'output').replace(/\.html$/i, '') + '.png';
        zip.append(buffer, { name: outName });
      } catch (err) {
        console.warn(`[convert-zip] Falha em ${filename}: ${err.message}`);
      } finally {
        await page.close().catch(() => {});
      }
    }

    await zip.finalize();

  } catch (err) {
    console.error('[convert-zip] Erro:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ─── API routes ───────────────────────────────────────────────────────────────

app.get('/api/posts', (req, res) => {
  const all = read().sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  res.json(all);
});

app.get('/api/status', (req, res) => {
  const p = read();
  res.json({
    tokenConfigured: !!USER_TOKEN,
    total: p.length,
    scheduled: p.filter(x => x.status === 'scheduled').length,
    published: p.filter(x => x.status === 'published').length,
    failed: p.filter(x => x.status === 'failed').length,
    draft: p.filter(x => x.status === 'draft').length,
  });
});

app.post('/api/posts', upload.array('images', 10), (req, res) => {
  const { caption, scheduledAt, type, title } = req.body;

  if (!caption) return res.status(400).json({ error: 'Caption obrigatória' });
  if (!scheduledAt) return res.status(400).json({ error: 'Data/hora obrigatória' });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'Data/hora inválida' });

  const images = (req.files || []).map(f => f.filename);
  if (type !== 'story' && type !== 'reel' && images.length === 0) {
    return res.status(400).json({ error: 'Pelo menos uma imagem é obrigatória' });
  }

  const post = {
    id: genId(),
    title: title || '',
    type: type || 'post',
    caption,
    scheduledAt: scheduledDate.toISOString(),
    images,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    instagramPostId: null,
    publishedAt: null,
    errorMessage: null,
  };

  const schedule = read();
  schedule.push(post);
  save(schedule);
  res.json({ success: true, post });
});

app.post('/api/posts/draft', (req, res) => {
  const { caption, scheduledAt, type, title } = req.body;

  if (!scheduledAt) return res.status(400).json({ error: 'Data/hora obrigatória' });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'Data/hora inválida' });

  const post = {
    id: genId(),
    title: title || '',
    type: type || 'carrossel',
    caption: caption || '',
    scheduledAt: scheduledDate.toISOString(),
    images: [],
    status: 'draft',
    createdAt: new Date().toISOString(),
    instagramPostId: null,
    publishedAt: null,
    errorMessage: null,
  };

  const schedule = read();
  schedule.push(post);
  save(schedule);
  res.json({ success: true, post });
});

app.patch('/api/posts/:id', upload.array('images', 10), (req, res) => {
  const schedule = read();
  const idx = schedule.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post não encontrado' });
  if (schedule[idx].status === 'published') return res.status(400).json({ error: 'Post já publicado' });

  const { caption, scheduledAt, type, title } = req.body;
  const newImages = (req.files || []).map(f => f.filename);

  if (caption !== undefined) schedule[idx].caption = caption;
  if (scheduledAt !== undefined) {
    const d = new Date(scheduledAt);
    if (!isNaN(d.getTime())) schedule[idx].scheduledAt = d.toISOString();
  }
  if (type !== undefined) schedule[idx].type = type;
  if (title !== undefined) schedule[idx].title = title;
  if (newImages.length > 0) {
    schedule[idx].images = [...schedule[idx].images, ...newImages];
    if (schedule[idx].status === 'draft' && schedule[idx].images.length > 0) {
      schedule[idx].status = 'scheduled';
    }
  }

  save(schedule);
  res.json({ success: true, post: schedule[idx] });
});

app.delete('/api/posts/:id', (req, res) => {
  const schedule = read();
  const idx = schedule.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post não encontrado' });
  if (schedule[idx].status === 'published') return res.status(400).json({ error: 'Post já publicado' });

  for (const img of (schedule[idx].images || [])) {
    if (img.startsWith('https://')) continue;
    const fp = path.join(UPLOADS_DIR, img);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  schedule.splice(idx, 1);
  save(schedule);
  res.json({ success: true });
});

app.post('/api/posts/:id/publish-now', async (req, res) => {
  if (!USER_TOKEN) return res.status(400).json({ error: 'Token Instagram não configurado' });

  const schedule = read();
  const post = schedule.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (post.status === 'published') return res.status(400).json({ error: 'Já publicado' });
  if (post.status === 'draft') return res.status(400).json({ error: 'Post ainda em rascunho — adicione as imagens primeiro' });

  const all = read();
  const idx = all.findIndex(p => p.id === post.id);
  all[idx].status = 'publishing';
  save(all);

  try {
    const pageToken = await getPageToken();
    const result = await doPublish(post, pageToken);
    const updated = read();
    const i = updated.findIndex(p => p.id === post.id);
    if (result.success) {
      updated[i].status = 'published';
      updated[i].instagramPostId = result.instagramPostId;
      updated[i].publishedAt = new Date().toISOString();
      console.log(`[publish] OK: ${result.instagramPostId}`);
    } else {
      updated[i].status = 'failed';
      updated[i].errorMessage = result.error;
      console.error(`[publish] Falha: ${result.error}`);
    }
    save(updated);
    res.json({ success: result.success, post: updated[i], error: result.error });
  } catch (err) {
    const updated = read();
    const i = updated.findIndex(p => p.id === post.id);
    updated[i].status = 'failed';
    updated[i].errorMessage = err.message;
    save(updated);
    console.error(`[publish] Erro: ${err.message}`);
    res.json({ success: false, error: err.message, post: updated[i] });
  }
});

// ─── Cron (a cada 5 min) ──────────────────────────────────────────────────────

cron.schedule('*/5 * * * *', async () => {
  if (!USER_TOKEN) return;
  const now = new Date();
  const due = read().filter(p => p.status === 'scheduled' && new Date(p.scheduledAt) <= now);
  if (!due.length) return;

  console.log(`[cron] ${now.toISOString()} — ${due.length} post(s) para publicar`);

  let pageToken;
  try { pageToken = await getPageToken(); }
  catch (e) { console.error('[cron] Token error:', e.message); return; }

  for (const post of due) {
    console.log(`[cron] Publicando: ${post.title || post.id}`);
    const result = await doPublish(post, pageToken);
    const all = read();
    const idx = all.findIndex(p => p.id === post.id);
    if (idx === -1) continue;

    if (result.success) {
      all[idx].status = 'published';
      all[idx].instagramPostId = result.instagramPostId;
      all[idx].publishedAt = new Date().toISOString();
      console.log(`[cron] Publicado: ${result.instagramPostId}`);
    } else {
      all[idx].status = 'failed';
      all[idx].errorMessage = result.error;
      console.error(`[cron] Falha: ${result.error}`);
    }
    save(all);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           Content Planner v2 — iniciado             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  URL:           http://localhost:${PORT}`);
  console.log(`  Instagram:     ${USER_TOKEN ? 'token OK' : 'SEM TOKEN (publicação desabilitada)'}`);
  console.log(`  PAGE_ID:       ${PAGE_ID}`);
  console.log(`  IG_USER_ID:    ${IG_USER_ID}`);
  console.log(`  Auth:          senha configurada`);
  console.log(`  Conversor:     http://localhost:${PORT}/conversor`);
  console.log(`  Cron:          publicação automática a cada 5min`);
  console.log('');
});
