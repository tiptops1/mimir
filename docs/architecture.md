# Architecture — multi-tenant CRM platform

> **Goal:** this CRM platform is **multi-tenant and config-driven** by design. The first tenant
> provisioned is the prototype; the same codebase then onboards other customers with no
> per-customer code.

## The three planes

```
CONTROL PLANE · shared database (Prisma)
  Tenants │ Auth & users │ Tenant→DB router │ Integration credentials (encrypted)
        │
        ▼  router resolves tenantId → connection string
TENANT DATA PLANE · one isolated database per customer (flexible documents)
  Tenant 1 DB ──┐  Customer 2 DB   Customer 3 DB   (provisioned on signup)
   • Entity & field definitions (config)   ← drives dynamic forms/tables/validation
   • Contacts · Companies · Deals
   • Pipeline · Views · Activities
        ▲
        │  writes into each tenant's activity timeline
INTEGRATION LAYER · OAuth + webhooks  (ALREADY BUILT single-tenant — see INTEGRATIONS.md)
  Gmail (IMAP) │ Google Calendar (iCal) │ Fireflies/Zoom/Teams transcripts → ingestion → Claude insight
```

## Key decisions (and why)

### 1. Multi-tenancy = database-per-tenant on a **shared Atlas cluster**
- Each customer gets a **logically separate database** (`crm_tenant1`, `crm_tenant2`, …) on **one**
  cluster — real data isolation + per-customer backup/export, *without* paying for or operating N
  clusters. Onboarding = create a DB + seed config.
- **Build the DB-router abstraction now** (control plane maps `tenantId → connection string`). A
  single large client can later be promoted to their **own cluster** with no app-code change.
- ❌ Avoid cluster-per-tenant for now (≈$60+/mo/customer, slow onboarding) — only for a client
  whose compliance demands physical isolation.
- ❌ Avoid repo-per-tenant/forking — that's N codebases to maintain; defeats the whole goal.

### 2. "Fully editable" = **config-driven schema**, not per-customer code
- A tenant's custom fields, pipeline stages, statuses and views live in an **entity/field
  definition** config (data), and the UI renders dynamically from it. New customer = new config,
  **zero code changes**. This is what makes replication trivial.
- **Prisma fights this** (it wants a fixed, typed schema). So:
  - **Control plane → Prisma** (tenants, users, billing — stable schema, keep the type safety).
  - **Tenant CRM data → MongoDB flexible documents** (native driver / Mongoose). Custom fields are
    just keys on a document — **no migration** when a tenant adds a field. The field-definition
    config drives validation + rendering. (This is *why* MongoDB is a good fit here.)

### 3. Integration layer is already built — needs to become per-tenant
- Gmail/Calendar/Fireflies/Claude ingestion exists (single-tenant, `/api/cron`, see INTEGRATIONS.md).
- The Phase-3 work is making credentials **per-tenant** (stored encrypted in the control plane) and
  routing ingestion to the right tenant DB — not building it from scratch.

## How today's app maps onto the target

| Legacy single-tenant shape | Target (multi-tenant) |
|---|---|
| One Atlas DB, all data | Control-plane DB + one DB per tenant; router resolves which |
| `User`/`Company`/`Contact`/`Activity` (Prisma, fixed) | Core entities + **field-definition config** driving custom fields |
| A single owner seeded as ADMIN | Tenant #1's owner is **one tenant among many**; users belong to a tenant |
| Integration env vars (IMAP_*, FIREFLIES_API_KEY, …) global | Per-tenant integration credentials, encrypted in control plane |
| Hardcoded French-brokerage fields/stages | Same fields/stages expressed as **tenant config** (seeded per tenant) |

## The one rule that keeps this replicable
If you ever hardcode something specific to one customer's business **in code**, stop — it belongs
in **config**. That single discipline is the difference between "a prototype I can replicate" and
"I rebuilt it for every customer."
