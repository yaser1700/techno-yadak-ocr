'use strict';
const assert = require('node:assert/strict');
const { parseInvoiceWorkbook } = require('../invoice-import');
const row = () => Array(25).fill('');
const rows = Array.from({length:22}, row);
rows[1][3] = '17927'; rows[1][6] = 'شماره :';
rows[2][3] = '1405/07/06'; rows[2][6] = 'تاریخ :';
rows[7][10] = 'جناب آقای مشتری آزمایشی ( پرند )'; rows[7][23] = 'نام خریـدار :';
rows[10][1] = 'مبلغ کل'; rows[10][7] = 'بهای واحد'; rows[10][11] = 'واحد اندازه گیری'; rows[10][13] = 'مقدار'; rows[10][15] = 'شرح کالا یا خدمات'; rows[10][21] = 'کد کالا یا'; rows[10][24] = 'ردیف';
rows[11][21] = 'خدمات';
const items = [
  ['11401','سوکت دو فیش برق همه کاره (همه رنگ) درجه یک',50],
  ['18501','سوکت رله فن سیم 4 فابریک',50],
  ['25802','سوکت مقاومت فن 206 و پراید جدید سیم 4',20]
];
items.forEach((it,i)=>{const r=rows[12+i];r[13]=String(it[2]);r[15]=it[1];r[21]=it[0];r[24]=String(i+1)});
rows[15][13]='120'; rows[15][24]='مقدار کل :';
const XLSXMock={utils:{sheet_to_json(sheet){return sheet.rows;}}};
const book={SheetNames:['Sheet1'],Sheets:{Sheet1:{rows}}};
const got=parseInvoiceWorkbook(book,XLSXMock);
assert.equal(got.invoiceNo,'17927');
assert.equal(got.customerName,'جناب آقای مشتری آزمایشی (پرند)');
assert.deepEqual(got.items.map(x=>[x.code,x.qty]),[['11401',50],['18501',50],['25802',20]]);
assert.equal(got.totalQty,120); assert.equal(got.totalMatchesDeclared,true);
console.log('PASS: customer name found when buyer label and customer name are in distant columns');
console.log('PASS: invoice number, split code header, 3 item rows and quantity total 120');
