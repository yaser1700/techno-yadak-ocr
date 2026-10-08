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
const OCR_URL = "https://api.ocr.space/parse/image";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "techno-yadak-ocr", port: PORT, ocrKeyConfigured: Boolean(OCR_API_KEY) });
});

function safeProviderSummary(data) {
  if (!data || typeof data !== "object") return null;
  return {
    OCRExitCode: data.OCRExitCode,
    IsErroredOnProcessing: data.IsErroredOnProcessing,
    ErrorMessage: data.ErrorMessage,
    ErrorDetails: data.ErrorDetails,
    ProcessingTimeInMilliseconds: data.ProcessingTimeInMilliseconds,
    parsedResultsCount: Array.isArray(data.ParsedResults) ? data.ParsedResults.length : 0
  };
}

app.post("/api/ocr", upload.single("file"), async (req, res) => {
  const started = Date.now();
  try {
    console.log("[OCR] request received", { hasKey: Boolean(OCR_API_KEY), fileName: req.file?.originalname, mime: req.file?.mimetype, bytes: req.file?.size });
    if (!OCR_API_KEY) return res.status(500).json({ ok:false, error:"سرور OCR_API_KEY ندارد.", debugCode:"MISSING_API_KEY" });
    if (!req.file?.buffer?.length) return res.status(400).json({ ok:false, error:"فایل تصویر دریافت نشد.", debugCode:"NO_FILE" });
    if (req.file.size > 1024 * 1024) return res.status(413).json({ ok:false, error:"حجم عکس بیشتر از ۱ مگابایت است.", debugCode:"FILE_OVER_1MB", bytes:req.file.size });

    const form = new FormData();
    form.append("language", "per");
    form.append("OCREngine", "3");
    form.append("isTable", "true");
    form.append("detectOrientation", "true");
    form.append("scale", "true");
    form.append("isOverlayRequired", "false");
    form.append("file", req.file.buffer, { filename:req.file.originalname || "invoice.jpg", contentType:req.file.mimetype || "image/jpeg" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      response = await fetch(OCR_URL, { method:"POST", headers:{...form.getHeaders(), apikey:OCR_API_KEY}, body:form, signal:controller.signal });
    } finally { clearTimeout(timer); }

    const raw = await response.text();
    console.log("[OCR] provider HTTP status", response.status);
    console.log("[OCR] provider raw response", raw.slice(0, 4000));
    let data;
    try { data = JSON.parse(raw); } catch (_) {
      return res.status(502).json({ ok:false, error:"OCR.space پاسخ JSON معتبر برنگرداند.", debugCode:"PROVIDER_INVALID_JSON", providerStatus:response.status, providerRawPreview:raw.slice(0,1200) });
    }
    const provider = safeProviderSummary(data);
    if (!response.ok) return res.status(502).json({ ok:false, error:`OCR.space خطای HTTP ${response.status} برگرداند.`, debugCode:"PROVIDER_HTTP_ERROR", providerStatus:response.status, provider });
    if (data.IsErroredOnProcessing) return res.status(422).json({ ok:false, error:"OCR.space تصویر را پردازش نکرد.", debugCode:"PROVIDER_PROCESSING_ERROR", providerStatus:response.status, provider });

    const parsed = Array.isArray(data.ParsedResults) ? data.ParsedResults : [];
    const text = parsed.map(x => x.ParsedText || "").join("\n");
    console.log("[OCR] success", { parsedResults:parsed.length, textLength:text.length, elapsedMs:Date.now()-started });
    return res.json({ ok:true, text, provider:{ocrExitCode:data.OCRExitCode, processingTimeInMilliseconds:data.ProcessingTimeInMilliseconds, parsedResults:parsed.length} });
  } catch (err) {
    console.error("[OCR] request exception", err);
    return res.status(500).json({ ok:false, error:err?.message || String(err), debugCode:err?.name === "AbortError" ? "PROVIDER_TIMEOUT" : "SERVER_EXCEPTION", elapsedMs:Date.now()-started });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Techno OCR backend listening on 0.0.0.0:${PORT}`));
