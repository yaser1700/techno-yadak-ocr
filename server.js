const express = require("express");
const multer = require("multer");
const path = require("path");
const FormData = require("form-data");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const OCR_API_KEY = process.env.OCR_API_KEY || "";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ ok: true, ocrKeyConfigured: !!OCR_API_KEY });
});

app.post("/api/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!OCR_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OCR_API_KEY روی سرور تنظیم نشده است."
      });
    }
    if (!req.file) {
      return res.status(400).json({ ok:false, error:"فایل تصویر ارسال نشده است." });
    }

    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname || "invoice.jpg",
      contentType: req.file.mimetype || "image/jpeg"
    });
    form.append("language", "per");
    form.append("OCREngine", "3");
    form.append("isTable", "true");
    form.append("detectOrientation", "true");
    form.append("scale", "true");

    const r = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: {
        apikey: OCR_API_KEY,
        ...form.getHeaders()
      },
      body: form
    });

    const text = await r.text();

    if (!r.ok) {
      return res.status(r.status).json({
        ok:false,
        error:`OCR.space HTTP ${r.status}`,
        raw:text.slice(0,1000)
      });
    }

    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(502).json({ok:false,error:"پاسخ OCR معتبر نبود.",raw:text.slice(0,1000)}); }

    if (data.IsErroredOnProcessing) {
      return res.status(422).json({
        ok:false,
        error:(data.ErrorMessage || []).join(" ") || "OCR خطا داد.",
        data
      });
    }

    const ocrText = (data.ParsedResults || [])
      .map(x => x.ParsedText || "")
      .join("\n");

    res.json({ ok:true, text:ocrText, data });
  } catch (e) {
    res.status(500).json({ok:false,error:e.message || "خطای سرور"});
  }
});

app.listen(PORT, () => console.log(`Techno OCR backend listening on ${PORT}`));
