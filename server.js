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
app.post("/api/import-invoice", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ok:false,error:"فایل اکسل انتخاب نشده است."});
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    if (![".xls", ".xlsx", ".xlsm"].includes(ext)) return res.status(400).json({ok:false,error:"فقط فایل اکسل XLS یا XLSX قابل قبول است."});
    const book = XLSX.read(req.file.buffer, {type:"buffer", cellDates:false});
    let found = null, invoiceNo = "", invoiceDate = "";
    const norm = v => String(v ?? "").replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/\u200c/g," ").replace(/\s+/g," ").trim().toLowerCase();
    const codeHeads = /^(کد کالا|کد محصول|کد|کد کالا یا خدمات|شناسه کالا|product code|item code)$|^کد کالا( یا)?$/;
    const nameHeads = /^(شرح کالا|نام کالا|شرح|شرح محصول|نام محصول|کالا|شرح کالا یا خدمات|توضیحات|description|item name|product)$|^شرح کالا( یا خدمات)?$/;
    const qtyHeads = /^(مقدار|تعداد|مقدار کل|تعداد کل|qty|quantity)$/;
    for (const sheetName of book.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {header:1, defval:"", raw:false});
      for (let ri=0; ri<Math.min(rows.length,80); ri++) {
        const cells=(rows[ri]||[]).map(norm);
        let ci=-1, ni=-1, qi=-1;
        cells.forEach((v,i)=>{if(codeHeads.test(v) || (/کد/.test(v) && /کالا/.test(v)))ci=i;if(nameHeads.test(v) || (/شرح/.test(v) && /کالا/.test(v)))ni=i;if(qtyHeads.test(v) || v.startsWith("مقدار"))qi=i;});
        if(ci>=0 && qi>=0 && (ni>=0 || cells.some(v=>/شرح|نام کالا/.test(v)))) { found={rows,headerRow:ri,codeCol:ci,nameCol:ni,qtyCol:qi,sheetName}; break; }
      }
      if(found) break;
    }
    // Also collect invoice metadata from label/value pairs.
    for(const sn of book.SheetNames){const rows=XLSX.utils.sheet_to_json(book.Sheets[sn],{header:1,defval:"",raw:false});for(const row of rows.slice(0,15)){const line=row.map(v=>String(v??"")).join(" ");const m=line.match(/(?:شماره\s*فاکتور|شماره\s*سند)\s*[:：]?\s*([0-9۰-۹]+)/);if(m)invoiceNo=m[1];const d=line.match(/(?:تاریخ\s*فاکتور|تاریخ)\s*[:：]?\s*([0-9۰-۹]{4}[\/\-][0-9۰-۹]{1,2}[\/\-][0-9۰-۹]{1,2})/);if(d)invoiceDate=d[1];}}
    if(!found) return res.status(422).json({ok:false,error:"سرستون‌های کد کالا، شرح کالا و مقدار در فایل پیدا نشد. لطفاً نمونه فایل را برای تنظیم قالب بفرست.",sheets:book.SheetNames});
    const items=[];
    for(const row of found.rows.slice(found.headerRow+1)){
      const code=norm(row[found.codeCol]).replace(/[,،\s]/g,"");
      const name=found.nameCol>=0?String(row[found.nameCol]??"").trim():"";
      const qraw=norm(row[found.qtyCol]).replace(/[,،]/g,"");
      const qty=Number(qraw.replace(/[^0-9.\-]/g,""));
      if(!code || !/^[0-9]+$/.test(code) || !Number.isFinite(qty) || qty<=0) continue;
      if(/^(جمع|مجموع|تعداد|مقدار|کد)$/.test(norm(name))) continue;
      items.push({code,name,qty});
    }
    if(!items.length) return res.status(422).json({ok:false,error:"سرستون پیدا شد، اما ردیف کالای معتبر استخراج نشد.",sheet:found.sheetName});
    res.json({ok:true,invoiceNo,invoiceDate,sheet:found.sheetName,items,totalQty:items.reduce((a,x)=>a+x.qty,0),source:"excel"});
  } catch(e) { console.error("Excel import failed",e); res.status(400).json({ok:false,error:"خواندن فایل اکسل ناموفق بود: "+e.message}); }
});


app.post("/api/orders", (req,res)=>{
  try {
    const {picker, customerName, items, invoiceNo, invoiceName} = req.body || {};
    if(!picker || !invoiceNo || !Array.isArray(items) || !items.length) return res.status(400).json({ok:false,error:"شماره فاکتور، نام جمع‌آور و اقلام فاکتور الزامی است."});
    const id=String(invoiceNo).trim();
    if(ORDERS.has(id)) return res.status(409).json({ok:false,error:"برای این شماره فاکتور قبلاً مأموریت ساخته شده است."});
    const order={id,picker,customerName:String(customerName||"").trim(),invoiceNo:id,invoiceName:invoiceName||"",items:items.map((x,i)=>({index:i,code:String(x.code||""),name:String(x.name||""),expectedQty:Number(x.qty)||0,actualQty:0,checked:false,issue:""})),status:"assigned",createdAt:new Date().toISOString()};
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
