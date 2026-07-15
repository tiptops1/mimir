# Agentic platform — decision memo

**Status.** Decisions from the 2026-07-15 feasibility discussion. Planning only — nothing here is built. Companion to `VISION-RM-BRIEF.md`; when they disagree, the brief describes what *is*, this memo describes what was *decided*. Update this doc when a gate closes or a decision flips.

---

## 1\. Context — what this extends

Vision RM is **already multi-tenant** (Phases 0–3 deployed: control plane, DB-per-tenant router, config-driven schema, per-tenant integrations, provisioning code). This memo is *not* a multi-tenancy plan. It covers extending the platform into an agentic operations stack: RAG knowledge base, support automation, tech-support/RCA docs, marketing content, telemetry, compliance tracking — on top of the sales-pipeline and finance modules that already exist.

**Runtime reasoning is API-billed, never Claude Pro.** Pro/Max is for build sessions only (known gotcha, brief §11). Unattended agent work \= Claude API (or Gemini, as today). The MCP connector is the exception that proves the rule: the *customer's own* Claude subscription reasons over the CRM at zero marginal platform cost.

---

## 2\. Decisions made

| \# | Decision | Choice |
| :---- | :---- | :---- |
| D1 | Go-to-market path | **Path C — build horizontal, sell vertical.** Modules are tenant-agnostic and config-driven in their bones; packaging, seed configs, prompts, and GTM stay French-insurance-broker-shaped until 3–5 paying brokers fund generalization. |
| D2 | Support-automation autonomy | **Draft-and-approve for MVP → graduated autonomy.** Autonomy is a per-tenant, per-action-category *config setting* from day one: `off → draft_approve → auto_send_with_undo → autonomous`. MVP launches everything at `draft_approve`. |
| D3 | Health data (HDS) | **Unresolved — treated as "plan as if yes" until closed.** See Gate G2. Working lean: exclusion posture (contractual carve-out \+ ingestion-side health classifier that quarantines flagged content before storage/embedding), which keeps Atlas \+ Vercel intact. |
| D4 | Database | MongoDB Atlas stays the sole DB, including native Vector Search for RAG. Per-tenant vector indexes ride the existing DB-per-tenant model. |
| D5 | Approval surface | **One** unified agent action ledger \+ approval inbox, shared by every module. No module ships its own approval flow. `/inbox` triage \+ `AuditLog` \+ outreach ledger are the templates to extend, not fork. |

### Path C discipline — the two rules that make it real

1. **Prompts are tenant config, not source.** Prompt templates live alongside `FieldDefinition`, seeded per vertical. A broker-specific phrase in a `.ts` file \= rule \#1 violation in its new form. The broker prompt pack is a sellable vertical asset, not code.  
2. **Generic ontology, vertical labels.** Data-model names stay generic (knowledge base, conversations, playbooks); French broker vocabulary lives in labels/config — exactly the stage-definition pattern.

### Autonomy ramp — how a category graduates (D2)

- Graduation is **earned by data**: e.g. ≥95% of drafts sent unedited over several weeks. Requires approve/edit/reject events in the ledger from the *first draft ever shown*.  
- **Circuit breaker** (reuse the outreach bounce-breaker pattern): edit-rate or negative-reply spike auto-demotes a category back to `draft_approve`.  
- **Never graduates**, regardless of stats: anything committing money, anything legal, anything the health classifier flagged.

---

## 3\. Open gates — blocking, external lead time

| Gate | What | Why it gates | Action |
| :---- | :---- | :---- | :---- |
| **G1** | Google OAuth: publish to Production \+ CASA verification (gmail restricted scope) | External → Testing tokens die \~7 days; tolerable for Christopher, fatal for customer \#2. Weeks-to-months lead time, a few hundred–few thousand €/yr via authorized lab (verify current terms). | **Start now**, independent of everything else. Longest external dependency on the platform. |
| **G2** | Health-data decision | Support automation ingests *client* correspondence; for a health broker that's where questionnaires médicaux live. HDS scope would rule out plain Atlas \+ Vercel for that data. | Ask Christopher what a typical month of client email actually contains → decide exclusion vs HDS **before a single client email is ingested**. Cannot retrofit "we never stored it." |

Neither gate blocks starting the ledger or RAG build. G2 blocks support-automation ingestion; G1 blocks customer \#2.

---

## 4\. Build sequence

