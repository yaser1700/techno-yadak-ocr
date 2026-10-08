# سرور OCR تکنو یدک

این نسخه مشکل ارتباط مستقیم `content://` و CORS را با قرار دادن OCR در سمت سرور حل می‌کند.

## اجرا
1. Node.js نصب باشد.
2. در پوشه پروژه:
   npm install
3. کلید OCR.space را در متغیر محیطی قرار بده:
   - Windows PowerShell: `$env:OCR_API_KEY="کلید"`
   - Linux/macOS: `export OCR_API_KEY="کلید"`
4. اجرا:
   npm start
5. مرورگر:
   http://localhost:3000

## استقرار روی Render / Railway
- پروژه را به GitHub بفرست.
- Build/Install: `npm install`
- Start: `npm start`
- Environment Variable:
  `OCR_API_KEY = کلید OCR.space`

بعد از استقرار، برنامه موبایل باید از آدرس HTTPS سرور استفاده کند؛ دیگر API Key داخل فایل HTML نیست.

طبق مستندات OCR.space، POST endpoint رسمی `https://api.ocr.space/parse/image` است و API key باید در header ارسال شود.
