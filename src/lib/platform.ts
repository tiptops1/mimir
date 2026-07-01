// Platform-admin gate (Phase 4). Tenant creation is a VENDOR capability, not a
// tenant-admin one — Christopher is ADMIN of crm_chris but must not be able to
// provision tenants. The vendor lists their own login email(s) in the
// PLATFORM_ADMIN_EMAILS env var (comma-separated); unset = feature hidden.

export function isPlatformAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}
