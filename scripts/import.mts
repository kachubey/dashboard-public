// Import config files from a folder (or a list of files).
//
//   npm run import -- ./inbox --dry-run      show what would happen, write nothing
//   npm run import -- ./inbox                show the plan, ask, then import
//   npm run import -- ./inbox --yes          import without asking (automation)
//   npm run import -- ./inbox --delete-imported   remove files that were imported
//
// File names: <ownerKey>__<type>__<label>.<ext>; *.csv files are manifests
// with columns ownerKey,type,label,content_or_filename.
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { analyzeImport, commitImport, type ImportPlan } from "../src/server/vpn/import/pipeline";
import { InputError, type InputFile } from "../src/server/vpn/import/inputs";
import { REASON_TEXT } from "../src/server/vpn/import/reasons";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const targets = args.filter((a) => !a.startsWith("--"));
const known = new Set(["--dry-run", "--yes", "--delete-imported"]);
for (const f of flags) if (!known.has(f)) fail(`Unknown option ${f}`);
if (targets.length === 0) fail("Usage: npm run import -- <folder|files...> [--dry-run] [--yes] [--delete-imported]");

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function collect(): Promise<{ file: InputFile; fullPath: string }[]> {
  const out: { file: InputFile; fullPath: string }[] = [];
  for (const target of targets) {
    const info = await stat(target).catch(() => fail(`Not found: ${target}`));
    const paths = info.isDirectory()
      ? (await readdir(target, { withFileTypes: true }))
          .filter((d) => d.isFile() && !d.name.startsWith("."))
          .map((d) => path.join(target, d.name))
      : [target];
    for (const p of paths) out.push({ fullPath: p, file: { name: path.basename(p), bytes: await readFile(p) } });
  }
  return out;
}

function cell(value: string | null | undefined, width: number): string {
  const v = value ?? "—";
  return (v.length > width ? `${v.slice(0, width - 1)}…` : v).padEnd(width);
}

function printPlan(plan: ImportPlan) {
  console.log(`\n${cell("FILE", 38)} ${cell("OWNER KEY", 16)} ${cell("TYPE", 8)} ${cell("LABEL", 14)} ${cell("MATCH", 9)} ${cell("ACTION", 11)} DETAILS`);
  for (const i of plan.items) {
    const details =
      i.action === "quarantine"
        ? (REASON_TEXT[i.reason ?? ""] ?? i.reason)
        : `${i.owner?.upn ?? (i.match === "pending" ? "waits for first sign-in" : "")}${i.ownerChange ? " — previous owner's versions are destroyed" : ""}`;
    console.log(`${cell(i.source, 38)} ${cell(i.ownerKey, 16)} ${cell(i.type, 8)} ${cell(i.label, 14)} ${cell(i.match, 9)} ${cell(i.action, 11)} ${details ?? ""}`);
  }
  const s = plan.summary;
  console.log(`\ncreate ${s.create} · replace ${s.replace} · unchanged ${s.unchanged} · quarantine ${s.quarantine} · waiting for owner ${s.pending}\n`);
}

const collected = await collect();
const files = collected.map((c) => c.file);
try {
  const plan = await analyzeImport(files);
  printPlan(plan);
  if (flags.has("--dry-run")) process.exit(0);
  if (plan.summary.create + plan.summary.replace + plan.summary.quarantine === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }
  if (!flags.has("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Commit this import? [y/N] ");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Cancelled, nothing written.");
      process.exit(1);
    }
  }
  const result = await commitImport(files, { oid: null, upn: `cli:${userInfo().username}` }, "cli");
  const s = result.summary;
  console.log(`Committed: ${s.create} created, ${s.replace} replaced, ${s.unchanged} unchanged, ${s.quarantine} quarantined.`);

  if (flags.has("--delete-imported")) {
    // Only plain files whose every config was stored; manifests and quarantined files stay.
    for (const { fullPath, file } of collected) {
      if (file.name.toLowerCase().endsWith(".csv")) continue;
      const mine = result.items.filter((i) => i.source === file.name || i.source.startsWith(`${file.name} ›`));
      if (mine.length > 0 && mine.every((i) => i.action !== "quarantine")) {
        await rm(fullPath);
        console.log(`deleted ${fullPath}`);
      }
    }
  } else {
    console.log("The files are encrypted in the database now; delete them from the folder (or rerun with --delete-imported).");
  }
  process.exit(0);
} catch (error) {
  if (error instanceof InputError) fail(`Import rejected: ${REASON_TEXT[error.message] ?? error.message}`);
  throw error;
}
