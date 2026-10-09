import { chromium } from "playwright";
const out = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto("http://localhost:3000/"); await page.waitForLoadState("networkidle");
console.log("1 redirected to:", new URL(page.url()).pathname);
await page.screenshot({ path: `${out}/1-signin.png`, caret: "initial" });

await page.getByRole("button", { name: /Alice Anderson/ }).click();
await page.waitForURL("http://localhost:3000/"); await page.waitForLoadState("networkidle");
console.log("2 after mock sign-in:", await page.locator("h1").innerText());
const nav = await page.locator("aside nav").innerText();
console.log("  nav:", nav.replace(/\n/g, " | "));
await page.screenshot({ path: `${out}/2-home-user.png`, caret: "initial" });

await page.getByRole("button", { name: /Language/ }).click();
await page.getByRole("menuitem", { name: "Русский" }).click();
await page.waitForFunction(() => document.documentElement.lang === "ru");
console.log("3 after switch to ru:", await page.locator("h1").innerText());
await page.screenshot({ path: `${out}/3-home-ru.png`, caret: "initial" });

await page.getByRole("button", { name: /Вы вошли как/ }).click();
await page.getByRole("menuitem", { name: "Выйти" }).click();
await page.waitForURL("**/signin");
console.log("4 after sign-out:", new URL(page.url()).pathname, "| title:", await page.locator("[data-slot=card-title]").first().innerText());

await page.getByRole("button", { name: /No Role/ }).click();
await page.waitForURL("**/denied**");
console.log("5 no-role user ->", new URL(page.url()).pathname + new URL(page.url()).search, "|", await page.locator("[data-slot=card-title]").innerText());
await page.screenshot({ path: `${out}/5-denied.png`, caret: "initial" });

await page.goto("http://localhost:3000/signin");
await page.getByRole("button", { name: /Alex Admin/ }).click();
await page.waitForURL("http://localhost:3000/"); await page.waitForLoadState("networkidle");
console.log("6 admin nav:", (await page.locator("aside nav").innerText()).replace(/\n/g, " | "));

const mobile = await browser.newContext({ ...{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, storageState: await ctx.storageState() });
const m = await mobile.newPage();
m.on("pageerror", (e) => problems.push(`[mobile pageerror] ${e.message}`));
await m.goto("http://localhost:3000/");
await m.screenshot({ path: `${out}/7-mobile-home.png`, caret: "initial" });
await m.getByRole("button", { name: /Открыть меню|Open menu/ }).click();
await m.waitForTimeout(400);
await m.screenshot({ path: `${out}/8-mobile-menu.png`, caret: "initial" });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log("7 mobile horizontal overflow:", overflow);

console.log("console problems:", problems.length ? "\n  " + problems.join("\n  ") : "none");
await browser.close();
