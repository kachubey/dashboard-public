# Microsoft Entra ID setup

Click-by-click guide to register the Employee Portal in your tenant. You do this once; the app never gets tenant access itself. Menu names match the Microsoft Entra admin center as of October 2026.

- **Who:** at least *Cloud Application Administrator* (or *Application Administrator*).
- **Licence:** assigning **groups** to the app requires Entra ID P1 or P2 (included in Microsoft 365 Business Premium / E3 / E5).
- **Time:** ~15 minutes.

At the end you will have four values for `.env`: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, and the redirect URI you registered (derived from `BETTER_AUTH_URL`).

## 1. Create the app registration

1. Open <https://entra.microsoft.com> → **Entra ID** → **App registrations** → **New registration**.
2. **Name:** `Employee Portal` (users see this name on the Microsoft sign-in page and in My Apps).
3. **Supported account types:** *Accounts in this organizational directory only (Single tenant)*.
4. **Redirect URI:** platform **Web**, value `http://localhost:3000/api/auth/callback/microsoft`.
5. Select **Register**.
6. On the **Overview** page copy:
   - **Application (client) ID** → `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → `ENTRA_TENANT_ID`

Entra accepts plain `http` only for `localhost`. Every other redirect URI must be `https`.

## 2. Add the production redirect URI (when the server exists)

1. App registration → **Authentication** → under **Web** → **Add URI**.
2. Add `https://<portal-host>/api/auth/callback/microsoft`, e.g. `https://portal.example.com/api/auth/callback/microsoft`.
3. Leave **Access tokens** and **ID tokens** under *Implicit grant and hybrid flows* **unchecked** — the portal uses the authorization code flow with PKCE, not implicit grant.
4. **Save**.

The path must match exactly, including no trailing slash. `BETTER_AUTH_URL` in that environment must be `https://<portal-host>`.

## 3. Create the client secret

1. App registration → **Certificates & secrets** → **Client secrets** → **New client secret**.
2. **Description:** `portal-<env>-<yyyy-mm>`, e.g. `portal-prod-2026-10`.
3. **Expires:** 180 days is a reasonable default (maximum 24 months).
4. Select **Add** and immediately copy the **Value** column → `ENTRA_CLIENT_SECRET`. It is shown only once. Do **not** copy the *Secret ID* — using it gives `AADSTS7000215: Invalid client secret provided`.
5. **Put a reminder in your calendar two weeks before the expiry date.** When the secret expires, nobody can sign in.

Rotation without downtime: create a second secret, update `ENTRA_CLIENT_SECRET` on the server, restart the app container, verify sign-in, then delete the old secret.

**Certificate instead of secret (optional, later).** Entra also accepts a certificate (`private_key_jwt`), which avoids a shared secret. Better Auth supports this through `clientAssertion`; it needs a small code change in `src/server/auth/index.ts` to sign the assertion with the certificate's private key. Ask for it when moving to production if your policy requires certificates.

## 4. Add the `upn` optional claim

The portal maps configs to people by the part of the UPN before `@`. The ID token's `preferred_username` usually equals the UPN, but Microsoft documents it as mutable and display-only, so ask Entra for the real `upn` claim:

1. App registration → **Token configuration** → **Add optional claim**.
2. **Token type:** **ID**. Tick **upn**. Select **Add**.
3. If prompted *"Turn on the Microsoft Graph profile permission"*, tick it and select **Add**.

This claim is mandatory: the portal rejects a token without `upn` instead of falling back to `preferred_username`. The Object ID is read automatically from the verified token; admins continue importing filenames based on shortUPN.

## 5. API permissions and admin consent

1. App registration → **API permissions**. You should see **Microsoft Graph → User.Read (Delegated)**, added by default.
2. Select **Add a permission** → **Microsoft Graph** → **Delegated permissions** → tick **openid**, **profile**, **email** → **Add permissions**.
3. Select **Grant admin consent for \<tenant\>** → **Yes**. The **Status** column should show *Granted for \<tenant\>*.

What each permission is for:

| Permission | Type | Why |
|---|---|---|
| `openid` | Delegated | Sign-in (OpenID Connect) |
| `profile` | Delegated | Display name in the ID token |
| `email` | Delegated | Email claim (not used for identity, only stored) |
| `User.Read` | Delegated | Only when `FEATURE_EMPLOYEE_ID=true`: the portal calls `GET /me?$select=employeeId` once at sign-in. Microsoft lists `User.Read` as the least-privileged permission for `/me`, and `employeeId` needs no extra permission (it is just not returned unless `$select`-ed). Harmless to keep consented when the flag is off — the portal then doesn't request it. |

The portal does **not** request `offline_access`, so no refresh token is issued or stored, and it never calls Graph after sign-in.

Admin consent is required anyway once *Assignment required* is on (next step).

## 6. Create the two App Roles

1. App registration → **App roles** → **Create app role**.
2. First role:

