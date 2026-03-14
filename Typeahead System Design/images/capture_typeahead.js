const puppeteer = require('puppeteer');
const path = require('path');

const HTML_FILE = path.resolve(__dirname, 'typeahead_master.html');
const OUTPUT = path.resolve(__dirname, 'typeahead_diagram.png');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // 1700px wide (matches our HTML design width), 2x device scale for crisp output
    await page.setViewport({ width: 1700, height: 1080, deviceScaleFactor: 2 });

    const fileUrl = `file:///${HTML_FILE.replace(/\\/g, '/')}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });

    // Let fonts and animations settle
    await new Promise(r => setTimeout(r, 2000));

    // Measure actual page height
    const bodyH = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: 1700, height: bodyH, deviceScaleFactor: 2 });
    await new Promise(r => setTimeout(r, 500));

    await page.screenshot({ path: OUTPUT, type: 'png', fullPage: true });
    await browser.close();
    console.log(`✅ Saved: ${OUTPUT}`);
})();
