import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db";
import { identityEmail, shortUpnOf, type Role } from "./roles";

export interface DirectoryIdentity {
  oid: string;
  upn: string;
  name: string;
  roles: Role[];
  employeeId: string | null;
}

/**
 * Insert or refresh a user keyed by Entra object ID. Used by mock sign-in;
 * real Entra sign-ins go through Better Auth's own user creation with the
 * same fields (see mapProfileToUser in ./index.ts).
 */
export async function upsertDirectoryUser(identity: DirectoryIdentity) {
  const upn = identity.upn.toLowerCase();
  const fields = {
    name: identity.name || upn,
    email: identityEmail(identity.oid),
    upn,
    shortUpn: shortUpnOf(upn),
    roles: identity.roles,
    employeeId: identity.employeeId,
  };
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const [row] = await tx
      .insert(schema.user)
      .values({ id: randomUUID(), oid: identity.oid, emailVerified: true, ...fields })
      .onConflictDoUpdate({ target: schema.user.oid, set: fields })
      .returning();
    return row!;
  });
}

export async function findUserById(id: string) {
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, id)).limit(1);
  return row;
}