Dependency logic: RAG is the root (support, RCA docs, marketing all consume it). The ledger is module zero because N bespoke approval flows \= the costly v2 consolidation this sequence exists to avoid. Telemetry dashboards defer indefinitely **iff** structured events are emitted from day one (events can't be backfilled).

| Order | Module | Notes |
| :---- | :---- | :---- |
| 0 | **Agent action ledger \+ approval inbox** (thin) | Every agent proposal/action: visible, explainable (source passages, triggering email), editable, reversible. Doubles as GDPR audit trail and debugging tool. |
| 1 | **RAG knowledge base** | Per-tenant vector index. Read-only, no side effects, demo-able. Health classifier sits at ingestion here too. |
| 2 | **Support drafting** (`draft_approve`) | Gated on G2. Emits graduation stats from first draft. |
| 3 | **Tech support / RCA docs** | Consumes RAG \+ ledger. |
| 4 | **Telemetry dashboards** | Reads events already emitted since step 0\. |
| 5 | **Marketing content** | Stateless, plugs into RAG. Safely last. |
| 6 | **Compliance tracking UI** | Audit substrate already exists; UI only. |

Already shipped, not in scope: sales pipeline automation (Lead One \+ sequences \+ outreach), finance reporting (P3).

Pull-forward from Path B, cheap and demo-valuable: **per-tenant branding**.

Premium/UX track (parallel, small increments): approval inbox as hero surface → Cmd+K command palette on the existing Atlas Search backend → editable dashboards as config (widget defs as data, `SavedView` pattern) → MCP connector (customer's Claude Pro chats with their CRM) → global undo on the ledger → morning briefing as generated artifact → automation builder (trigger→condition→action as tenant config) → white-label.

---

## 5\. New structural pieces (retrofits, no rebuild)

1. **Job queue / resumable agent steps.** Vercel 60s \+ cron-job.org is not an agent runtime. Each agent step \= its own sub-60s invocation, state in Mongo.  
2. **Per-tenant AI metering \+ quotas.** AI keys are platform env creds; fine at €0.20/mo CRM enrichment, invisible margin leak at agentic volume. `LeadOneQuota` is the pattern. Must exist before customer \#2 touches anything agentic.  
3. **Vector/search index budget.** DB-per-tenant multiplies indexes per tenant. Hard cap 2,500/cluster; M10 degrades far earlier. This — not storage — is the scaling constraint. Production RAG at scale wants dedicated Search Nodes (\~€150–300/mo pair), landing somewhere between customer 5 and 15\.  
4. **Compliance now-items:** confirm Atlas region is EU (migration pain grows with tenants); maintain sub-processor list (Google/Gemini, Anthropic, Vercel, MongoDB) \+ DPA template. DB-per-tenant export/deletion is a **selling point** — say it in the pitch. Defer safely: SOC2-style certs, retention automation, DPO arrangement.

---

## 6\. Cost snapshot (2026-07 rates — verify before quoting)

Claude API per MTok: Haiku 4.5 $1/$5 · Sonnet $3/$15 (Sonnet 5 intro $2/$10 → 2026-08-31) · Opus 4.8 $5/$25. Batch API −50%; cache reads −90% — all cron/batch agent work goes through Batch.

Per-tenant runtime tokens, routed sensibly (Haiku classify/extract, Sonnet customer-facing): **\~€8–25/mo**; unrouted/uncached \~€30–60; heavy autonomous loops €100+ (hence metering). Embeddings: \~€1–3 one-off per tenant knowledge base.

| Monthly | 1 customer | 5 | 20 |
| :---- | :---- | :---- | :---- |
| Atlas | M0 free / Flex €10–30 | M10 \~€60 | M10–M20 \+ Search Nodes €250–450 |
| Claude runtime | €10–25 | €50–125 | €200–500 |
| Vercel | free | Pro €20 | Pro €20 |
| Build sub (Pro/Max) | €20–100 | same | same |
| **Total** | **\~€40–150** | **\~€150–300** | **\~€500–1,000** |

At \~€150–300/customer/mo pricing, variable cost €15–40/tenant → healthy margin. The only margin risk is unmetered agentic usage (§5.2).

---

## 7\. Standing rules for this track

Inherited from the brief, restated because agentic modules will test them:

- Config, not code — now including **prompts**.  
- Tenant data only through the router. Agent steps too.  
- Don't break the live app. Every agentic feature ships behind per-tenant config, default off.  
- Every side-effectful agent action goes through the ledger. No exceptions, no per-module forks.  
- Emit events from day one; dashboards later.

