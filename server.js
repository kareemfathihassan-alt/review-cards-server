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
  phone: { logoSlug: null, icon: '📞', color: '#34A853', text: '#ffffff' },
  menu: { logoSlug: null, icon: '📋', color: '#6b7280', text: '#ffffff' },
  website: { logoSlug: null, icon: '🌐', color: '#6b7280', text: '#ffffff' },
  other: { logoSlug: null, icon: '🔗', color: '#6b7280', text: '#ffffff' },
};

// A handful of ready-made visual templates, like Linktree's theme picker —
// each is just a background + accent color combo, no extra assets needed.
const THEMES = {
  light: {
    background: '#f5f5f7',
    heading: '#1a1a1a',
    subtext: '#666666',
    avatarBg: '#4285F4',
    buttonBg: 'rgba(255,255,255,0.9)',
    buttonBorder: 'rgba(0,0,0,0.08)',
    buttonText: '#1a1a1a',
  },
  dark: {
    background: '#0f0f0f',
    heading: '#f5f5f5',
    subtext: '#a0a0a0',
    avatarBg: '#4285F4',
    buttonBg: 'rgba(255,255,255,0.08)',
    buttonBorder: 'rgba(255,255,255,0.12)',
    buttonText: '#f5f5f5',
  },
  sunset: {
    background: 'linear-gradient(160deg, #ff7e5f 0%, #feb47b 50%, #ff6a88 100%)',
    heading: '#ffffff',
    subtext: 'rgba(255,255,255,0.85)',
    avatarBg: 'rgba(255,255,255,0.25)',
    buttonBg: 'rgba(255,255,255,0.92)',
    buttonBorder: 'rgba(255,255,255,0.5)',
    buttonText: '#1a1a1a',
  },
  ocean: {
    background: 'linear-gradient(160deg, #2193b0 0%, #6dd5ed 100%)',
    heading: '#ffffff',
    subtext: 'rgba(255,255,255,0.85)',
    avatarBg: 'rgba(255,255,255,0.25)',
    buttonBg: 'rgba(255,255,255,0.92)',
    buttonBorder: 'rgba(255,255,255,0.5)',
    buttonText: '#1a1a1a',
  },
  forest: {
    background: 'linear-gradient(160deg, #134e5e 0%, #71b280 100%)',
    heading: '#ffffff',
    subtext: 'rgba(255,255,255,0.85)',
    avatarBg: 'rgba(255,255,255,0.25)',
    buttonBg: 'rgba(255,255,255,0.92)',
    buttonBorder: 'rgba(255,255,255,0.5)',
    buttonText: '#1a1a1a',
  },
  midnight: {
    background: 'linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    heading: '#ffffff',
    subtext: 'rgba(255,255,255,0.7)',
    avatarBg: 'rgba(255,255,255,0.15)',
    buttonBg: 'rgba(255,255,255,0.1)',
    buttonBorder: 'rgba(255,255,255,0.2)',
    buttonText: '#ffffff',
  },
};

function renderLinksPage(cardId, links, themeName, storeName) {
  const theme = THEMES[themeName] || THEMES.light;
  const heading = storeName ? escapeHtml(storeName) : 'Choose an option';
  const initial = storeName ? escapeHtml(storeName.trim().charAt(0).toUpperCase()) : '📍';

  const buttons = links
    .map((link) => {
      const style = PLATFORM_STYLES[link.type] || PLATFORM_STYLES.other;
      const iconHtml = style.logoSlug
        ? `<img class="icon" src="https://cdn.simpleicons.org/${style.logoSlug}" alt="" width="22" height="22" />`
        : `<span class="icon">${style.icon}</span>`;
      return `
      <a class="btn" href="${escapeHtml(link.url)}">
        <span class="btn-icon-wrap">${iconHtml}</span>
        <span class="btn-label">${escapeHtml(link.label || 'Open Link')}</span>
      </a>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Poppins', -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      background: ${theme.background};
      min-height: 100vh;
      margin: 0;
      padding: 48px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .avatar {
      width: 84px;
      height: 84px;
      border-radius: 50%;
      background: ${theme.avatarBg};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: ${theme.heading};
      margin: 0 0 4px 0;
      text-align: center;
    }
    .subtitle {
      font-size: 13px;
      color: ${theme.subtext};
      margin: 0 0 28px 0;
      text-align: center;
    }
    .links {
      width: 100%;
      max-width: 380px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .btn {
      display: flex;
      align-items: center;
      width: 100%;
      background: ${theme.buttonBg};
      backdrop-filter: blur(8px);
      color: ${theme.buttonText};
      text-decoration: none;
      padding: 14px 18px;
      border-radius: 14px;
      border: 1px solid ${theme.buttonBorder};
      font-size: 15px;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(0,0,0,0.12);
      transition: transform 0.12s ease, box-shadow 0.12s ease;
    }
    .btn:active {
      transform: scale(0.97);
      box-shadow: 0 1px 4px rgba(0,0,0,0.12);
    }
    .btn-icon-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      margin-right: 12px;
      flex-shrink: 0;
    }
    .icon { display: block; }
    .btn-label {
      flex: 1;
      text-align: left;
    }
  </style>
</head>
<body>
  <div class="avatar">${initial}</div>
  <h1>${heading}</h1>
  <p class="subtitle">Tap an option below</p>
  <div class="links">
    ${buttons}
  </div>
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

    // Fire-and-forget scan counting — doesn't block the redirect, so it
    // never slows down the customer's experience.
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    db.ref(`cards/${cardId}/scanCount`).transaction((cur) => (cur || 0) + 1).catch(() => {});
    db.ref(`stats/monthly/${monthKey}`).transaction((cur) => (cur || 0) + 1).catch(() => {});

    if (links.length === 1) {
      return res.redirect(302, links[0].url);
    }

    return res.status(200).send(renderLinksPage(cardId, links, card.theme, card.storeName));
  } catch (err) {
    console.error(`Redirect lookup failed for cardId=${cardId}:`, err);
    return res.status(500).send('Internal error resolving card.');
  }
});

// Lets Android verify this app is allowed to auto-open for /r/... links,
// so scanning your own cards opens the app instead of a browser.
// SHA256_FINGERPRINT_HERE gets replaced with your app's real signing
// fingerprint — see the setup notes for how to get it.
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.example.reviewcards',
        sha256_cert_fingerprints: ['71:0B:F8:D8:52:47:61:94:CF:B1:92:D3:F8:A5:D8:75:D1:65:8E:17:BC:D1:56:59:F4:C8:E8:E0:4A:AE:75:5F'],
      },
    },
  ]);
});

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Redirect server listening on port ${PORT}`);
  });
}

module.exports = app;
