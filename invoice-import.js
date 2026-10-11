'use strict';

const normalize = value => String(value ?? '')
  .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ـ/g, '')
  .replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();
const norm = value => normalize(value).toLowerCase();
const compact = value => normalize(value).replace(/[\s,،]/g, '');
const isNumber = value => /^\d+(?:\.\d+)?$/.test(compact(value));
const parseNumber = value => {
  const s = compact(value).replace(/[^\d.\-]/g, '');
  if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return NaN;
  return Number(s);
};
const tidyCustomer = value => normalize(value)
  .replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ')')
  .replace(/\s{2,}/g, ' ').trim();

function getCellDate(row) {
  for (const value of row || []) {
    const v = normalize(value);
    const m = v.match(/\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/);
    if (m) return m[1].replace(/-/g, '/');
  }
  return '';
}

function getInvoiceNumber(rows) {
  for (let ri = 0; ri < Math.min(rows.length, 50); ri++) {
    const row = rows[ri] || [];
    const rowText = row.map(normalize).join(' ');
    // Exclude economic number/card/bank rows; invoice number in this template is
    // placed in a cell before the "شماره :" label, not after it.
    if (!/(?:^|\s)شماره\s*[:：]?\s*(?:$|\s)/.test(rowText) && !/شماره\s*فاکتور|شماره\s*سند/.test(rowText)) continue;
    if (/شماره\s*(?:اقتصادی|کارت|شبا|حساب|تماس|پستی)/.test(rowText)) continue;
    const numbers = row.map(v => normalize(v)).filter(v => /^\d{3,12}$/.test(v));
    if (numbers.length) return numbers[0];
  }
  // Some invoice exports put the label before the value in a single cell.
  for (const row of rows.slice(0, 50)) {
    const text = (row || []).map(normalize).join(' ');
    const m = text.match(/(?:شماره\s*فاکتور|شماره\s*سند|شماره\s*[:：])\s*[:：]?\s*(\d{3,12})/);
    if (m && !/اقتصادی|کارت|شبا|پستی/.test(text)) return m[1];
  }
  return '';
}

function getCustomerName(rows) {
  const isBuyerLabel = value => /نام\s*(?:خریدار|مشتری)|مشخصات\s*(?:خریدار|مشتری)|نام\s*خری\s*دار/.test(norm(value));
  const isSellerOrAddress = value => /(تکنو\s*یدک|گروه\s*تولیدی|فروشنده|خیابان|بلوار|نشانی|کد\s*پستی|شماره\s*اقتصادی|تلفن|همراه|نمابر|وب\s*سایت|www|http)/.test(norm(value));
  const isPerson = value => {
    const v = normalize(value);
    if (!v || isSellerOrAddress(v)) return false;
    if (/^(?:جناب\s*آقای|سرکار\s*خانم|آقای|خانم)\s*\S+/.test(v)) return true;
    return false;
  };
  for (let ri = 0; ri < Math.min(rows.length, 60); ri++) {
    const row = rows[ri] || [];
    if (!row.some(isBuyerLabel)) continue;
    // Search the entire buyer row because merged cells frequently put the buyer
    // name several columns away from the label.
    const candidates = row.map(normalize).filter(isPerson);
    if (candidates.length) return tidyCustomer(candidates[0]);
    // If the buyer label is its own cell, search the nearest nearby row cells.
    const labelIndex = row.findIndex(isBuyerLabel);
    for (let distance = 1; distance <= 2; distance++) {
      for (const idx of [labelIndex - distance, labelIndex + distance]) {
        if (idx >= 0 && idx < row.length && isPerson(row[idx])) return tidyCustomer(row[idx]);
      }
    }
  }
  // Fall back only to a clear honorific; never treat supplier text as the customer.
  for (const row of rows.slice(0, 60)) {
    const candidate = (row || []).map(normalize).find(isPerson);
    if (candidate) return tidyCustomer(candidate);
  }
  return '';
}

