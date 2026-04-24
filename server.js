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

const APP_PASSWORD = process.env.APP_PASSWORD || '';

if (!APP_PASSWORD) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════╗');
  console.error('║  ERRO: Variável de ambiente obrigatória ausente      ║');
  console.error('╚══════════════════════════════════════════════════════╝');
  console.error('');
  console.error('  ✗ APP_PASSWORD não está setada');
  console.error('');
  console.error('  Configure antes de iniciar:');
  console.error('    APP_PASSWORD=sua_senha_aqui');
  console.error('');
  process.exit(1);
}

// ─── Storage & dirs ───────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Login routes ─────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === getPassword()) {
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

// ─── Config helpers (senha persistida em disco) ───────────────────────────────

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// Senha ativa: config.json > env var
function getPassword() {
  const cfg = readConfig();
  return cfg.password || APP_PASSWORD;
}

// ─── Accounts helpers ─────────────────────────────────────────────────────────

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch { return []; }
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function getAccountById(id) {
  return readAccounts().find(a => a.id === id) || null;
}

function getDefaultAccount() {
  const accounts = readAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}

function genAccountId() {
  return `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Auto-migração de env vars legadas ───────────────────────────────────────
// Se accounts.json ainda não existe mas as env vars antigas estão setadas,
// cria automaticamente a primeira conta a partir delas.

function autoMigrateEnvVars() {
  if (fs.existsSync(ACCOUNTS_FILE)) return; // já tem contas, não migra

  const pageId = process.env.IG_PAGE_ID || '';
  const igUserId = process.env.IG_USER_ID || '';
  const token = process.env.INSTAGRAM_USER_TOKEN || '';

  if (!pageId || !igUserId) return; // env vars não configuradas, nada a migrar

  const account = {
    id: genAccountId(),
    name: 'Conta padrão',
    pageId,
    igUserId,
    token,
    createdAt: new Date().toISOString(),
  };

  saveAccounts([account]);
  console.log('[accounts] Auto-migração: conta criada a partir de env vars legadas');
}

autoMigrateEnvVars();

// ─── Account routes ───────────────────────────────────────────────────────────

app.get('/api/accounts', (req, res) => {
  const accounts = readAccounts().map(a => ({
    id: a.id,
    name: a.name,
    pageId: a.pageId,
    igUserId: a.igUserId,
    tokenConfigured: !!a.token,
    tokenPreview: a.token ? a.token.slice(0, 6) + '...' + a.token.slice(-4) : '',
    createdAt: a.createdAt,
  }));
  res.json(accounts);
});

app.post('/api/accounts', (req, res) => {
  const { name, pageId, igUserId, token } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
  if (!pageId || !pageId.trim()) return res.status(400).json({ error: 'Page ID obrigatório' });
  if (!igUserId || !igUserId.trim()) return res.status(400).json({ error: 'IG User ID obrigatório' });
  if (!token || !token.trim()) return res.status(400).json({ error: 'Token obrigatório' });

  const accounts = readAccounts();
  const account = {
    id: genAccountId(),
    name: name.trim(),
    pageId: pageId.trim(),
    igUserId: igUserId.trim(),
    token: token.trim(),
    createdAt: new Date().toISOString(),
  };

  accounts.push(account);
  saveAccounts(accounts);

  res.json({
    success: true,
    account: {
      id: account.id,
      name: account.name,
      pageId: account.pageId,
      igUserId: account.igUserId,
      tokenConfigured: true,
      tokenPreview: account.token.slice(0, 6) + '...' + account.token.slice(-4),
      createdAt: account.createdAt,
    },
  });
});

app.delete('/api/accounts/:id', (req, res) => {
  const accounts = readAccounts();
  const idx = accounts.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Conta não encontrada' });

  accounts.splice(idx, 1);
  saveAccounts(accounts);
  res.json({ success: true });
});

app.post('/api/accounts/:id/test', async (req, res) => {
  const account = getAccountById(req.params.id);
  if (!account) return res.status(404).json({ error: 'Conta não encontrada' });
  if (!account.token) return res.status(400).json({ error: 'Token não configurado' });

  try {
    const pageToken = await getPageToken(account);
    res.json({ success: true, message: 'Conexão OK — token válido' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/configuracoes', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'configuracoes.html'));
});

app.post('/api/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }
  if (currentPassword !== getPassword()) {
    return res.status(400).json({ error: 'Senha atual incorreta' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Nova senha deve ter ao menos 4 caracteres' });
  }

  const cfg = readConfig();
  cfg.password = newPassword;
  saveConfig(cfg);

  // Invalidar todas as sessões forçando re-login
  req.session.destroy(() => {});

  res.json({ success: true });
});

// ─── catbox.moe upload ────────────────────────────────────────────────────────

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

async function getPageToken(account) {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${account.pageId}?fields=access_token&access_token=${account.token}`
  );
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.access_token;
}

