import { ROLES, type Role } from "./roles";

// Fake identities for AUTH_MOCK development sign-in. `oid` values use the
// nil-prefix range so they can never collide with real Entra object IDs.
export interface MockUser {
  oid: string;
  upn: string;
  name: string;
  roles: Role[];
  employeeId?: string;
}

export const MOCK_USERS: readonly MockUser[] = [
  {
    oid: "00000000-0000-4000-8000-000000000001",
    upn: "admin@portal.test",
    name: "Alex Admin",
    roles: [ROLES.admin, ROLES.user],
    employeeId: "E1001",
  },
  {
    oid: "00000000-0000-4000-8000-000000000002",
    upn: "alice@portal.test",
    name: "Alice Anderson",
    roles: [ROLES.user],
    employeeId: "E1042",
  },
  {
    oid: "00000000-0000-4000-8000-000000000003",
    upn: "bob@portal.test",
    name: "Bob Brown",
    roles: [ROLES.user],
    employeeId: "E1043",
  },
  {
    oid: "00000000-0000-4000-8000-000000000004",
    upn: "smith@portal.test",
    name: "John Smith",
    roles: [ROLES.user],
  },
  {
    // Signed in but has no App Role assigned → must land on the access-denied page.
    oid: "00000000-0000-4000-8000-000000000005",
    upn: "norole@portal.test",
    name: "No Role",
    roles: [],
  },
];

export function findMockUser(oid: string): MockUser | undefined {
  return MOCK_USERS.find((u) => u.oid === oid);
}
