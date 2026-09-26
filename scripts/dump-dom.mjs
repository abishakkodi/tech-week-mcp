#!/usr/bin/env node
import fs from 'fs';
import { chromium } from 'playwright';

async function dump(city) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`https://www.tech-week.com/calendar/${city}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(4000);
  // accept cookies if shown
  try {
    const btn = page.locator('button:has-text("Accept"), button:has-text("Got it"), button:has-text("OK")').first();
    if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 });
  } catch {}
  // basic scroll
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
  }
  const html = await page.content();
  fs.writeFileSync(`/workspace/scripts/${city}-calendar.html`, html, 'utf8');
  await browser.close();
  console.log(`dumped ${city}`);
}

const city = process.argv[2] || 'sf';
dump(city).catch((e) => { console.error(e); process.exit(1); });

