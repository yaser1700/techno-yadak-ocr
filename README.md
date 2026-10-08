# Techno Yadak OCR Backend - Debug v2

این نسخه برای پیدا کردن علت خطای OCR provider request failed ساخته شده است.

تغییرات مهم:
- API key در هدر `apikey` به OCR.space ارسال می‌شود.
- پاسخ و خطای واقعی OCR.space در Render Logs ثبت می‌شود.
- خطاهای HTTP، خطای پردازش، timeout و API key ناموجود کد تشخیصی دارند.
- عکس در صفحه تست قبل از ارسال به حدود زیر 1MB فشرده می‌شود؛ OCR.space در پلن Free محدودیت 1MB برای فایل دارد.
- API key هرگز در صفحه مرورگر نمایش داده نمی‌شود.

Environment Variable در Render:
`OCR_API_KEY`
