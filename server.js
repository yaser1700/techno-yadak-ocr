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
const ORDERS = new Map();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));


app.post("/api/orders", (req,res)=>{
  try {
    const {picker, items, invoiceNo, invoiceName} = req.body || {};
    if(!picker || !invoiceNo || !Array.isArray(items) || !items.length) return res.status(400).json({ok:false,error:"شماره فاکتور، نام جمع‌آور و اقلام فاکتور الزامی است."});
    const id=String(invoiceNo).trim();
    if(ORDERS.has(id)) return res.status(409).json({ok:false,error:"برای این شماره فاکتور قبلاً مأموریت ساخته شده است."});
    const order={id,picker,invoiceNo:id,invoiceName:invoiceName||"",items:items.map((x,i)=>({index:i,code:String(x.code||""),name:String(x.name||""),expectedQty:Number(x.qty)||0,actualQty:0,checked:false,issue:""})),status:"assigned",createdAt:new Date().toISOString()};
    ORDERS.set(id,order);
    res.json({ok:true,order});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
app.get("/api/orders/:id",(req,res)=>{
  const o=ORDERS.get(String(req.params.id||"").toUpperCase());
  if(!o) return res.status(404).json({ok:false,error:"ماموریت پیدا نشد یا سرور از نو راه‌اندازی شده است."});
  res.json({ok:true,order:o});
});
app.patch("/api/orders/:id",(req,res)=>{
  const o=ORDERS.get(String(req.params.id||"").toUpperCase());
  if(!o) return res.status(404).json({ok:false,error:"ماموریت پیدا نشد."});
  const incoming=Array.isArray(req.body?.items)?req.body.items:[];
  incoming.forEach(x=>{ const i=Number(x.index); if(o.items[i]){o.items[i].actualQty=Math.max(0,Number(x.actualQty)||0);o.items[i].checked=Boolean(x.checked);o.items[i].issue=o.items[i].actualQty===o.items[i].expectedQty?"":(o.items[i].actualQty<o.items[i].expectedQty?"کسری":"اضافی");}});
  o.status=req.body?.status||o.status; o.updatedAt=new Date().toISOString();
  res.json({ok:true,order:o});
});

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
    if (req.file.size > 10 * 1024 * 1024) return res.status(413).json({ ok:false, error:"حجم فایل بیشتر از ۱۰ مگابایت است.", debugCode:"FILE_OVER_10MB", bytes:req.file.size });

    const form = new FormData();
    form.append("language", "per");
    form.append("OCREngine", "3");
    form.append("isTable", "true");
    form.append("detectOrientation", "true");
    form.append("scale", "true");
    form.append("isOverlayRequired", "true");
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
    const overlayLines = parsed.flatMap((x, pageIndex) => {
      const lines = x?.TextOverlay?.Lines || [];
      return lines.map(line => ({
        page: pageIndex,
        text: line.LineText || "",
        words: (line.Words || []).map(w => ({ text:w.WordText || "", left:w.Left, top:w.Top, width:w.Width, height:w.Height }))
      }));
    });
    console.log("[OCR] success", { parsedResults:parsed.length, textLength:text.length, overlayLines:overlayLines.length, elapsedMs:Date.now()-started });
    return res.json({ ok:true, text, overlayLines, provider:{ocrExitCode:data.OCRExitCode, processingTimeInMilliseconds:data.ProcessingTimeInMilliseconds, parsedResults:parsed.length} });
  } catch (err) {
    console.error("[OCR] request exception", err);
    return res.status(500).json({ ok:false, error:err?.message || String(err), debugCode:err?.name === "AbortError" ? "PROVIDER_TIMEOUT" : "SERVER_EXCEPTION", elapsedMs:Date.now()-started });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Techno OCR backend listening on 0.0.0.0:${PORT}`));
