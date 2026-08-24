/**
 * Dynamic redirect engine for NFC/QR review cards.
 *
 * Route: GET /r/:cardId
 * Reads cards/{cardId} from Firebase Realtime Database and issues a
 * 302 (temporary) redirect to targetUrl. 302 is mandatory here — a 301
 * would let mobile browsers cache the destination, breaking future
 * reactivations of the same physical card.
 */

require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');

// --- Firebase Admin initialization -----------------------------------------
// Preferred: set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path,
// or provide the three FIREBASE_* env vars below (handy for Render/Vercel where
// you can't easily mount a file). Never commit the service-account JSON.
function initFirebase() {
  if (admin.apps.length) return;

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error('Missing required env var: FIREBASE_DATABASE_URL');
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Whole service-account JSON passed as a single env var (common on PaaS).
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS file path or default ADC.
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL,
    });
  }
}

initFirebase();
const db = admin.database();

const app = express();

// Basic hardening: don't leak framework/version info.
app.disable('x-powered-by');

const CARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

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

    if (!card.active || !card.targetUrl) {
      // Card exists but has been reset / not yet activated by a sales rep.
      return res.status(410).send('This card is not currently active.');
    }

    // 302 Found — temporary redirect, explicitly prevents client-side caching
    // of the destination so re-activating the same physical card works.
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, card.targetUrl);
  } catch (err) {
    console.error(`Redirect lookup failed for cardId=${cardId}:`, err);
    return res.status(500).send('Internal error resolving card.');
  }
});

// Lightweight health check for Render/Vercel uptime probes.
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// On Vercel, the platform imports `app` directly and calls it as a serverless
// function — it must NOT also call app.listen(). Locally (and on Render),
// there's no VERCEL env var, so this starts a normal always-on server.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Redirect server listening on port ${PORT}`);
  });
}

module.exports = app;
