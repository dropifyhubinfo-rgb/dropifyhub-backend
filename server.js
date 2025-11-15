import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

const app = express();
app.use(cookieParser());

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  SCOPES,
  HOST
} = process.env;

// 1️⃣ AUTH START
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const redirectUri = `${HOST}/auth/callback`;

  const installUrl = 
    `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
});

// 2️⃣ AUTH CALLBACK
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send("Missing required Shopify parameters.");
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      }
    );

    const accessToken = tokenResponse.data.access_token;

    res.send(`App Installed! ACCESS TOKEN: ${accessToken}`);
  } catch (error) {
    console.error("Token exchange error:", error.response?.data || error);
    res.status(500).send("OAuth error.");
  }
});

// 3️⃣ ROOT PAGE
app.get("/", (req, res) => {
  res.send("Backend is online!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));



