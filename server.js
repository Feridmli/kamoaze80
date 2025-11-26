// server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// ---------------- Supabase ----------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---------------- Express Init ----------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ---------------- Static Files ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

app.get("/", (req, res) => {
  const indexFile = fs.existsSync(path.join(distPath, "index.html"))
    ? path.join(distPath, "index.html")
    : path.join(__dirname, "index.html");
  res.sendFile(indexFile);
});

// ---------------- Status ----------------
app.get("/api/status", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------------- NFT List (from metadata) ----------------
app.get("/api/nfts", async (req, res) => {
  try {
    const { data, error } = await supabase.from("metadata").select("*").order("tokenid", { ascending: true });
    if (error) throw error;
    res.json({ success: true, nfts: data });
  } catch (err) {
    console.error("GET /api/nfts error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ---------------- Create / Upsert Order ----------------
app.post("/api/order", async (req, res) => {
  try {
    const {
      tokenid,
      price,
      seller_address,
      buyer_address,
      seaport_order,
      order_hash,
      image,
      status = "active",
    } = req.body;

    if (!tokenid || !seller_address || !seaport_order || !order_hash) {
      // 🐛 Düzəliş 1: Əskik məlumatların loglanması
      console.error("POST /api/order error: Missing required fields in body:", req.body);
      return res.status(400).json({ success: false, error: "Missing tokenid, seller_address, seaport_order or order_hash" });
    }

    const id = nanoid();
    const now = new Date().toISOString();

    // Upsert into orders table (use order_hash as conflict key)
    const { error: orderError } = await supabase.from("orders").upsert(
      {
        id,
        tokenid: tokenid?.toString() || null,
        price: price || null,
        nft_contract: process.env.NFT_CONTRACT_ADDRESS,
        marketplace_contract: process.env.SEAPORT_CONTRACT_ADDRESS,
        seller_address: seller_address.toLowerCase(),
        buyer_address: buyer_address?.toLowerCase() || null,
        seaport_order,
        order_hash,
        on_chain: !!buyer_address,
        status,
        image: image || null,
        createdat: now,
        updatedat: now,
      },
      { onConflict: "order_hash" }
    );

    if (orderError) {
      // 🐛 Düzəliş 2: Order upsert xətalarının detallı loglanması
      console.error("orders upsert error:", orderError.message, orderError.details);
      throw orderError;
    }

    // ALSO upsert into metadata table so frontend loadNFTs() shows updated price + seaport_order
    const metaRow = {
      tokenid: tokenid?.toString() || null,
      price: price || null,
      nft_contract: process.env.NFT_CONTRACT_ADDRESS,
      marketplace_contract: process.env.SEAPORT_CONTRACT_ADDRESS,
      buyer_address: null,
      seaport_order,
      order_hash,
      on_chain: false,
      updatedat: now,
      // don't overwrite name/image if already present (upsert will replace row unless we fetch first; but we'll upsert to ensure price/order present)
    };

    const { error: metaError } = await supabase.from("metadata").upsert(metaRow, { onConflict: "tokenid" });

    if (metaError) {
      // 🐛 Düzəliş 3: Metadata upsert xətalarının detallı loglanması
      console.warn("metadata upsert warning:", metaError.message);
    }

    res.json({ success: true });
  } catch (err) {
    // 🐛 Düzəliş 4: Ümumi xəta mesajını front-endə qaytarmaq üçün
    console.error("POST /api/order caught fatal error:", err.message);
    res.status(500).json({ success: false, error: "Server error", detail: err.message });
  }
});

// ---------------- Get Orders ----------------
app.get("/api/orders", async (req, res) => {
  try {
    const { data, error } = await supabase.from("orders")
      .select("*")
      .order("createdat", { ascending: false })
      .limit(500);

    if (error) throw error;
    res.json({ success: true, orders: data });
  } catch (err) {
    console.error("GET /api/orders error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ---------------- Buy Callback ----------------
app.post("/api/buy", async (req, res) => {
  try {
    const { order_hash, buyer_address, tokenid } = req.body;
    if (!order_hash || !buyer_address) {
      return res.status(400).json({ success: false, error: "Missing order_hash or buyer_address" });
    }

    const { data, error } = await supabase.from("orders")
      .update({
        on_chain: true,
        buyer_address: buyer_address.toLowerCase(),
        status: "fulfilled",
        updatedat: new Date().toISOString(),
      })
      .eq("order_hash", order_hash)
      .select();

    if (error) throw error;

    // ✅ Düzəliş 5: Metadata update - Listing məlumatlarını (qiymət, order) təmizləmək
    await supabase.from("metadata")
      .update({ 
        buyer_address: buyer_address.toLowerCase(), 
        on_chain: true, 
        updatedat: new Date().toISOString(),
        price: 0, 
        seaport_order: null,
        order_hash: null,
      })
      .eq("order_hash", order_hash);

    // as fallback update by tokenid if order_hash linking failed
    if ((!data || data.length === 0) && tokenid) {
      await supabase.from("metadata")
        .update({ 
          buyer_address: buyer_address.toLowerCase(), 
          on_chain: true, 
          updatedat: new Date().toISOString(),
          price: 0, 
          seaport_order: null,
          order_hash: null,
        })
        .eq("tokenid", tokenid.toString());
    }

    res.json({ success: true, order: data && data[0] ? data[0] : null });
  } catch (err) {
    console.error("POST /api/buy error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ---------------- Start Server ----------------
app.listen(PORT, () => console.log(`🚀 Backend ${PORT}-də işləyir`));
