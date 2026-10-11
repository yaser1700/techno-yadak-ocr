from playwright.sync_api import sync_playwright
from pathlib import Path
html = Path(__file__).resolve().parents[1] / 'public' / 'index.html'
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page=browser.new_page()
    page.add_init_script("Object.defineProperty(window, 'localStorage', {value: {getItem:()=>null, setItem:()=>{}, removeItem:()=>{}, clear:()=>{}}});")
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content(html.read_text(encoding='utf-8'), wait_until='load')
    results=page.evaluate('''() => ({
      invoicePrev: extractInvoiceNumber('18033\\nشماره :\\n1405/07/18\\nتاریخ :\\nکد کالا یا خدمات'),
      invoiceSame: extractInvoiceNumber('شماره فاکتور: 17927\\nتاریخ: 1405/07/06\\nکد کالا'),
      qtyPersian: parsePackageQuantityFromOCR('تعداد داخل بسته: ۵ عدد'),
      qtyPcs: parsePackageQuantityFromOCR('5 PCS'),
      qtyGerman: parsePackageQuantityFromOCR('100 Stück/PCS'),
      qtyOcrTypo: parsePackageQuantityFromOCR('100 STUCK/PCS'),
      qtyPack: parsePackageQuantityFromOCR('Pack Qty: 20')
    })''')
    browser.close()
assert results['invoicePrev']=='18033', results
assert results['invoiceSame']=='17927', results
assert results['qtyPersian']==5 and results['qtyPcs']==5 and results['qtyGerman']==100 and results['qtyOcrTypo']==100 and results['qtyPack']==20, results
assert not [e for e in errors if 'localStorage' not in e], errors
print('PASS browser function tests:', results)
print('PASS no application JavaScript errors (opaque-origin localStorage warning is a sandbox limitation)')
