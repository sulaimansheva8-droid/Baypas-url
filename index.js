const express = require("express");
const { bypass } = require("../resolver");

const app = express();
app.use(express.json());

app.post("/api/bypass", async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, error: "URL tidak valid, bro 😅" });
  }
  try {
    const result = await bypass(url.trim());
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Gagal resolve" });
  }
});

module.exports = app;
