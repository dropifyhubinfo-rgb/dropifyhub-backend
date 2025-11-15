require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');

const app = express();
app.use(cookieParser());
app.use(bodyParser.json());

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_APP_URL,
  PORT = 3000,
} = process.env;

// TEMP DB (replace with Supabase later)
const tokenStore = {}; // { shop: access_token }

// Build OAuth URL
function buildAuthUrl(shop, state) {
  const scopes = [
    'write_themes',
    'write_products',
    'read_themes',
    'read_products'
  ].join(',');

  const redirectUri = `${SHOPIFY_APP_URL}/auth/callback`;

  return `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${scopes}` +
    `&redirect_uri=${redirectUri}` +
    `&state=${state}`;
}

// Verify HMAC
function verifyHmac(query) {
  const { hmac, ...rest } = query;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const hash = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');
  return hash === hmac;
}

// Exchange OAuth code for token
async function getToken(shop, code) {
  const url = `https://${shop}/admin/oauth/access_token`;
  const r = await axios.post(url, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    code
  });
  return r.data.access_token;
}

// Shopify Request
async function shopifyRequest(shop, token, method, path, data) {
  return axios({
    method,
    url: `https://${shop}/admin/api/2024-10/${path}`,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    data
  });
}

// ------------------------------
// AUTH ROUTES
// ------------------------------
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing ?shop=");

  const state = crypto.randomBytes(12).toString("hex");
  res.cookie("state", state);

  res.redirect(buildAuthUrl(shop, state));
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { shop, code, state } = req.query;

    if (state !== req.cookies.state)
      return res.status(400).send("Invalid state.");

    if (!verifyHmac(req.query))
      return res.status(400).send("Bad HMAC.");

    const accessToken = await getToken(shop, code);

    tokenStore[shop] = accessToken;

    res.send(`
      <h2>DropifyHub App Installed</h2>
      <p>You can now return to the DropifyHub website.</p>
    `);
  } catch (e) {
    res.status(500).send("Auth failed.");
  }
});

// --------------------------------
// API: PUSH THEME
// --------------------------------
app.post('/api/push-theme', async (req, res) => {
  try {
    const { shop, html, css } = req.body;
    const token = tokenStore[shop];

    if (!token) return res.status(400).json({ error: "No token for shop." });

    // Create theme
    const t = await shopifyRequest(shop, token, 'post', 'themes.json', {
      theme: {
        name: "DropifyHub AI Theme",
        role: "unpublished"
      }
    });

    const themeId = t.data.theme.id;

    // Upload CSS
    await shopifyRequest(shop, token, 'put', `themes/${themeId}/assets.json`, {
      asset: { key: "assets/ai.css", value: css }
    });

    // Upload index.liquid
    await shopifyRequest(shop, token, 'put', `themes/${themeId}/assets.json`, {
      asset: { key: "templates/index.liquid", value: html }
    });

    res.json({ success: true, themeId });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// --------------------------------
// API: PUSH PRODUCTS
// --------------------------------
app.post('/api/push-products', async (req, res) => {
  try {
    const { shop, products } = req.body;
    const token = tokenStore[shop];

    if (!token) return res.status(400).json({ error: "No token for shop." });

    const created = [];

    for (const p of products) {
      const r = await shopifyRequest(shop, token, 'post', 'products.json', {
        product: {
          title: p.title,
          body_html: p.desc,
          variants: [{ price: p.price }]
        }
      });
      created.push(r.data.product);
    }

    res.json({ success: true, created });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.listen(PORT
