# Fix: camera barcode scanning

This update adds an explicit **"اسکن بارکد با دوربین گوشی"** control to the final package-check section. It uses html5-qrcode 2.3.8 from unpkg CDN and requires HTTPS, a supported browser, camera permission, and access to the CDN. Manual code entry remains available as fallback.

Deploy by replacing `public/index.html` in the existing GitHub repository with the provided `public/index.html`, then commit and wait for Render deployment. No server-side files need to change.

Note: syntax checked locally with Node.js. Camera permission and scanning must still be verified on the actual phone after deployment.