function parseInvoiceWorkbook(book, XLSX) {
  if (!book?.SheetNames?.length) throw new Error('هیچ برگه‌ای در فایل اکسل پیدا نشد.');
  let selected = null;
  const codeHead = v => /کد/.test(norm(v)) && /(کالا|محصول|خدمات|شناسه)/.test(norm(v));
  const nameHead = v => /(شرح|نام).*(کالا|محصول|خدمات)|^(کالا|شرح|توضیحات|نام محصول)$/.test(norm(v));
  const qtyHead = v => /^(?:مقدار(?:\s*کل)?|تعداد(?:\s*کل)?|qty|quantity)$/.test(norm(v));

  // Score candidate header rows so merged/split header cells can be handled.
  for (const sheetName of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {header:1, defval:'', raw:false});
    for (let ri = 0; ri < Math.min(rows.length, 120); ri++) {
      const cells = (rows[ri] || []).map(normalize);
      let codeCol = -1, nameCol = -1, qtyCol = -1;
      cells.forEach((v, i) => {
        if (codeHead(v)) codeCol = i;
        if (nameHead(v)) nameCol = i;
        if (qtyHead(v)) qtyCol = i;
      });
      // Allow code header split vertically, e.g. "کد کالا یا" / "خدمات".
      if (codeCol < 0) codeCol = cells.findIndex(v => /کد/.test(norm(v)) && /کالا/.test(norm(v)));
      if (codeCol >= 0 && nameCol >= 0 && qtyCol >= 0) {
        const score = 3 + (cells.some(v => /ردیف/.test(norm(v)) ) ? 1 : 0);
        if (!selected || score > selected.score) selected = {rows, headerRow:ri, codeCol, nameCol, qtyCol, sheetName, score};
      }
    }
  }
  if (!selected) {
    throw new Error('ستون‌های کد کالا، شرح کالا و مقدار در فایل پیدا نشد. فایل باید جدول اقلام با این ستون‌ها را داشته باشد.');
  }
  const rowsBySheet = book.SheetNames.map(name => XLSX.utils.sheet_to_json(book.Sheets[name], {header:1, defval:'', raw:false}));
  const metadataRows = rowsBySheet.flat();
  const invoiceNo = getInvoiceNumber(metadataRows);
  let invoiceDate = '';
  for (const row of metadataRows.slice(0, 60)) {
    if ((row || []).some(v => /تاریخ/.test(norm(v)))) {
      invoiceDate = getCellDate(row);
      if (invoiceDate) break;
    }
  }
  const customerName = getCustomerName(metadataRows);
  const items = [];
  for (const row of selected.rows.slice(selected.headerRow + 1)) {
    const code = compact(row[selected.codeCol]).replace(/\.0$/, '');
    const name = normalize(row[selected.nameCol]);
    const qty = parseNumber(row[selected.qtyCol]);
    if (!/^\d{1,20}$/.test(code) || !Number.isFinite(qty) || qty <= 0) continue;
    if (/^(جمع|مجموع|تعداد|مقدار|کد)$/.test(norm(name))) continue;
    items.push({code, name, qty});
  }
  if (!items.length) throw new Error('سرستون‌ها پیدا شدند، اما ردیف کالای معتبر استخراج نشد.');
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  // Cross-check explicit total-quantity footer when available.
  let declaredTotal = null;
  for (const row of selected.rows.slice(selected.headerRow + 1)) {
    const text = (row || []).map(normalize).join(' ');
    if (/مقدار\s*کل|جمع\s*تعداد|تعداد\s*کل/.test(norm(text))) {
      // Prefer the summary value under the same quantity column; other cells on
      // the footer contain monetary totals, which must never be read as quantity.
      const quantityCell = parseNumber((row || [])[selected.qtyCol]);
      if (Number.isFinite(quantityCell) && quantityCell > 0) {
        declaredTotal = quantityCell;
        break;
      }
    }
  }
  return {
    ok:true, invoiceNo, invoiceDate, customerName,
    sheet:selected.sheetName, items, totalQty, declaredTotal,
    totalMatchesDeclared:declaredTotal === null ? null : declaredTotal === totalQty,
    source:'excel'
  };
}

module.exports = { parseInvoiceWorkbook, normalize };
