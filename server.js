/**
 * Dynamic redirect engine for NFC/QR review cards.
 *
 * Route: GET /r/:cardId
 * Reads cards/{cardId} from Firebase Realtime Database.
 *   - 0 links, or not active: shows "not active" (410)
 *   - 1 link: 302 redirects straight there (fast, works like a normal card)
 *   - 2+ links: shows a small page with one button per link (like Linktree,
 *     but hosted here — no third party, no branding, no extra cost).
 */

require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length) return;

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error('Missing required env var: FIREBASE_DATABASE_URL');
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL,
    });
  }
}

initFirebase();
const db = admin.database();

const app = express();
app.disable('x-powered-by');

const CARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Minimal HTML-escaping so a merchant's label/URL can't break the page. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Real brand logos via Simple Icons (cdn.simpleicons.org) — a free, open icon
// service made specifically for showing a platform's real logo to indicate
// "this links to our X page." Generic categories (menu/website/other) keep a
// plain emoji since there's no brand to represent there.
const PLATFORM_STYLES = {
  google: { logoSlug: 'google', icon: null, color: '#4285F4', text: '#ffffff' },
  facebook: { logoSlug: 'facebook', icon: null, color: '#1877F2', text: '#ffffff' },
  instagram: { logoSlug: 'instagram', icon: null, color: '#C13584', text: '#ffffff' },
  snapchat: { logoSlug: 'snapchat', icon: null, color: '#FFFC00', text: '#111111' },
  tiktok: { logoSlug: 'tiktok', icon: null, color: '#111111', text: '#ffffff' },
  whatsapp: { logoSlug: 'whatsapp', icon: null, color: '#25D366', text: '#ffffff' },
  menu: { logoSlug: null, icon: '📋', color: '#6b7280', text: '#ffffff' },
  website: { logoSlug: null, icon: '🌐', color: '#6b7280', text: '#ffffff' },
  other: { logoSlug: null, icon: '🔗', color: '#6b7280', text: '#ffffff' },
};

const THEMES = {
  light: { bg: '#f5f5f7', heading: '#333333', cardBg: '#ffffff', border: '#dddddd' },
  dark: { bg: '#121212', heading: '#f0f0f0', cardBg: '#1e1e1e', border: '#333333' },
};

function renderLinksPage(cardId, links, themeName, storeName) {
  const theme = THEMES[themeName] || THEMES.light;
  const heading = storeName ? escapeHtml(storeName) : 'Choose an option';

  const buttons = links
    .map((link) => {
      const style = PLATFORM_STYLES[link.type] || PLATFORM_STYLES.other;
      // White version of the logo (readable on any brand color background).
      const iconHtml = style.logoSlug
        ? `<img class="icon" src="https://cdn.simpleicons.org/${style.logoSlug}/${style.text.replace('#', '')}" alt="" width="20" height="20" />`
        : `<span class="icon">${style.icon}</span>`;
      return `
      <a class="btn" href="${escapeHtml(link.url)}" style="background:${style.color};color:${style.text};">
        ${iconHtml} ${escapeHtml(link.label || 'Open Link')}
      </a>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
  <style>
    body {
      font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: ${theme.bg};
      margin: 0;
      padding: 32px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    h1 {
      font-size: 18px;
      color: ${theme.heading};
      margin-bottom: 24px;
      text-align: center;
    }
    .btn {
      display: block;
      width: 100%;
      max-width: 360px;
      box-sizing: border-box;
      text-decoration: none;
      padding: 16px 20px;
      margin-bottom: 12px;
      border-radius: 12px;
      border: 1px solid ${theme.border};
      font-size: 16px;
      font-weight: 600;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }
    .icon {
      margin-right: 8px;
      vertical-align: middle;
    }
    .btn:active { opacity: 0.85; }
  </style>
</head>
<body>
  <h1>${heading}</h1>
  ${buttons}
</body>
</html>`;
}

app.get('/r/:cardId', async (req, res) => {
  const { cardId } = req.params;

  if (!CARD_ID_PATTERN.test(cardId)) {
    return res.status(400).send('Invalid card ID.');
  }

  try {
    const snapshot = await db.ref(`cards/${cardId}`).get();

    if (!snapshot.exists()) {
      return res.status(404).send('This card is not recognized.');
    }

    const card = snapshot.val();
    const links = Array.isArray(card.links) ? card.links.filter((l) => l && l.url) : [];

    if (!card.active || links.length === 0) {
      return res.status(410).send('This card is not currently active.');
    }

    res.set('Cache-Control', 'no-store');

    if (links.length === 1) {
      return res.redirect(302, links[0].url);
    }

    return res.status(200).send(renderLinksPage(cardId, links, card.theme, card.storeName));
  } catch (err) {
    console.error(`Redirect lookup failed for cardId=${cardId}:`, err);
    return res.status(500).send('Internal error resolving card.');
  }
});

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Redirect server listening on port ${PORT}`);
  });
}

module.exports = app;
