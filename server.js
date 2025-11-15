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

app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Missing shop parameter");

  const redirectUri = `${HOST}/auth/callback`;
  const installUrl =
    `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
});

app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send("Missing required Shopify parameters.");
  }

  try {
    const tokenUrl = `https://${shop}/admin/oauth/access_token`;

    const response = await axios.post(tokenUrl, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });

    const accessToken = response.data.access_token;

    console.log("Connected store:", shop);
    console.log("Access token:", accessToken);

    res.send("Shopify store connected successfully!");
  } catch (err) {
    console.error(err);
    res.status(500).send("OAuth failed.");
  }
});

app.listen(3000, () => {
  console.log("Backend running on port 3000");
});
