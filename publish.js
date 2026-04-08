/**
 * Módulo de publicação no Instagram via Graph API
 */

const PAGE_ID = '968835909655890';
const IG_USER_ID = '17841440286252925';

/**
 * Publica um post imediatamente no Instagram
 * @param {object} post - { imageUrl, caption, accessToken }
 * @returns {object} { success, instagramPostId, error }
 */
async function publishPost(post) {
  const { imageUrl, caption, accessToken } = post;

  try {
    // Passo 1: Criar container de mídia
    const containerRes = await fetch(`https://graph.facebook.com/v25.0/${IG_USER_ID}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: caption,
        published: 'true',
        access_token: accessToken,
      }),
    });
    const container = await containerRes.json();

    if (container.error) {
      return { success: false, error: container.error.message };
    }

    // Passo 2: Publicar container
    const publishRes = await fetch(`https://graph.facebook.com/v25.0/${IG_USER_ID}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: container.id,
        access_token: accessToken,
      }),
    });
    const published = await publishRes.json();

    if (published.error) {
      return { success: false, error: published.error.message };
    }

    return { success: true, instagramPostId: published.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Busca o Page Access Token a partir do User Access Token
 */
async function getPageToken(userToken) {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${PAGE_ID}?fields=access_token&access_token=${userToken}`
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.access_token;
}

module.exports = { publishPost, getPageToken, IG_USER_ID, PAGE_ID };
