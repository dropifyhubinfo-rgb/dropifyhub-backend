<— FULL NEW server.js CODE —>
// ===============================
// Simple Shopify OAuth Backend
// ===============================

import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
app.use(cookieParser());
app.use(express.json());

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST
} = process.env;

// -------------------------------
// 1️⃣ START OAUTH
// -------------------------------
app.get("/auth", (req, res) => {
  const shop = req.query.shop;

  if (!shop) {
    return res.status(400).send("Shop query missing");
  }

  const redirectUri = `${HOST}/auth/callback`;
  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
});

// -------------------------------
// 2️⃣ HANDLE CALLBACK
// -------------------------------
app.get("/auth/callback", async (req, res) => {
  const { code, shop } = req.query;

  if (!shop || !code) {
    return res.status(400).send("Missing shop or code");
  }

  const tokenUrl = `https://${shop}/admin/oauth/access_token`;

  try {
    const response = await axios.post(tokenUrl, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });

    const accessToken = response.data.access_token;

    // Store in cookie TEMPORARILY (for development)
    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none"
    });

    console.log("Shop installed:", shop);
    console.log("TOKEN:", accessToken);

    // Redirect to your app page inside Shopify admin
    res.redirect(`https://${shop}/admin/apps/dropifyhub`);
    
  } catch (err) {
    console.error("OAuth error:", err.response?.data || err);
    res.status(500).send("OAuth error during token exchange");
  }
});

// -------------------------------
// 3️⃣ ROOT PAGE
// -------------------------------
app.get("/", (req, res) => {
  res.send("DropifyHub backend running ✔️");
});

// -------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));


