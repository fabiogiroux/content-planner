const express = require('express');
const multer = require('multer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3001;
const USER_TOKEN = process.env.INSTAGRAM_USER_TOKEN || '';
const PAGE_ID = '968835909655890';
const IG_USER_ID = '17841440286252925';

const SCHEDULE_FILE = path.join(__dirname, 'data', 'schedule.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Garantir que os diretórios existam
if (!fs.existsSync(path.dirname(SCHEDULE_FILE))) fs.mkdirSync(path.dirname(SCHEDULE_FILE), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Data helpers ────────────────────────────────────────────────────────────

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

// ─── catbox.moe upload ───────────────────────────────────────────────────────
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

// Resolve URL pública da imagem para a Meta API.
// Tenta catbox.moe primeiro. Fallback: PUBLIC_URL (novo domínio EasyPanel).
async function resolvePublicUrl(filename) {
  // Se já é URL completa (ex: catbox.moe URL salva anteriormente)
  if (filename.startsWith('https://')) return filename;

  const filePath = path.join(UPLOADS_DIR, filename);

  // Tentar catbox.moe primeiro (contorna bloqueio de IP do VPS)
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
    // Fazer upload de todas as imagens para catbox.moe em paralelo
    console.log(`[publish] Carrossel com ${post.images.length} slides — fazendo upload para catbox.moe...`);
    const publicUrls = await Promise.all(post.images.map(img => resolvePublicUrl(img)));

    // Criar containers filho
    const childIds = [];
    for (const imgUrl of publicUrls) {
      const c = await createImageContainer(imgUrl, '', pageToken, true);
      if (c.error) return { success: false, error: c.error.message };
      childIds.push(c.id);
    }

    // Criar container carrossel
    const carousel = await createCarouselContainer(childIds, post.caption, pageToken);
    if (carousel.error) return { success: false, error: carousel.error.message };

    // Publicar
    const pub = await publishContainer(carousel.id, pageToken);
    if (pub.error) return { success: false, error: pub.error.message };
    return { success: true, instagramPostId: pub.id };

  } else {
    // Post simples (primeira imagem)
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

// ─── API routes ──────────────────────────────────────────────────────────────

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

// Criar post (suporta múltiplas imagens para carrossel)
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

// Criar post rascunho (sem imagens ainda — para calendário editorial)
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

// Atualizar post (adicionar imagens a um draft, editar caption/data)
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
    // Promover de draft para scheduled se agora tem imagens
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
    if (img.startsWith('https://')) continue; // URL externa, não excluir
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

  // Marcar como publicando
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

// ─── Cron (a cada 5 min) ─────────────────────────────────────────────────────

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

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Content Planner @girru.ai — http://localhost:${PORT}`);
  console.log(`Token Instagram: ${USER_TOKEN ? 'OK' : 'NAO CONFIGURADO'}`);
  console.log(`Cron: publicação automática a cada 5min`);
  console.log(`catbox.moe: ativo (workaround Meta IP bloqueado)`);
});
