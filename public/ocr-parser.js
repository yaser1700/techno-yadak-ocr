(function (root) {
  'use strict';
  const norm = value => String(value ?? '')
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ـ/g, '')
    .replace(/[‐‑–—]/g, '-').replace(/[：]/g, ':')
    .replace(/[\u200c\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
  const digitsOnly = value => norm(value).replace(/[^0-9]/g, '');
  const compact = value => norm(value).replace(/[\s,،]/g, '');

  function extractInvoiceNumber(text) {
    const lines = String(text || '').replace(/\r/g, '\n').split(/\n+/).map(norm).filter(Boolean);
    const forbidden = /شماره\s*(?:اقتصادی|کارت|شبا|حساب|تماس|تلفن|پستی|موبایل|همراه)|کد\s*پستی|تلفن|موبایل|همراه|شماره\s*کارت|شماره\s*شبا|شماره\s*حساب/i;
    const valid = value => {
      const s = digitsOnly(value);
      if (!/^\d{3,7}$/.test(s)) return '';
      if (/^(?:140[0-9]|13[0-9]{2})0[1-9]/.test(s)) return '';
      return s;
    };
    // Most reliable: invoice label and value on one OCR line, in either visual order.
    for (const line of lines) {
      if (!/شماره/.test(line) || forbidden.test(line)) continue;
      let m = line.match(/شماره\s*(?:(?:فاکتور|سند)\s*)?[:#\-]?\s*([۰-۹٠-٩0-9]{3,7})/i);
      if (m) { const n = valid(m[1]); if (n) return n; }
      m = line.match(/([۰-۹٠-٩0-9]{3,7})\s*[:#\-]?\s*شماره\s*(?:(?:فاکتور|سند))?/i);
      if (m) { const n = valid(m[1]); if (n) return n; }
    }
    // OCR often separates the number and the label into adjacent lines/cells.
    for (let i = 0; i < lines.length; i++) {
      if (!/شماره/.test(lines[i]) || forbidden.test(lines[i])) continue;
      const candidates = [];
      for (const d of [1, -1, 2, -2]) {
        const j = i + d;
        if (j < 0 || j >= lines.length || forbidden.test(lines[j])) continue;
        const s = lines[j];
        if (/تاریخ|مبلغ|تلفن|همراه|کد|آدرس|نشانی|خریدار|فروشنده/i.test(s)) continue;
        const m = s.match(/^\s*([۰-۹٠-٩0-9]{3,7})\s*$/);
        if (m) candidates.push({distance: Math.abs(d), value: valid(m[1])});
        // OCR can join another little word to the bare number.
        const m2 = s.match(/(?:^|\s)([۰-۹٠-٩0-9]{3,7})(?:\s|$)/);
        if (m2) candidates.push({distance: Math.abs(d) + 0.25, value: valid(m2[1])});
      }
      candidates.sort((a,b) => a.distance - b.distance);
      if (candidates.find(x => x.value)) return candidates.find(x => x.value).value;
    }
    return '';
  }

  function cleanCustomer(value) {
    let s = norm(value).replace(/[|¦]/g, ' ');
    s = s.replace(/(?:نام\s*(?:خری\s*دار|مشتری)|مشخصات\s*(?:خریدار|مشتری)|شماره\s*اقتصادی|کد\s*پستی|نشانی|آدرس|تلفن|همراه|نمابر|فروشنده|خریدار|مشتری|فاکتور|صورتحساب|وب\s*سایت|www|https?:).*/i, '').trim();
    return s.replace(/\s*\(\s*/g, ' (').replace(/\s*\)/g, ')').replace(/^[：:؛,،.\-_=]+|[：:؛,،.\-_=]+$/g, '').replace(/\s+/g, ' ').trim();
  }
  function extractCustomerNameFromOCR(text) {
    const lines = String(text || '').replace(/\r/g, '\n').split(/\n+/).map(norm).filter(Boolean);
    const buyerLabel = /نام\s*(?:خری\s*دار|مشتری)|مشخصات\s*(?:خریدار|مشتری)|خریدار\s*:/i;
    const bad = /تکنو\s*یدک|گروه\s*تولیدی|فروشنده|خیابان|بلوار|نشانی|آدرس|کد\s*پستی|شماره\s*اقتصادی|تلفن|همراه|نمابر|وب\s*سایت|www|https?:|صورتحساب/i;
    const honorific = /(?:جناب\s*(?:آقای|اقای|آقاى|آقاي|آقا)|سرکار\s*(?:خانم|خاتون)|آقای|اقای|آقاى|آقاي|خانم)/i;
    const good = value => {
      const s = cleanCustomer(value);
      if (!s || s.length < 3 || s.length > 70 || bad.test(s) || !/[آ-یA-Za-z]{2,}/.test(s)) return '';
      const nd = (s.match(/[0-9۰-۹٠-٩]/g) || []).length;
      if (nd > Math.max(2, Math.ceil(s.length * 0.15))) return '';
      if (/^(شماره|کد|تلفن|نشانی|آدرس|فروشنده|خریدار|مشتری|تاریخ|مبلغ)/i.test(s)) return '';
      return s;
    };
    // Prioritize lines close to the buyer label instead of taking the first honorific anywhere.
    const anchors = [];
    lines.forEach((line, i) => { if (buyerLabel.test(line)) anchors.push(i); });
    for (const ai of anchors) {
      for (const i of [ai, ai - 1, ai + 1, ai - 2, ai + 2, ai - 3, ai + 3]) {
        if (i < 0 || i >= lines.length || bad.test(lines[i])) continue;
        const m = lines[i].match(honorific);
        if (!m) continue;
        const candidate = good(lines[i]);
        if (candidate && candidate.split(/\s+/).length <= 8) return candidate;
      }
    }
    // Label and person can be on one OCR line in reverse order.
    for (const line of lines) {
      const m = line.match(/(?:نام\s*(?:خری\s*دار|مشتری)|مشخصات\s*(?:خریدار|مشتری))\s*[:：\-]?\s*(.+)/i);
      if (m) { const c = good(m[1]); if (c && c.split(/\s+/).length <= 8) return c; }
    }
    // Last fallback: only accept a clear honorific, and reject supplier and contact lines.
    for (const line of lines) {
      if (!honorific.test(line) || bad.test(line)) continue;
      const c = good(line);
      if (c) return c;
    }
    return '';
  }

  function parsePackageQuantityFromOCR(text) {
    const s = norm(text).toLowerCase().replace(/[×✕]/g, 'x');
    // Quantity must be tied to a quantity/unit expression; do not mistake a product code such as TS193 for a count.
    const patterns = [
      /(?:تعداد\s*(?:(?:داخل|در)\s*بسته)?|تعداد\s*بسته|مقدار\s*بسته|qty(?:\s*(?:per|\/)?\s*pack)?|quantity(?:\s*(?:per|in)\s*pack)?|pack\s*(?:qty|size)|pcs?\s*(?:per|\/|in)\s*pack)\s*[:=#\-]?\s*(?:عدد\s*)?(\d{1,4})/i,
      /(?:بسته|کارتن)\s*(?:شامل|دارای|تعداد)?\s*[:=#\-]?\s*(\d{1,4})\s*(?:عدد|قطعه|pcs?|pieces?)?/i,
      /(?:^|[^\d])([0-9]{1,4})\s*(?:stück|stueck|stk|pcs?|pieces?|units?|unit|pc\.?)\b/i,
      /(?:^|[^\d])([0-9]{1,4})\s*(?:عدد|قطعه|عددی)(?=$|[^a-z])/i,
      /(?:^|[^\d])([0-9]{1,4})\s*(?:عدد|قطعه)\s*(?:در|داخل)\s*بسته/i,
      /(?:pack|carton|ctn)\s*[:=#\-]?\s*(\d{1,4})/i
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1 && n <= 9999) return n;
    }
    return null;
  }

  function parseQuantityCell(cell) {
    const s = norm(cell).replace(/[,،]/g, '').trim();
    const m = s.match(/^([0-9]{1,4})(?:\s*(?:عدد|قطعه|pcs?|pieces?|units?|unit|pc\.?))?$/i);
    if (!m) return null;
    const n = Number(m[1]); return n >= 1 && n <= 9999 ? n : null;
  }
  function productMap(products) { return new Map((products || []).map(p => [String(p.code).replace(/\s/g,''), p])); }
  function codeFromCell(value, bank) {
    const s = norm(value);
    const candidates = [...s.matchAll(/(?:^|[^0-9])([0-9]{2,20})(?=$|[^0-9])/g)].map(m => m[1]);
    const exact = candidates.filter(c => bank.has(c));
    // A code column should resolve to one code; ambiguity is not guessed.
    return exact.length === 1 ? exact[0] : (bank.has(s.replace(/\s/g,'')) ? s.replace(/\s/g,'') : '');
  }
  function parseMarkdownTables(text, bank) {
    const lines = String(text || '').split(/\r?\n/);
    const found = new Map();
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('|')) continue;
      const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(norm);
      if (cells.length < 3) continue;
      const qtyCol = cells.findIndex(c => /^(مقدار|تعداد|qty|quantity)(?:\s*\([^)]*\))?$/.test(c.toLowerCase()));
      const codeCol = cells.findIndex(c => /کد/.test(c) && /(کالا|محصول|خدمات|شناسه)?/.test(c));
      const nameCol = cells.findIndex(c => /شرح|نام\s*کالا|نام\s*محصول/.test(c));
      if (qtyCol < 0 || codeCol < 0) continue;
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].includes('|')) break;
        const row = lines[j].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(norm);
        if (row.every(c => /^:?-{2,}:?$/.test(c))) continue;
        if (row.length !== cells.length) continue;
        const code = codeFromCell(row[codeCol] || '', bank);
        const qty = parseQuantityCell(row[qtyCol] || '');
        if (code && qty != null && !found.has(code)) {
          found.set(code, {code, name:bank.get(code)?.name || row[nameCol] || '', qty, confidence:'high', source:'ردیف جدول Markdown و ستون مقدار'});
        }
      }
    }
    return [...found.values()];
  }
  function detectTextRows(text, bank) {
    const lines = String(text || '').split(/\r?\n/).map((raw, i) => ({raw, s:norm(raw), lineIndex:i})).filter(x => x.s);
    const map = new Map();
    const add = (rawCode, line) => {
      const code = digitsOnly(rawCode);
      if (!bank.has(code) || map.has(code)) return;
      if (/(شماره\s*(?:اقتصادی|کارت|شبا|حساب|تماس|تلفن|پستی)|کد\s*پستی)/i.test(line.s)) return;
      map.set(code, {code, name:bank.get(code)?.name || '', lineIndex:line.lineIndex, y:null});
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], s = l.s;
      if (/شماره\s*(?:اقتصادی|کارت|شبا|حساب|تماس|تلفن|پستی)|کد\s*پستی/i.test(s)) continue;
      let ms = [...s.matchAll(/کد\s*(?:کالا|محصول|خدمات)?\s*[:#\-]?\s*([0-9]{2,20})/g)];
      if (ms.length) { ms.forEach(m => add(m[1], l)); continue; }
      ms = [...s.matchAll(/([0-9]{2,20})\s+کد(?:\s|$)/g)];
      if (ms.length) { ms.forEach(m => add(m[1], l)); continue; }
      const leading = s.match(/^([0-9]{2,20})(?=\s|$)/);
      if (leading) { add(leading[1], l); continue; }
      if (/^\d{2,20}$/.test(s) && bank.has(s)) {
        const next = lines[i+1];
        // Standalone codes are allowed only if they occur in an item table area.
        if (next && !/(شماره|تاریخ|تلفن|توضیحات|جمع کل|مبلغ|بهای واحد)/.test(next.s)) add(s, l);
      }
    }
    return lines.length ? [...map.values()].sort((a,b)=>a.lineIndex-b.lineIndex) : [];
  }
  function readInvoiceTotalQuantity(text) {
    const lines = String(text || '').split(/\r?\n/).map(norm);
    // Read a total only when it is explicitly paired with the summary label on the same line.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!/مقدار\s*کل|جمع\s*کل\s*فاکتور|تعداد\s*کل/.test(line)) continue;
      let m = line.match(/(?:مقدار\s*کل|جمع\s*کل\s*فاکتور|تعداد\s*کل)\s*[:：=]?\s*([0-9]{1,4})/);
      if (!m) m = line.match(/([0-9]{1,4})\s*(?:مقدار\s*کل|جمع\s*کل\s*فاکتور|تعداد\s*کل)/);
      if (m) { const n=Number(m[1]); if (n>0 && n<=9999) return n; }
    }
    return null;
  }
  function parseQuantityColumnBlock(text, count) {
    const lines = String(text || '').split(/\r?\n/).map(norm);
    const headings = [];
    for (let i=0;i<lines.length;i++) {
      const s=lines[i].toLowerCase();
      // Exclude footer total labels; we want the table's quantity column heading.
      if (/^(?:مقدار|تعداد|qty|quantity)\s*[:：]?$/.test(s)) headings.push(i);
    }
    const stop = /^(?:واحد(?:\s*اندازه\s*گیری)?|بهای\s*واحد|مبلغ\s*کل|تخفیف|شرح\s*کالا(?:\s*یا\s*خدمات)?|کد\s*کالا(?:\s*یا\s*خدمات)?|ردیف|جمع\s*کل\s*فاکتور|مقدار\s*کل|توضیحات)$/i;
    let best = [];
    for (const h of headings) {
      const vals=[];
      for (let i=h+1;i<lines.length && vals.length<count;i++) {
        const s=lines[i];
        if (!s) continue;
        if (stop.test(s)) break;
        if (/\d[\d,،]{4,}/.test(s)) break; // formatted money amounts are not quantities
        const m=s.match(/^([0-9]{1,4})(?:\s*(?:عدد|pcs?|pieces?|unit|واحد))?$/i);
        if (m) { const n=Number(m[1]); if (n>0&&n<=9999) vals.push(n); continue; }
        // Some OCRs put a whole vertical quantity block on one line: "5 10 10 4 5".
        if (/^[0-9\s]+$/.test(s)) {
          const tokens=s.trim().split(/\s+/).filter(Boolean).map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=9999);
          vals.push(...tokens.slice(0,count-vals.length));
          continue;
        }
        // Unit names are often interleaved; skip simple unit words but stop on another header.
        if (/^(?:عدد|دست|بسته|کارتن|مقدار|تعداد)$/i.test(s)) continue;
        if (/^(?:بهای|مبلغ|شرح|کد\s*کالا|واحد\s*اندازه|تخفیف|ردیف)/i.test(s)) break;
      }
      if (vals.length > best.length) best=vals;
      if (vals.length===count) return vals;
    }
    return best.length===count ? best : [];
  }
  function parsePrePriceQuantityRun(text, count, total) {
    const lines=String(text||'').split(/\r?\n/).map(norm);
    const firstPrice=lines.findIndex(x=>/\d{1,3}(?:[,،]\d{3})+/.test(x));
    if(firstPrice<0)return [];
    const nums=[];
    for(let i=0;i<firstPrice;i++) {
      const s=lines[i];
      if(/^\d{1,3}$/.test(s)) { const n=Number(s); if(n>0&&n<=999)nums.push(n); }
    }
    if(nums.length<count)return [];
    const vals=nums.slice(-count);
    if(total!==null && vals.reduce((a,b)=>a+b,0)!==total)return [];
    return vals;
  }
  function quantitiesByOverlay(rows, overlayLines) {
    if (!Array.isArray(overlayLines) || !overlayLines.length || !rows.length) return new Map();
    const words=[];
    for(let li=0;li<overlayLines.length;li++) {
      const line=overlayLines[li];
      for(const w of line.words||[]) {
        const text=norm(w.text || '');
        const num=digitsOnly(text);
        words.push({text,num,x:Number(w.left)||0,cx:(Number(w.left)||0)+(Number(w.width)||0)/2,y:(Number(w.top)||0)+(Number(w.height)||12)/2,h:Number(w.height)||12,li});
      }
    }
    const right=Math.max(1,...words.map(w=>w.cx));
    const maxY=Math.max(1,...words.map(w=>w.y));
    const qHeadings=words.filter(w=>/(?:مقدار|تعداد|qty|quantity)/i.test(w.text) && !/کل/.test(w.text));
    const codeLocs=[];
    for(const row of rows) {
      const candidates=words.filter(w=>w.num===row.code && w.cx/right>.60);
      if(candidates.length) {
        const chosen=candidates.sort((a,b)=>a.y-b.y)[0];
        codeLocs.push({...row, y:chosen.y, rowH:chosen.h, codeCx:chosen.cx});
      }
    }
    const result=new Map();
    if (!codeLocs.length) return result;
    let qtyX=null;
    if(qHeadings.length) {
      const topY=Math.min(...codeLocs.map(x=>x.y));
      const viable=qHeadings.filter(h=>h.y<topY && topY-h.y<maxY*.55);
      if(viable.length) qtyX=viable.sort((a,b)=>Math.abs(b.y-topY)-Math.abs(a.y-topY))[0].cx;
    }
    for(const row of codeLocs) {
      const vals=words.filter(w=>/^\d{1,4}$/.test(w.num) && Number(w.num)>0 && Number(w.num)<=9999 && w.num!==row.code && Math.abs(w.y-row.y)<=Math.max(18,row.rowH*1.8,maxY*.012));
      let sorted=[];
      if(qtyX!==null) sorted=vals.map(w=>({...w,score:Math.abs(w.cx-qtyX)})).sort((a,b)=>a.score-b.score);
      else sorted=vals.filter(w=>w.cx/right>.34 && w.cx/right<.70).map(w=>({...w,score:Math.abs(w.cx/right-.50)})).sort((a,b)=>a.score-b.score);
      if(sorted.length) {
        // If two numbers are equally close to the quantity column, don't guess.
        if(sorted.length>1 && Math.abs(sorted[0].score-sorted[1].score)<2 && sorted[0].num!==sorted[1].num) continue;
        result.set(row.code,Number(sorted[0].num));
      }
    }
    return result;
  }
  function extractItemsFromText(text, products, overlayLines) {
    const bank=productMap(products), total=readInvoiceTotalQuantity(text);
    const tableRows=parseMarkdownTables(text,bank);
    if(tableRows.length) {
      const allWithQty=tableRows.every(x=>x.qty!=null);
      if(allWithQty) {
        const sum=tableRows.reduce((a,x)=>a+x.qty,0);const sumMatches=total===null||sum===total;
        return tableRows.map(x=>({...x,confidence:sumMatches?'high':'medium',source:sumMatches?x.source:`${x.source}؛ جمع ${sum} با مقدار کل ${total} برابر نیست، تأیید شود`}));
      }
    }
    const rows=detectTextRows(text,bank);
    if(!rows.length)return [];
    const tableMap=new Map(tableRows.map(x=>[x.code,x.qty]));
    const overlayMap=quantitiesByOverlay(rows,overlayLines);
    let quantities=rows.map(r=>tableMap.get(r.code)??overlayMap.get(r.code)??null);
    let source='ردیف جدول/موقعیت ستون مقدار';
    let confidence='high';
    if(quantities.every(q=>q!=null)) {
      const sum=quantities.reduce((a,x)=>a+x,0);
      if(total!==null&&sum!==total){confidence='medium';source+='؛ جمع با مقدار کل برابر نیست و باید تأیید شود';}
    } else {
      const block=parseQuantityColumnBlock(text,rows.length);
      const pre=block.length?block:parsePrePriceQuantityRun(text,rows.length,total);
      if(pre.length===rows.length) {
        quantities=pre;source=block.length?'ستون مقدار OCR':'بلوک تعداد پیش از قیمت';
        const sum=pre.reduce((a,x)=>a+x,0);
        confidence=total===null||sum===total?'medium':'low';
        if(total!==null&&sum!==total)source+='؛ جمع با مقدار کل یکی نیست، تأیید شود';
      } else {
        // Retain exact row-level quantities already identified, leave only unknowns blank.
        quantities=rows.map((r,i)=>tableMap.get(r.code)??overlayMap.get(r.code)??null);
        source='برای تعدادهای نامشخص از OCR مدرک کافی پیدا نشد؛ مقدار باید تأیید شود';
        confidence='low';
      }
    }
    return rows.map((r,i)=>({code:r.code,name:r.name,qty:quantities[i]??null,confidence:quantities[i]!=null?confidence:'low',source:quantities[i]!=null?source:'تعداد از متن/موقعیت قابل تأیید نبود؛ دستی وارد کن'}));
  }

  const api = { norm, extractInvoiceNumber, extractCustomerNameFromOCR, parsePackageQuantityFromOCR, extractItemsFromText, readInvoiceTotalQuantity };
  root.TechnoOcrParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
