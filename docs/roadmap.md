# Roadmap — single-tenant → multi-tenant platform

> **Cross-session source of truth.** Update the status + checkboxes here as work lands, so any
> freshly-`/clear`ed session knows exactly where things stand. See `docs/architecture.md` for the why.

**Current phase: Phase 0 — not started.**
The single-tenant app is live and working (companies, contacts, pipeline, analytics, auth, and
Gmail/Calendar/Fireflies/Claude integrations). The work below turns it into a multi-tenant platform.

---

## Phase 0 — Spine (multi-tenancy foundation) ⬅️ current
Get tenancy right *before* features — retrofitting it later is the rebuild we're avoiding.
- [ ] Control-plane schema (Prisma): `Tenant`, tenant-scoped `User`, `Membership`
- [ ] `tenantId → connection string` DB router (resolve + cache per request)
- [ ] Tenant provisioning: create isolated DB + seed base config (script/endpoint)
- [ ] Tenant context in auth/session + request middleware (`proxy.ts`)
- [ ] Migrate Christopher's existing data into "tenant #1" without downtime
- [ ] Verify: two tenants, fully isolated data, in browser

## Phase 1 — Config-driven core
The product itself; Chris's CRM becomes one *config* of it.
- [ ] Entity & field-definition model (config stored as data)
- [ ] Dynamic form + table rendering from config
- [ ] Express Chris's current Company/Contact/Deal fields + 8 pipeline stages as seeded config
- [ ] Custom-field read/write on flexible documents (no migration to add a field)

## Phase 2 — Self-serve customization
Proves the "fully editable" promise on a real user before selling it.
- [ ] UI for a tenant to add/edit their own fields
- [ ] UI for pipeline stages + saved views
- [ ] Guardrails/validation so self-serve edits can't corrupt data

## Phase 3 — Integrations per-tenant
The moat already exists single-tenant — make it multi-tenant.
- [ ] Move integration credentials to per-tenant, encrypted in control plane
- [ ] Route `/api/cron` ingestion (Gmail/Calendar/Fireflies + Claude insight) to the right tenant DB
- [ ] Per-tenant connect/disconnect UI for each source

## Phase 4 — Productize & replicate
Replication = "Phase 0 on demand."
- [ ] Self-serve onboarding flow (create tenant → provision DB → seed config)
- [ ] Per-tenant branding + subdomain
- [ ] Billing
- [ ] Onboard customer #2

---

## Working log (newest first)
- 2026-06-23 — Pipeline card made config-driven (small Phase-1 down-payment): title/subline
  fields + subline color now read from `src/lib/tenant-config.ts` (`getTenantConfig().pipelineCard`)
  instead of being hardcoded in `pipeline-board.tsx`. Seeded for Christopher = tenant #1
  (title=contact, subline=company in light blue). When the per-tenant config store + DB router
  land, swap only `getTenantConfig` to resolve from the tenant DB — call sites unchanged.
- 2026-06-23 — Architecture + roadmap + CLAUDE.md created. Direction set: multi-tenant,
  config-driven, DB-per-tenant on shared cluster. Phase 0 next.
