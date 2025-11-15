require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');

const app = express();
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SHOPIFY_APP_URL,
  OPENAI_API_KEY,
  PORT = 3000,
} = process.env;

let openai = null;
if (OPENAI_API_KEY) {
  openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));
}

// Temporary store (replace with DB in production)
const tokenStore = {}; // { shopDomain: accessToken }

// Helper: OAuth URL
function buildShopifyInstallURL(shop, state) {
  const scopes = [
    'write_themes',
    'write_products',
    'read_themes',
    'read_products',
  ].join(',');
  const redirect = `${SHOPIFY_APP_URL}/auth/callback`;
  return `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${encodeURIComponent(
    scopes
  )}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
}

// Helper: Verify HMAC
function verifyHmac(query) {
  const { hmac, ...params } = query;
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  const generated = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  return generated === hmac;
}

// Helper: Exchange OAuth code for token
async function exchangeCodeForToken(shop, code) {
  const url = `https://${shop}/admin/oauth/access_token`;
  const resp = await axios.post(url, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    code,
  });
  return resp.data.access_token;
}

// Helper: Perform Shopify API request
async function shopifyRequest(shop, accessToken, method, path, data) {
  const url = `https://${shop}/admin/api/2024-10/${path}`;
  return axios({
    method,
    url,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    data,
  });
}

// Optional AI generator
async function generateAIContent({ storeName, niche }) {
  if (!openai) {
    return {
      title: storeName || 'DropifyHub Store',
      tagline: 'Clean, monochrome style website.',
      products: [
        {
          title: 'Minimal Essential Tee',
          desc: 'A premium black/white minimal tee.',
          price: '29.99',
        },
        {
          title: 'Monochrome Hoodie',
          desc: 'A cosy hoodie with clean branding.',
          price: '59.99',
        },
      ],
      cssNotes: 'Black background, white text, minimal layout.',
    };
  }

  const prompt = `
Design a black & white Shopify store.

Store: ${storeName}
Niche: ${niche}

Return JSON:
{
  "title": "...",
  "tagline": "...",
  "cssNotes": "...",
  "products": [
    {"title": "...", "desc": "...", "price": "..."}
  ]
}
`;

  const gresp = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt,
    max_tokens: 400,
    temperature: 0.85,
  });

  try {
    const text = gresp.data.choices[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    return {
      title: storeName,
      tagline: niche,
      products: [],
      cssNotes: 'Minimal black & white.',
    };
  }
}

// ----------------------------
// OAuth Routes
// ----------------------------

// Step 1: Begin OAuth
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const state = crypto.randomBytes(12).toString('hex');
  res.cookie('state', state, { httpOnly: true });

  const installURL = buildShopifyInstallURL(shop, state);
  res.redirect(installURL);
});

// Step 2: OAuth Callback
app.get('/auth/callback', async (req, res) => {
  try {
    const { shop, hmac, code, state } = req.query;
    if (state !== req.cookies.state) return res.status(400).send('Invalid state');
    if (!verifyHmac(req.query)) return res.status(400).send('Bad HMAC');

    const token = await exchangeCodeForToken(shop, code);
    tokenStore[shop] = token;

    res.redirect(`/app.html?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    res.status(500).send('OAuth failed: ' + err.message);
  }
});

// ----------------------------
// API: Generate Theme
// ----------------------------
app.post('/api/generate-theme', async (req, res) => {
  try {
    const { shop, storeName, niche } = req.body;
    const token = tokenStore[shop];

    if (!shop || !token)
      return res.status(400).json({ error: 'Invalid shop or token missing' });

    const ai = await generateAIContent({ storeName, niche });

    // Create theme
    const themeResp = await shopifyRequest(shop, token, 'post', 'themes.json', {
      theme: { name: `${storeName} AI Theme`, role: 'unpublished' },
    });
    const theme = themeResp.data.theme;

    // Upload CSS
    const cssValue = `
body{background:#000;color:#fff;font-family:system-ui;}
h1,h2{color:#fff;}
/* ${ai.cssNotes} */
`;
    await shopifyRequest(
      shop,
      token,
      'put',
      `themes/${theme.id}/assets.json`,
      { asset: { key: 'assets/ai-style.css', value: cssValue } }
    );

    // Upload homepage
    const indexLiquid = `
{% layout none %}
<html>
<head>
<title>${ai.title}</title>
{{ 'ai-style.css' | asset_url | stylesheet_tag }}
</head>
<body>
<div class="header">
<h1>${ai.title}</h1>
<p>${ai.tagline}</p>
</div>
</body>
</html>
`;
    await shopifyRequest(
      shop,
      token,
      'put',
      `themes/${theme.id}/assets.json`,
      { asset: { key: 'templates/index.liquid', value: indexLiquid } }
    );

    res.json({
      success: true,
      themeId: theme.id,
      themeName: theme.name,
      aiPreview: ai,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// API: Generate Products
// ----------------------------
app.post('/api/generate-products', async (req, res) => {
  try {
    const { shop, storeName, niche } = req.body;
    const token = tokenStore[shop];

    if (!token) return res.status(400).json({ error: 'No token for shop' });

    const ai = await generateAIContent({ storeName, niche });

    const created = [];
    for (const p of ai.products.slice(0, 5)) {
      const resp = await shopifyRequest(shop, token, 'post', 'products.json', {
        product: {
          title: p.title,
          body_html: p.desc,
          variants: [{ price: p.price }],
        },
      });
      created.push(resp.data.product);
    }

    res.json({ success: true, created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simple root
app.get('/', (req, res) => {
  res.send('<h2>DropifyHub App Running</h2>');
});

app.listen(PORT, () => console.log(`DropifyHub app running on ${PORT}`));