async function createImageContainer(imageUrl, caption, pageToken, account, isCarouselItem = false) {
  const params = new URLSearchParams({ image_url: imageUrl, access_token: pageToken });
  if (isCarouselItem) {
    params.set('is_carousel_item', 'true');
  } else {
    params.set('caption', caption);
  }

  const res = await fetch(`https://graph.facebook.com/v25.0/${account.igUserId}/media`, {
    method: 'POST', body: params,
  });
  return res.json();
}

async function createCarouselContainer(childIds, caption, pageToken, account) {
  const params = new URLSearchParams({
    media_type: 'CAROUSEL',
    caption,
    children: childIds.join(','),
    access_token: pageToken,
  });
  const res = await fetch(`https://graph.facebook.com/v25.0/${account.igUserId}/media`, {
    method: 'POST', body: params,
  });
  return res.json();
}

async function publishContainer(containerId, pageToken, account) {
  const params = new URLSearchParams({ creation_id: containerId, access_token: pageToken });
  const res = await fetch(`https://graph.facebook.com/v25.0/${account.igUserId}/media_publish`, {
    method: 'POST', body: params,
  });
  return res.json();
}

async function doPublish(post, pageToken, account) {
  if (post.type === 'carrossel' && post.images && post.images.length > 1) {
    console.log(`[publish] Carrossel com ${post.images.length} slides — fazendo upload para catbox.moe...`);
    const publicUrls = await Promise.all(post.images.map(img => resolvePublicUrl(img)));

    const childIds = [];
    for (const imgUrl of publicUrls) {
      const c = await createImageContainer(imgUrl, '', pageToken, account, true);
      if (c.error) return { success: false, error: c.error.message };
      childIds.push(c.id);
    }

    const carousel = await createCarouselContainer(childIds, post.caption, pageToken, account);
    if (carousel.error) return { success: false, error: carousel.error.message };

    const pub = await publishContainer(carousel.id, pageToken, account);
    if (pub.error) return { success: false, error: pub.error.message };
    return { success: true, instagramPostId: pub.id };

  } else {
    const imgFile = post.images && post.images[0];
    if (!imgFile) return { success: false, error: 'Nenhuma imagem disponível' };

    console.log(`[publish] Post simples — fazendo upload para catbox.moe...`);
    const imgUrl = await resolvePublicUrl(imgFile);

    const container = await createImageContainer(imgUrl, post.caption, pageToken, account, false);
    if (container.error) return { success: false, error: container.error.message };

    const pub = await publishContainer(container.id, pageToken, account);
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
  const accounts = readAccounts();
  const p = read();
  res.json({
    accountsCount: accounts.length,
    tokenConfigured: accounts.some(a => !!a.token),
    total: p.length,
    scheduled: p.filter(x => x.status === 'scheduled').length,
    published: p.filter(x => x.status === 'published').length,
    failed: p.filter(x => x.status === 'failed').length,
    draft: p.filter(x => x.status === 'draft').length,
  });
});

