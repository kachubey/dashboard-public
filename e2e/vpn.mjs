import { chromium } from "playwright";
const out = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto("http://localhost:3000/signin");
await page.getByRole("button", { name: /Alice Anderson/ }).click();
await page.waitForURL("http://localhost:3000/");
await page.goto("http://localhost:3000/vpn"); await page.waitForLoadState("networkidle");
console.log("sections:", (await page.locator("h2").allInnerTexts()).join(" | "));
await page.screenshot({ path: `${out}/v1-vpn.png`, fullPage: true, caret: "initial" });

const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download" }).first().click()]);
console.log("download filename:", dl.suggestedFilename());

const card = page.locator("[data-slot=card]", { hasText: "nl-1" });
await card.getByRole("button", { name: "Show link" }).click();
await card.locator("code").waitFor();
console.log("revealed starts with:", (await card.locator("code").innerText()).slice(0, 20));
console.log("qr visible:", await card.locator("img[alt=QR]").isVisible());
await card.getByRole("button", { name: "Copy" }).click();
console.log("clipboard ok:", (await page.evaluate(() => navigator.clipboard.readText())).startsWith("vless://"));
await page.screenshot({ path: `${out}/v2-vless-revealed.png`, fullPage: true, caret: "initial" });

await page.getByRole("button", { name: /WireGuard/ }).click();
await page.waitForTimeout(300);
console.log("legacy expanded shows office-a:", await page.getByText("office-a").isVisible());
await page.getByRole("button", { name: "How to connect" }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/v3-expanded.png`, fullPage: true, caret: "initial" });

const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState(), locale: "ru-RU" });
const mp = await m.newPage();
mp.on("pageerror", (e) => problems.push(`[mobile] ${e.message}`));
await mp.goto("http://localhost:3000/vpn"); await mp.waitForLoadState("networkidle");
console.log("mobile overflow:", await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await mp.screenshot({ path: `${out}/v4-mobile.png`, fullPage: true, caret: "initial" });
console.log("console problems:", problems.length ? "\n  " + problems.join("\n  ") : "none");
await browser.close();