| Field | Value |
|---|---|
| Display name | `Portal User` |
| Allowed member types | **Users/Groups** |
| Value | `Portal.User` |
| Description | `Can sign in to the Employee Portal and download own VPN configs.` |
| Do you want to enable this app role? | ✓ |

3. **Apply**, then **Create app role** again:

| Field | Value |
|---|---|
| Display name | `Portal Admin` |
| Allowed member types | **Users/Groups** |
| Value | `Portal.Admin` |
| Description | `Manages configs, users and the audit log in the Employee Portal.` |
| Do you want to enable this app role? | ✓ |

The **Value** strings must match exactly — they are hard-coded in `src/server/auth/roles.ts`. The roles reach the portal in the `roles` claim of the ID token; no group claims are used, so there is no group-overage problem.

Admins don't automatically get user rights in Entra terms, but the portal treats `Portal.Admin` as including user access. Admins see only their **own** configs on the VPN page like anyone else.

## 7. Require assignment

1. **Entra ID** → **Enterprise apps** → **All applications** → open **Employee Portal** (created automatically with the registration).
2. **Properties**:
   - **Assignment required?** → **Yes**
   - **Visible to users?** → **Yes** if you want the tile in My Apps (then also set *Home page URL* on the app registration's **Branding & properties** to the portal URL), otherwise **No**.
3. **Save**.

With assignment required, people who are not assigned never get a token: Microsoft shows them `AADSTS50105` on its own sign-in page, before the portal is involved.

## 8. Assign groups to roles

Create (or reuse) two **security** groups, e.g. `SG-Portal-Users` and `SG-Portal-Admins`.

1. Enterprise apps → **Employee Portal** → **Users and groups** → **Add user/group**.
2. **Users and groups** → *None Selected* → pick `SG-Portal-Users` → **Select**.
3. **Select a role** → **Portal User** → **Select** → **Assign**.
4. Repeat for `SG-Portal-Admins` with **Portal Admin**.

Important:

- **Nested groups are not supported.** Only *direct* members of an assigned group get the role. If `SG-Portal-Users` contains another group, members of that inner group are **not** assigned. Use flat groups (dynamic groups work well, e.g. all enabled employees).
- A person in both groups gets both roles.
- Role changes take effect at the user's **next sign-in** — the portal re-reads `roles` from the ID token every time. Sessions last `SESSION_MAX_AGE_HOURS` (default 8) with no extension. To cut someone off immediately, remove the role in Entra and then use *Administration → Users → Sign out everywhere* in the portal.

## 9. Values for `.env`

```dotenv
BETTER_AUTH_URL=http://localhost:3000          # https://<portal-host> in production
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<client secret VALUE>
FEATURE_EMPLOYEE_ID=false                      # true to read employeeId via Graph at sign-in
```

In development you can keep `AUTH_MOCK=true` alongside these — the sign-in page then shows both the Microsoft button and the mock users. In production `AUTH_MOCK` must be absent.

## 10. Test

1. Restart `npm run dev`.
2. Open <http://localhost:3000> → **Sign in with Microsoft**.
3. Sign in with a member of `SG-Portal-Users` → you land on the home page with your name in the header.
4. Sign in with someone not assigned → Microsoft shows `AADSTS50105`.
5. The portal's own *No access* page appears only for someone who is assigned to the app but has no `Portal.*` role in the token — rare once roles exist (the Entra admin center no longer offers *Default Access* when the app has roles), but possible through Graph/PowerShell assignments with the default role ID. Each such attempt writes an `access_denied` row to the audit log.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `AADSTS50011: The redirect URI … does not match` | Redirect URI missing or different (http vs https, trailing slash, port) | Step 1/2: add the exact URI shown in the error |
| `AADSTS7000215: Invalid client secret provided` | Secret ID copied instead of Value, or secret expired | Step 3: create a new secret, copy the **Value** |
| `AADSTS700016: Application … was not found in the directory` | Wrong `ENTRA_CLIENT_ID` or `ENTRA_TENANT_ID` | Step 1: recopy from Overview |
| `AADSTS50105: … not assigned to a role for the application` | Assignment required, user not (directly) assigned | Step 8; check for nested groups |
| Portal *No access* page right after Microsoft sign-in | Signed in fine but no `Portal.*` role in the token | Re-assign the user/group with the **Portal User** role |
| Portal shows the e-mail prefix wrong / different person's configs | `upn` optional claim missing and `preferred_username` differs from UPN | Step 4 |

For any sign-in problem, **Entra ID → Monitoring & health → Sign-in logs**, filtered by application *Employee Portal*, shows the exact failure reason and which Conditional Access policies applied.

## Conditional Access

The portal is a normal enterprise application, so Conditional Access policies apply to it: target *Employee Portal* to require MFA, a compliant device, or block risky sign-ins. Because people use the portal to set up VPN on phones, avoid requiring a compliant device unless the phones are enrolled.
