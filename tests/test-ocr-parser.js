'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('../public/ocr-parser');

assert.equal(parser.extractInvoiceNumber('18033\nشماره :\n1405/07/18\nتاریخ :\nکد کالا یا خدمات'), '18033');
assert.equal(parser.extractInvoiceNumber('شماره فاکتور: 17927\nتاریخ: 1405/07/06\nکد کالا'), '17927');
assert.equal(parser.parsePackageQuantityFromOCR('تعداد داخل بسته: ۵ عدد'), 5);
assert.equal(parser.parsePackageQuantityFromOCR('5 PCS'), 5);
assert.equal(parser.parsePackageQuantityFromOCR('100 Stück/PCS'), 100);
assert.equal(parser.parsePackageQuantityFromOCR('Pack Qty: 20'), 20);
assert.equal(parser.parsePackageQuantityFromOCR('TS193'), null, 'product code must not be treated as package quantity');

const products = [{code:'11401', name:'نمونه کالا'}, {code:'18501', name:'نمونه کالای دوم'}];
const invoice = [
  '| کد کالا | شرح کالا | مقدار |',
  '| --- | --- | --- |',
  '| 11401 | نمونه کالا | ۵۰ |',
  '| 18501 | نمونه کالای دوم | ۲۰ |',
  'مقدار کل: 70'
].join('\n');
const rows = parser.extractItemsFromText(invoice, products);
assert.deepEqual(rows.map(x => [x.code, x.qty]), [['11401', 50], ['18501', 20]]);

const html = fs.readFileSync(require.resolve('../public/index.html'), 'utf8');
const nameFnStart = html.indexOf('function parsePackageNameFromOCR(text){');
const nameFnEnd = html.indexOf('function parsePackageQuantityFromOCR(text){', nameFnStart);
assert.ok(nameFnStart >= 0 && nameFnEnd > nameFnStart, 'label product-name parser should exist in the UI');
const nameFnSource = html.slice(nameFnStart, nameFnEnd);
const parsePackageNameFromOCR = vm.runInNewContext(nameFnSource + '\nparsePackageNameFromOCR', {});
assert.equal(parsePackageNameFromOCR('تکنو یدک پارت عباسی\nسوکت سوزن نیسان دیزل و مهره سمند\nتعداد در بسته ۵ عدد'), 'سوکت سوزن نیسان دیزل و مهره سمند');
assert.equal(parsePackageNameFromOCR('سوکت سوزن نیسان دیزل و مهره سمند تعداد در بسته ۵ عدد'), 'سوکت سوزن نیسان دیزل و مهره سمند');

console.log('PASS: invoice number, package quantity, false-positive code rejection, table quantities, and label product name parsing');