app.post('/api/posts', upload.array('images', 10), (req, res) => {
  const { caption, scheduledAt, type, title, accountId } = req.body;

  if (!caption) return res.status(400).json({ error: 'Caption obrigatória' });
  if (!scheduledAt) return res.status(400).json({ error: 'Data/hora obrigatória' });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'Data/hora inválida' });

  const images = (req.files || []).map(f => f.filename);
  if (type !== 'story' && type !== 'reel' && images.length === 0) {
    return res.status(400).json({ error: 'Pelo menos uma imagem é obrigatória' });
  }

  // Resolve account: use passed accountId, or default (first)
  const resolvedAccountId = accountId || (getDefaultAccount() || {}).id || null;

  const post = {
    id: genId(),
    title: title || '',
    type: type || 'post',
    caption,
    scheduledAt: scheduledDate.toISOString(),
    images,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    accountId: resolvedAccountId,
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
  const { caption, scheduledAt, type, title, accountId } = req.body;

  if (!scheduledAt) return res.status(400).json({ error: 'Data/hora obrigatória' });

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) return res.status(400).json({ error: 'Data/hora inválida' });

  const resolvedAccountId = accountId || (getDefaultAccount() || {}).id || null;

  const post = {
    id: genId(),
    title: title || '',
    type: type || 'carrossel',
    caption: caption || '',
    scheduledAt: scheduledDate.toISOString(),
    images: [],
    status: 'draft',
    createdAt: new Date().toISOString(),
    accountId: resolvedAccountId,
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

  const { caption, scheduledAt, type, title, accountId } = req.body;
  const newImages = (req.files || []).map(f => f.filename);

  if (caption !== undefined) schedule[idx].caption = caption;
  if (scheduledAt !== undefined) {
    const d = new Date(scheduledAt);
    if (!isNaN(d.getTime())) schedule[idx].scheduledAt = d.toISOString();
  }
  if (type !== undefined) schedule[idx].type = type;
  if (title !== undefined) schedule[idx].title = title;
  if (accountId !== undefined) schedule[idx].accountId = accountId;
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
  const schedule = read();
  const post = schedule.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (post.status === 'published') return res.status(400).json({ error: 'Já publicado' });
  if (post.status === 'draft') return res.status(400).json({ error: 'Post ainda em rascunho — adicione as imagens primeiro' });

  // Resolve account
  const account = (post.accountId ? getAccountById(post.accountId) : null) || getDefaultAccount();
  if (!account) return res.status(400).json({ error: 'Nenhuma conta Instagram configurada. Acesse Configurações para adicionar.' });
  if (!account.token) return res.status(400).json({ error: 'Token Instagram não configurado para esta conta.' });

  const all = read();
  const idx = all.findIndex(p => p.id === post.id);
  all[idx].status = 'publishing';
  save(all);

  try {
    const pageToken = await getPageToken(account);
    const result = await doPublish(post, pageToken, account);
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
  const accounts = readAccounts();
  if (accounts.length === 0) return; // sem contas configuradas

  const now = new Date();
  const due = read().filter(p => p.status === 'scheduled' && new Date(p.scheduledAt) <= now);
  if (!due.length) return;

  console.log(`[cron] ${now.toISOString()} — ${due.length} post(s) para publicar`);

  for (const post of due) {
    const account = (post.accountId ? getAccountById(post.accountId) : null) || getDefaultAccount();
    if (!account || !account.token) {
      console.warn(`[cron] Post ${post.id}: sem conta configurada, pulando`);
      continue;
    }

    let pageToken;
    try { pageToken = await getPageToken(account); }
    catch (e) { console.error(`[cron] Token error (${account.name}):`, e.message); continue; }

    console.log(`[cron] Publicando: ${post.title || post.id} → conta: ${account.name}`);
    const result = await doPublish(post, pageToken, account);
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

const accounts = readAccounts();
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║           Content Planner v2 — iniciado             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  URL:           http://localhost:${PORT}`);
  console.log(`  Auth:          senha configurada`);
  console.log(`  Contas IG:     ${accounts.length} configurada(s)`);
  console.log(`  Conversor:     http://localhost:${PORT}/conversor`);
  console.log(`  Configurações: http://localhost:${PORT}/configuracoes`);
  console.log(`  Cron:          publicação automática a cada 5min`);
  console.log('');
});
