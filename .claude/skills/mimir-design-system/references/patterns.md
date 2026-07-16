# Canonical markup patterns

Copy these instead of re-deriving. Each is extracted from the live component named above it —
if the live file and this doc ever disagree, the live file wins; update this doc.

## Page skeleton (list page)

From `src/app/(app)/companies/page.tsx`:

```tsx
<PageHeader title="Sociétés" subtitle="128 sociétés — 12 engagées">
  {/* secondary actions first, single primary last */}
  <LinkButton href="/contacts/new">+ Nouveau contact</LinkButton>
</PageHeader>

<div className="p-6">
  <SavedViews page="companies" views={savedViews} />
  <CompaniesFilters stages={stageDefs} />
  {/* optional notice banner (see below) */}
  {rows.length === 0 ? (
    <EmptyState title="Aucune société trouvée" hint="Ajustez vos filtres ou ajoutez une nouvelle société." />
  ) : (
    <Card className="overflow-hidden">{/* table */}</Card>
  )}
</div>
```

## Table (canonical — the refined variant)

From `src/app/(app)/companies/page.tsx:220`. The older loose variant
(`text-xs text-muted` headers, no header fill) still exists on some pages — don't copy it.

```tsx
<Card className="overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
          <th className="px-4 py-2.5 font-semibold">Société</th>
          <th className="px-4 py-2.5 font-semibold">Étape</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-border last:border-0 align-top transition-colors hover:bg-surface-2/70">
          <td className="px-4 py-3">
            <Link href={`/companies/${c.id}`} className="block">
              <span className="font-medium text-foreground hover:text-brand">{primary}</span>
              <span className="mt-0.5 block text-xs text-muted">{secondary}</span>
            </Link>
          </td>
          <td className="px-4 py-3">…</td>
        </tr>
      </tbody>
    </table>
  </div>
</Card>
```

Numbers/dates users compare: add `tnum` to the cell. Empty cell value: `<span className="text-faint">—</span>`.

## Filter bar

From `src/components/contacts-filters.tsx`. Text inputs debounce
(`f.setDebounced`), selects apply immediately (`f.setNow`), reset is a ghost button rendered
only when a filter is active. **Order: contact name, company, email/phone, then dropdowns.**

```tsx
const f = useUrlFilters();
<div className="mb-4 flex flex-wrap items-end gap-3">
  <div className="min-w-44 flex-1">
    <Input value={nom} onChange={(e) => { setNom(e.target.value); f.setDebounced("nom", e.target.value); }}
      placeholder="Nom du contact…" />
  </div>
  {/* …company, email inputs, min-w-40 flex-1… */}
  <Select value={f.get("role")} onChange={(e) => f.setNow("role", e.target.value)} className="w-48">
    <option value="">Tous les contacts</option>
    <option value="decideur">Décideurs uniquement</option>
  </Select>
  {hasFilters && (
    <button type="button" onClick={() => { /* clear local state */ f.reset(); }}
      className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground">
      Réinitialiser
    </button>
  )}
</div>
```

## Popover / dropdown menu

From `src/components/quick-add-menu.tsx` / `enum-cell.tsx`. Anchored absolutely to a relative
wrapper, closes on outside mousedown, `animate-pop` entrance.

```tsx
<div ref={ref} className="relative">
  <button type="button" onClick={() => setOpen((v) => !v)}>…trigger…</button>
  {open && (
    <div className="animate-pop absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-card p-1.5 shadow-lg">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => pick(o)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2 ${
            o.value === current ? "bg-surface-2" : ""}`}>
          {o.label}
        </button>
      ))}
    </div>
  )}
</div>
```

Outside-click close:

```tsx
useEffect(() => {
  if (!open) return;
  function onClick(e: MouseEvent) {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }
  document.addEventListener("mousedown", onClick);
  return () => document.removeEventListener("mousedown", onClick);
}, [open]);
```

## Inline-edit cell (badge → dropdown)

`src/components/enum-cell.tsx` is the generic version — reuse it for any enum field before
writing a new cell. Idiom: optimistic local state + `useTransition` server action, and a
render-time re-sync (not an effect) when the server value changes:

```tsx
const [current, setCurrent] = useState(row.value);
const [seen, setSeen] = useState(row.value);
if (row.value !== seen) { setSeen(row.value); setCurrent(row.value); }
```

## Notice banner (inline, dismissible-by-link)

From `companies/page.tsx:191` — for scoped-view notices, hidden-row counts, etc.

```tsx
<div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
  <span>12 sociétés masquées (sans engagement).</span>
  <Link href={qs({ all: "1" })} className="font-medium text-brand hover:underline">Tout afficher</Link>
</div>
```

## Floating action bar (bulk select / sticky save)

From `bulk-select.tsx:153` and `company-inline-editor.tsx:249`:

```tsx
<div className="animate-pop sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur">
  …
</div>
```

## Badges

Semantic tone → `<Badge tone="success">Payé</Badge>`.
Color-as-data (stages, priorities) → helpers in `src/components/badges.tsx`
(`StageBadge`, `PrioriteBadge`, `PotentielBadge`); stage badges carry a leading dot:

```tsx
<Badge className={meta.badge}>
  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
  {meta.label}
</Badge>
```
