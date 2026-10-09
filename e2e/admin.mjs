import { chromium } from "playwright";
const [out, up] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ locale: "en-US", viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const problems = [];
p.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`[${m.type()}] ${m.text().slice(0, 200)}`); });
p.on("pageerror", (e) => problems.push(`[pageerror] ${e.message.slice(0, 200)}`));
let seen = 0;
const toast = async () => {
  // Wait for a toast we haven't read yet (sonner keeps a stack).
  await p.waitForFunction((n) => document.querySelectorAll("[data-sonner-toast]").length > n || window.__toasts > n, seen, { timeout: 15000 }).catch(() => {});
  const all = await p.locator("[data-sonner-toast]").allInnerTexts();
  seen = all.length;
  return (all[0] ?? "(none)").replace(/\n/g, " ");
};
const shot = (n) => p.screenshot({ path: `${out}/${n}.png`, fullPage: true, caret: "initial" });

await p.goto("http://localhost:3000/signin");
await p.getByRole("button", { name: /Alex Admin/ }).click();
await p.waitForURL("http://localhost:3000/");
await p.goto("http://localhost:3000/admin"); await p.waitForLoadState("networkidle");
console.log("overview:", (await p.locator("[data-slot=card]").allInnerTexts()).map((s) => s.split("\n").slice(0, 2).join("=")).join(" | "));
await shot("a1-overview");

// Import
await p.getByRole("link", { name: "Import", exact: true }).click();
await p.locator("input[type=file]").setInputFiles(["bob__pritunl__travel.ovpn", "alice__pritunl__main.ovpn", "smith__vless__bad.txt", "newbie__pritunl__main.ovpn"].map((f) => `${up}/${f}`));
await p.getByRole("button", { name: "Preview" }).click();
await p.locator("table").waitFor();
console.log("preview rows:", (await p.locator("tbody tr").allInnerTexts()).map((r) => r.replace(/\s+/g, " ")).join(" || "));
await shot("a2-import-preview");
await p.getByRole("button", { name: /^Import / }).click();
console.log("import toast:", await toast());

// Configs: pending filter, then detail of alice main
await p.goto("http://localhost:3000/admin/configs?status=pending"); await p.waitForLoadState("networkidle");
console.log("pending configs:", (await p.locator("tbody tr").allInnerTexts()).map((r) => r.split("\n")[0]).join(", "));
await p.goto("http://localhost:3000/admin/configs?q=alice&type=pritunl"); await p.waitForLoadState("networkidle");
await p.locator("tbody tr").first().getByRole("link").click();
await p.getByText("Versions").waitFor();
console.log("versions:", (await p.locator("tbody tr").allInnerTexts()).map((r) => r.split("\t")[0].replace(/\s+/g, " ")).join(", "));
const html = await p.content();
console.log("detail leaks content:", /remote main|main3\.example|BEGIN CERT|SAMPLE-KEY/.test(html));
await p.locator("tbody tr").last().getByRole("button", { name: "Make active" }).click();
await p.getByRole("alertdialog").getByRole("button", { name: "Make active" }).click();
console.log("rollback toast:", await toast());
await p.getByRole("button", { name: "Deactivate" }).click();
console.log("deactivate toast:", await toast());
await p.getByRole("button", { name: "Reactivate" }).click();
console.log("reactivate toast:", await toast());
await shot("a3-config-detail");

// Delete bob travel
await p.goto("http://localhost:3000/admin/configs?q=travel"); await p.waitForLoadState("networkidle");
await p.locator("tbody tr").first().getByRole("link").click();
await p.getByRole("button", { name: "Delete" }).click();
await p.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
console.log("delete toast:", await toast());

// Users: link newbie key, then a conflicting alias
await p.goto("http://localhost:3000/admin/users"); await p.waitForLoadState("networkidle");
const newbieRow = p.locator("#unlinked tbody tr", { hasText: "newbie" });
await newbieRow.locator("input[name=userUpn]").fill("smith@portal.test");
await newbieRow.getByRole("button", { name: "Link" }).click();
console.log("link toast:", await toast());
const smithRow = p.locator("tbody tr", { hasText: "smith@portal.test" }).last();
await smithRow.getByText("Add key").click();
await smithRow.locator("input[name=keyValue]").fill("alice");
await smithRow.getByRole("button", { name: "Save" }).click();
console.log("conflict toast:", await toast());
await shot("a4-users");

// Quarantine
await p.goto("http://localhost:3000/admin/quarantine"); await p.waitForLoadState("networkidle");
console.log("quarantine:", (await p.locator("tbody tr").allInnerTexts()).map((r) => r.split("\n")[0]).join(", "));
const backup = p.locator("tbody tr", { hasText: "alice-backup.ovpn" });
await backup.getByText("Accept as").click();
await backup.locator("input[name=ownerKey]").fill("alice");
await backup.locator("select[name=type]").selectOption("pritunl");
await backup.locator("input[name=label]").fill("backup");
await backup.getByRole("button", { name: "Accept" }).click();
console.log("accept toast:", await toast());
const bad = p.locator("tbody tr", { hasText: "smith__vless__bad.txt" });
await bad.getByText("Accept as").click();
await bad.locator("input[name=label]").fill("fixed");
await bad.getByRole("button", { name: "Accept" }).click();
console.log("still-bad toast:", await toast());
await bad.getByRole("button", { name: "Delete" }).click();
await p.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
console.log("q-delete toast:", await toast());
await shot("a5-quarantine");

// Audit
await p.goto("http://localhost:3000/admin/audit?action=alias_update"); await p.waitForLoadState("networkidle");
console.log("audit alias rows:", await p.locator("tbody tr").count());
await p.goto("http://localhost:3000/admin/audit"); await p.waitForLoadState("networkidle");
await shot("a6-audit");
const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "Export CSV" }).click()]);
const path = await dl.path();
const csv = (await import("node:fs")).readFileSync(path, "utf8");
console.log("csv:", dl.suggestedFilename(), csv.split("\r\n").length - 2, "rows; header:", csv.split("\r\n")[0].slice(1, 60));

// Mobile admin
const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, storageState: await ctx.storageState() });
const mp = await m.newPage();
await mp.goto("http://localhost:3000/admin/configs"); await mp.waitForLoadState("networkidle");
console.log("mobile page overflow:", await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await mp.screenshot({ path: `${out}/a7-mobile.png`, caret: "initial" });
console.log("console problems:", problems.length ? "\n  " + problems.join("\n  ") : "none");
await b.close();
