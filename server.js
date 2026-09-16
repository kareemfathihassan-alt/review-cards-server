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

function renderLinksPage(cardId, links, themeName, storeName, logoUrl) {
  const theme = THEMES[themeName] || THEMES.light;
  const heading = storeName ? escapeHtml(storeName) : 'Choose an option';
  const initial = storeName ? escapeHtml(storeName.trim().charAt(0).toUpperCase()) : '📍';

  const avatarHtml = logoUrl
    ? `<img class="avatar" src="${escapeHtml(logoUrl)}" alt="" />`
    : `<div class="avatar avatar-fallback">${initial}</div>`;

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
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      object-fit: cover;
    }
    .avatar-fallback {
      background: ${theme.avatarBg};
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 34px;
      font-weight: 700;
      color: #ffffff;
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
  ${avatarHtml}
  <h1>${heading}</h1>
  <p class="subtitle">Tap an option below</p>
  <div class="links">
    ${buttons}
  </div>
</body>
</html>`;
}

// 3 looks each for restaurants and cafes — restaurants lean elegant/premium,
// cafes lean warm/cozy. Each just controls colors and font, no extra assets.
const MENU_STYLES = {
  'restaurant-0': { // elegant dark + gold
    background: '#1a1a1a', heading: '#d4af37', cardBg: '#2a2a2a',
    itemName: '#f5f5f5', itemPrice: '#d4af37', font: "'Playfair Display', Georgia, serif",
  },
  'restaurant-1': { // warm trattoria red
    background: '#fdf6f0', heading: '#8b1e1e', cardBg: '#ffffff',
    itemName: '#2a2a2a', itemPrice: '#8b1e1e', font: "'Poppins', sans-serif",
  },
  'restaurant-2': { // clean modern green
    background: '#f7faf8', heading: '#1a1a1a', cardBg: '#ffffff',
    itemName: '#1a1a1a', itemPrice: '#2e7d32', font: "'Poppins', sans-serif",
  },
  'cafe-0': { // cozy warm brown
    background: '#f5ede1', heading: '#5c3d2e', cardBg: '#fffaf3',
    itemName: '#3d2b1f', itemPrice: '#a9683d', font: "'Poppins', sans-serif",
  },
  'cafe-1': { // soft pastel
    background: '#fdf2f8', heading: '#a45c8c', cardBg: '#ffffff',
    itemName: '#3a2a35', itemPrice: '#d98ab3', font: "'Poppins', sans-serif",
  },
  'cafe-2': { // minimal orange accent
    background: '#ffffff', heading: '#1a1a1a', cardBg: '#fafafa',
    itemName: '#1a1a1a', itemPrice: '#e07a2c', font: "'Poppins', sans-serif",
  },
};

function renderMenuPage(storeName, items, category, templateIndex) {
  const styleKey = `${category === 'cafe' ? 'cafe' : 'restaurant'}-${[0, 1, 2].includes(templateIndex) ? templateIndex : 0}`;
  const style = MENU_STYLES[styleKey];
  const heading = storeName ? escapeHtml(storeName) : (category === 'cafe' ? 'Our Menu' : 'Our Menu');

  const itemsHtml = items
    .map((item) => {
      const photoHtml = item.photoDataUri
        ? `<img class="item-photo" src="${escapeHtml(item.photoDataUri)}" alt="" />`
        : `<div class="item-photo item-photo-placeholder">🍽️</div>`;
      return `
      <div class="item">
        ${photoHtml}
        <div class="item-info">
          <span class="item-name">${escapeHtml(item.name)}</span>
          ${item.price ? `<span class="item-price">${escapeHtml(item.price)}</span>` : ''}
        </div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: ${style.font};
      background: ${style.background};
      min-height: 100vh;
      margin: 0;
      padding: 40px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    h1 {
      color: ${style.heading};
      font-size: 26px;
      margin: 0 0 28px 0;
      text-align: center;
    }
    .menu-list {
      width: 100%;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .item {
      display: flex;
      align-items: center;
      background: ${style.cardBg};
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .item-photo {
      width: 60px;
      height: 60px;
      border-radius: 10px;
      object-fit: cover;
      margin-right: 14px;
      flex-shrink: 0;
    }
    .item-photo-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.05);
      font-size: 24px;
    }
    .item-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }
    .item-name {
      color: ${style.itemName};
      font-weight: 600;
      font-size: 15px;
    }
    .item-price {
      color: ${style.itemPrice};
      font-weight: 700;
      font-size: 15px;
      margin-left: 12px;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <h1>${heading}</h1>
  <div class="menu-list">
    ${itemsHtml}
  </div>
</body>
</html>`;
}

app.get('/menu/:cardId', async (req, res) => {
  const { cardId } = req.params;

  if (!CARD_ID_PATTERN.test(cardId)) {
    return res.status(400).send('Invalid card ID.');
  }

  try {
    const [cardSnap, menuSnap] = await Promise.all([
      db.ref(`cards/${cardId}`).get(),
      db.ref(`menus/${cardId}`).get(),
    ]);

    if (!menuSnap.exists()) {
      return res.status(404).send('No menu found for this card.');
    }

    const menu = menuSnap.val();
    const storeName = cardSnap.exists() ? (cardSnap.val().storeName || '') : '';
    const items = Array.isArray(menu.items) ? menu.items : [];

    res.set('Cache-Control', 'no-store');
    return res.status(200).send(renderMenuPage(storeName, items, menu.category, menu.templateIndex));
  } catch (err) {
    console.error(`Menu lookup failed for cardId=${cardId}:`, err);
    return res.status(500).send('Internal error loading menu.');
  }
});

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

    return res.status(200).send(renderLinksPage(cardId, links, card.theme, card.storeName, card.logoUrl));
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
