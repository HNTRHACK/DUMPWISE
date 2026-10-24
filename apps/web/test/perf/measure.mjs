// Lab performance measurement (NOT Lighthouse). Uses Chromium's PerformanceObserver APIs on
// the production build against the mock API. Numbers depend on this machine; compare runs,
// don't quote them as field data.
//
// Prerequisites: npm run build; then in two terminals:
//   node test/e2e/mock-api.mjs
//   $env:DUMPWISE_API_URL="http://127.0.0.1:3101"; npx next start -p 3100
// Run: node test/perf/measure.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.PERF_BASE ?? "http://localhost:3100";

async function measure(context, url, { cdpThrottle } = {}) {
  const page = await context.newPage();
  if (cdpThrottle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    // ~"Fast 3G / slow 4G": 150 ms RTT, 1.6 Mbps down
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
  }
  await page.addInitScript(() => {
    window.__perf = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const res = performance.getEntriesByType("resource");
    const js = res.filter((e) => e.name.endsWith(".js") || e.initiatorType === "script");
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      lcpMs: Math.round(window.__perf.lcp),
      cls: Number(window.__perf.cls.toFixed(3)),
      // Executed by this page (script tags + dynamic imports) vs. prefetched for other routes.
      pageJsKB: Math.round(js.filter((e) => e.initiatorType === "script").reduce((s, e) => s + (e.transferSize || 0), 0) / 1024),
      otherJsKB: Math.round(js.filter((e) => e.initiatorType !== "script").reduce((s, e) => s + (e.transferSize || 0), 0) / 1024),
      totalKB: Math.round((res.reduce((s, e) => s + (e.transferSize || 0), 0) + (nav?.transferSize || 0)) / 1024),
      tier: document.querySelector("[data-render-tier]")?.getAttribute("data-render-tier") ?? "-",
      canvas: document.querySelectorAll("canvas").length,
    };
  });
  await page.close();
  return r;
}

const browser = await chromium.launch();
const rows = [];
// A fresh context per measurement = cold cache, so transfer sizes are real.
for (const url of ["/", "/?tier=static", "/product", "/login"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  rows.push({ profile: "desktop", url, ...(await measure(ctx, url)) });
  await ctx.close();
}
for (const url of ["/", "/?tier=static", "/login"]) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  rows.push({ profile: "mobile 4xCPU+slow net", url, ...(await measure(ctx, url, { cdpThrottle: true })) });
  await ctx.close();
}
await browser.close();
console.table(rows);
