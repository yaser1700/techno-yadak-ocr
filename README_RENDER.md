# راه‌اندازی روی Render

1. این پروژه را داخل یک Repository در GitHub قرار بده.
2. در Render گزینه New + → Blueprint را بزن.
3. Repository گیت‌هاب را انتخاب کن.
4. Render فایل `render.yaml` را تشخیص می‌دهد.
5. بعد از ساخته شدن سرویس، در Environment Variables مقدار زیر را وارد کن:
   `OCR_API_KEY`
6. مقدار آن را API Key واقعی OCR.space قرار بده.
7. Deploy را انجام بده.
8. آدرس HTTPS سرویس را باز کن؛ صفحه کنترل OCR نمایش داده می‌شود.

نکته امنیتی:
API Key داخل HTML نیست و فقط به صورت Environment Variable روی سرور قرار می‌گیرد.
