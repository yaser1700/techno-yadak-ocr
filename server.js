const express = require("express");
const multer = require("multer");
const FormData = require("form-data");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }
});

const PORT = Number(process.env.PORT) || 10000;
const OCR_API_KEY = process.env.OCR_API_KEY || "";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "techno-yadak-ocr",
    port: PORT
  });
});

app.post("/api/ocr", upload.single("file"), async (req, res) => {
  try {
    if (!OCR_API_KEY) {
      return res.status(500).json({ ok: false, error: "OCR_API_KEY is not configured on the server." });
    }
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ ok: false, error: "No image file was uploaded." });
    }

    const form = new FormData();
    form.append("apikey", OCR_API_KEY);
    form.append("language", "per");
    form.append("OCREngine", "3");
    form.append("isTable", "true");
    form.append("detectOrientation", "true");
    form.append("scale", "true");
    form.append("isOverlayRequired", "false");
    form.append("file", req.file.buffer, {
      filename: req.file.originalname || "invoice.jpg",
      contentType: req.file.mimetype || "image/jpeg"
    });

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: form.getHeaders(),
      body: form
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return res.status(502).json({
        ok: false,
        error: "OCR provider returned an invalid response.",
        providerStatus: response.status,
        raw: raw.slice(0, 2000)
      });
    }

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: "OCR provider request failed.",
        providerStatus: response.status,
        provider: data
      });
    }

    if (data.IsErroredOnProcessing) {
      return res.status(422).json({
        ok: false,
        error: "OCR processing failed.",
        provider: data
      });
    }

    const parsed = Array.isArray(data.ParsedResults) ? data.ParsedResults : [];
    const text = parsed.map(x => x.ParsedText || "").join("\n");

    return res.json({
      ok: true,
      text,
      provider: {
        ocrExitCode: data.OCRExitCode,
        processingTimeInMilliseconds: data.ProcessingTimeInMilliseconds,
        parsedResults: parsed.length
      }
    });
  } catch (err) {
    console.error("OCR error:", err);
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Techno OCR backend listening on 0.0.0.0:${PORT}`);
});
