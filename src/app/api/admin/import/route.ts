import { createHash } from "node:crypto";
import { requestMeta } from "@/server/audit";
import { isAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { LIMITS as RATE, rateLimit } from "@/server/rate-limit";
import { isSameOrigin } from "@/server/same-origin";
import { InputError, LIMITS, type InputFile } from "@/server/vpn/import/inputs";
import { analyzeImport, commitImport } from "@/server/vpn/import/pipeline";

// Admin upload. The browser keeps the selected files and sends them twice:
// mode=preview (dry run) and mode=commit. The preview returns a fingerprint
// of the exact files; commit is refused if the files differ from what was
// previewed. Nothing is stored between the two calls.

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function fingerprint(files: InputFile[]): string {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    h.update(f.name).update("\0").update(createHash("sha256").update(f.bytes).digest()).update("\0");
  }
  return h.digest("hex");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return json({ error: "not_found" }, 404);

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIMITS.maxTotalBytes + 1024 * 1024) return json({ error: "batch_too_large" }, 413);

  const limit = await rateLimit(`import:${user.id}`, RATE.import.limit, RATE.import.windowSeconds);
  if (!limit.ok) return json({ error: "rate_limited" }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const mode = form.get("mode");
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  const files: InputFile[] = await Promise.all(
    uploads.map(async (f) => ({ name: f.name, bytes: Buffer.from(await f.arrayBuffer()) })),
  );

  try {
    if (mode === "preview") {
      const plan = await analyzeImport(files);
      return json({ plan, fingerprint: fingerprint(files) });
    }
    if (mode === "commit") {
      if (form.get("fingerprint") !== fingerprint(files)) return json({ error: "stale_preview" }, 409);
      const plan = await commitImport(files, { oid: user.oid, upn: user.upn }, "upload", { meta: requestMeta(request.headers) });
      return json({ plan });
    }
    return json({ error: "bad_request" }, 400);
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    console.error("admin import failed", { error: error instanceof Error ? error.name : "unknown" });
    return json({ error: "failed" }, 500);
  }
}
