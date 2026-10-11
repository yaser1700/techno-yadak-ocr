const express = require("express");
const multer = require("multer");
const FormData = require("form-data");
const fetch = require("node-fetch");
const path = require("path");
const XLSX = require("xlsx");

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


// Import invoice spreadsheets directly; do not send Excel files through OCR.
const { parseInvoiceWorkbook } = require("./invoice-import");
app.post("/api/import-invoice", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ok:false,error:"فایل اکسل انتخاب نشده است."});
    const ext = path.extname(decodeURIComponent(req.file.originalname || "")).toLowerCase();
    if (![".xls", ".xlsx", ".xlsm"].includes(ext)) return res.status(400).json({ok:false,error:"فقط فایل اکسل XLS یا XLSX قابل قبول است."});
    const book = XLSX.read(req.file.buffer, {type:"buffer", cellDates:false});
    const result = parseInvoiceWorkbook(book, XLSX);
    res.json(result);
  } catch(e) {
    console.error("Excel import failed", e);
    res.status(400).json({ok:false,error:"خواندن فایل اکسل ناموفق بود: "+e.message});
  }
});

app.post("/api/orders", (req,res)=>{
  try {
    const {picker, customerName, items, invoiceNo, invoiceName} = req.body || {};
    if(!picker || !invoiceNo || !Array.isArray(items) || !items.length) return res.status(400).json({ok:false,error:"شماره فاکتور، نام جمع‌آور و اقلام فاکتور الزامی است."});
    const id=String(invoiceNo).trim();
    if(ORDERS.has(id)) return res.status(409).json({ok:false,error:"برای این شماره فاکتور قبلاً مأموریت ساخته شده است."});
    const order={id,picker,customerName:String(customerName||"").trim(),invoiceNo:id,invoiceName:invoiceName||"",items:items.map((x,i)=>({index:i,code:String(x.code||""),name:String(x.name||""),expectedQty:Number(x.qty)||0,actualQty:0,checked:false,issue:""})),packageScans:[],status:"assigned",createdAt:new Date().toISOString()};
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

app.post("/api/orders/:id/package-scans", (req,res)=>{
  const o=ORDERS.get(String(req.params.id||"").toUpperCase());
  if(!o) return res.status(404).json({ok:false,error:"ماموریت پیدا نشد یا سرور از نو راه‌اندازی شده است."});
  const scans=Array.isArray(req.body?.scans)?req.body.scans:[];
  o.packageScans=scans.map(s=>({code:String(s.code||"").trim(),qty:Math.max(0,Number(s.qty)||0),label:String(s.label||"")})).filter(s=>s.code&&s.qty>0);
  const sums=new Map(); for(const s of o.packageScans)sums.set(s.code,(sums.get(s.code)||0)+s.qty);
  const results=o.items.map(it=>{const actual=sums.get(it.code)||0;return {code:it.code,name:it.name,expectedQty:it.expectedQty,scannedQty:actual,diff:actual-it.expectedQty,status:actual===it.expectedQty?"مطابق":actual<it.expectedQty?"کسری":"اضافی"};});
  const extras=[...sums.entries()].filter(([code])=>!o.items.some(it=>it.code===code)).map(([code,qty])=>({code,scannedQty:qty,status:"کالای خارج از فاکتور"}));
  o.finalCheck={results,extras,checkedAt:new Date().toISOString(),ok:results.every(x=>x.diff===0)&&extras.length===0};
  res.json({ok:true,order:o,finalCheck:o.finalCheck});
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, service: "techno-yadak-ocr", version: "36", port: PORT, ocrKeyConfigured: Boolean(OCR_API_KEY) });
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

async function requestOcrProvider(file, engine, isLabel, language) {
  const form = new FormData();
  // Engine 3 supports 200+ languages and mixed-script labels. Engine 2 is Latin/Chinese focused,
  // so it is used only as an optional English fallback, never for Persian labels.
  form.append("language", language || (isLabel ? "auto" : "per"));
  form.append("OCREngine", String(engine));
  form.append("isTable", isLabel ? "false" : "true");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("isOverlayRequired", isLabel ? "false" : "true");
  form.append("file", file.buffer, { filename:file.originalname || (isLabel ? "label.jpg" : "invoice.jpg"), contentType:file.mimetype || "image/jpeg" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let response, raw;
  try {
    response = await fetch(OCR_URL, { method:"POST", headers:{...form.getHeaders(), apikey:OCR_API_KEY}, body:form, signal:controller.signal });
    raw = await response.text();
  } finally { clearTimeout(timer); }
  let data;
  try { data = JSON.parse(raw); }
  catch (_) { return {response, raw, data:null, engine, parseError:true}; }
  const parsed = Array.isArray(data.ParsedResults) ? data.ParsedResults : [];
  const text = parsed.map(x => x.ParsedText || "").join("\n").trim();
  return {response, raw, data, parsed, text, engine, parseError:false};
}

function providerErrorText(data) {
  if (!data) return "";
  const flatten = v => Array.isArray(v) ? v.map(flatten).filter(Boolean).join("؛ ") : (v == null ? "" : String(v).trim());
  return [flatten(data.ErrorMessage), flatten(data.ErrorDetails)].filter(Boolean).join(" — ");
}

app.post("/api/ocr", upload.single("file"), async (req, res) => {
  const started = Date.now();
  try {
    console.log("[OCR] request received", { hasKey: Boolean(OCR_API_KEY), fileName: req.file?.originalname, mime: req.file?.mimetype, bytes: req.file?.size });
    if (!OCR_API_KEY) return res.status(500).json({ ok:false, error:"سرور OCR_API_KEY ندارد.", debugCode:"MISSING_API_KEY" });
    if (!req.file?.buffer?.length) return res.status(400).json({ ok:false, error:"فایل تصویر دریافت نشد.", debugCode:"NO_FILE" });
    if (req.file.size > 10 * 1024 * 1024) return res.status(413).json({ ok:false, error:"حجم فایل بیشتر از ۱۰ مگابایت است.", debugCode:"FILE_OVER_10MB", bytes:req.file.size });

    const requestMode = String(req.body?.mode || "");
    const isLabel = requestMode === "label" || requestMode === "label-latin";
    const isLatinFallback = requestMode === "label-latin";
    // Persian/mixed-language labels: Engine 3 with automatic language detection.
    // Optional second pass: Engine 2 in English mode for labels like "100 Stück/PCS".
    // Never choose Engine 2 with Persian as the declared language.
    const selectedEngine = isLatinFallback ? 2 : 3;
    const selectedLanguage = isLatinFallback ? "eng" : (isLabel ? "auto" : "per");
    const result = await requestOcrProvider(req.file, selectedEngine, isLabel, selectedLanguage);
    const fallbackUsed = isLatinFallback;

    console.log("[OCR] provider HTTP status", result.response.status, "engine", result.engine, "fallback", fallbackUsed);
    console.log("[OCR] provider raw response", String(result.raw || "").slice(0, 4000));
    if (result.parseError) {
      return res.status(502).json({ ok:false, error:"OCR.space پاسخ JSON معتبر برنگرداند.", debugCode:"PROVIDER_INVALID_JSON", providerStatus:result.response.status, providerRawPreview:String(result.raw || "").slice(0,1200) });
    }
    const data = result.data || {};
    const provider = {...safeProviderSummary(data), engineUsed:result.engine, fallbackUsed};
    if (!result.response.ok) return res.status(502).json({ ok:false, error:`OCR.space خطای HTTP ${result.response.status} برگرداند.${providerErrorText(data) ? " "+providerErrorText(data) : ""}`, debugCode:"PROVIDER_HTTP_ERROR", providerStatus:result.response.status, provider });
    if (data.IsErroredOnProcessing) return res.status(422).json({ ok:false, error:`OCR.space تصویر را پردازش نکرد.${providerErrorText(data) ? " "+providerErrorText(data) : ""}`, debugCode:"PROVIDER_PROCESSING_ERROR", providerStatus:result.response.status, provider });

    const parsed = result.parsed || [];
    const text = result.text || "";
    const overlayLines = parsed.flatMap((x, pageIndex) => {
      const lines = x?.TextOverlay?.Lines || [];
      return lines.map(line => ({
        page: pageIndex,
        text: line.LineText || "",
        words: (line.Words || []).map(w => ({ text:w.WordText || "", left:w.Left, top:w.Top, width:w.Width, height:w.Height }))
      }));
    });
    console.log("[OCR] success", { mode:isLabel ? "label" : "invoice", engine:result.engine, fallbackUsed, parsedResults:parsed.length, textLength:text.length, overlayLines:overlayLines.length, elapsedMs:Date.now()-started });
    return res.json({ ok:true, text, overlayLines, provider:{ocrExitCode:data.OCRExitCode, processingTimeInMilliseconds:data.ProcessingTimeInMilliseconds, parsedResults:parsed.length, engineUsed:result.engine, fallbackUsed} });
  } catch (err) {
    console.error("[OCR] request exception", err);
    return res.status(500).json({ ok:false, error:err?.message || String(err), debugCode:err?.name === "AbortError" ? "PROVIDER_TIMEOUT" : "SERVER_EXCEPTION", elapsedMs:Date.now()-started });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Techno OCR backend listening on 0.0.0.0:${PORT}`));
