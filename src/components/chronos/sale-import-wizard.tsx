"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Label,
  Select,
} from "@/components/ui";
import { SALE_TARGETS, type SaleMapping } from "@/lib/chronos/sale-import";
import {
  applySaleImportSA,
  previewSaleImportSA,
  type ImportPreviewResult,
} from "@/app/actions/chronos-import";
import { formatCents } from "@/lib/display";

/**
 * Upload → map → dry run → apply.
 *
 * State-driven rather than routed (unlike /settings/import's ImportRun-backed
 * wizard): there is no run model here because idempotency comes from the dedupe
 * keys, so there is nothing to resume — re-applying a file converges.
 */
export function SaleImportWizard({
  marketplaces,
}: {
  marketplaces: Array<{ key: string; label: string }>;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [marketplace, setMarketplace] = useState(marketplaces[0]?.key ?? "");
  const [mapping, setMapping] = useState<SaleMapping>({});
  const [result, setResult] = useState<ImportPreviewResult | null>(null);
  const [applied, setApplied] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setApplied(null);
    const content = await file.text();
    setText(content);
    setMapping({});
    setResult(null);
  }

  function preview(withMapping: SaleMapping = mapping) {
    if (!text || !marketplace) return;
    setApplied(null);
    startTransition(async () => {
      const r = await previewSaleImportSA(text, marketplace, withMapping as Record<string, string>);
      setResult(r);
      if (r.mapping) setMapping(r.mapping);
    });
  }

  function apply() {
    startTransition(async () => {
      const r = await applySaleImportSA(text, marketplace, mapping as Record<string, string>);
      setApplied({ ok: r.ok, text: r.ok ? (r.message ?? "Importé.") : (r.error ?? "Échec.") });
      if (r.ok) setResult(null);
    });
  }

  function setColumn(key: string, header: string) {
    const next = { ...mapping, [key]: header };
    if (!header) delete next[key as keyof SaleMapping];
    setMapping(next);
    if (result?.headers) preview(next);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · Fichier</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-muted">
            Chrono24, Vinted et LeBonCoin n&apos;exposent aucune API : leurs ventes s&apos;importent
            depuis l&apos;export CSV du site. Les frais réels de chaque ligne sont imputés sur
            l&apos;unité correspondante, exactement comme pour eBay.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label htmlFor="marketplace">Marketplace</Label>
              <Select
                id="marketplace"
                value={marketplace}
                onChange={(e) => {
                  setMarketplace(e.target.value);
                  setResult(null);
                  setApplied(null);
                }}
                className="mt-1 w-56"
              >
                {marketplaces.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="csv">Fichier CSV</Label>
              <div className="mt-1 flex items-center gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors duration-100 hover:bg-surface-2">
                  <Upload className="h-4 w-4 text-faint" />
                  Choisir un fichier
                  <input
                    id="csv"
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(e) => onFile(e.target.files?.[0])}
                  />
                </label>
                {fileName ? <span className="text-sm text-muted">{fileName}</span> : null}
              </div>
            </div>

            <Button size="sm" disabled={!text || pending} onClick={() => preview()}>
              {pending ? "Analyse…" : "Analyser"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {applied ? (
        <div
          className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            applied.ok
              ? "border-success/30 bg-success-subtle text-success"
              : "border-danger/30 bg-danger-subtle text-danger"
          }`}
        >
          {applied.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{applied.text}</span>
        </div>
      ) : null}

      {result?.headers ? (
        <Card>
          <CardHeader>
            <CardTitle>2 · Colonnes</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {result.missing?.length ? (
              <p className="flex items-start gap-2 text-sm text-danger">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Colonnes obligatoires manquantes : {result.missing.join(", ")}
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SALE_TARGETS.map((target) => (
                <div key={target.key}>
                  <Label htmlFor={`col-${target.key}`}>
                    {target.label}
                    {target.required ? <span className="text-danger"> *</span> : null}
                  </Label>
                  <Select
                    id={`col-${target.key}`}
                    className="mt-1 w-full"
                    value={mapping[target.key] ?? ""}
                    disabled={pending}
                    onChange={(e) => setColumn(target.key, e.target.value)}
                  >
                    <option value="">— Non associée —</option>
                    {result.headers?.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {result?.ok && result.preview ? (
        <Card>
          <CardHeader>
            <CardTitle>3 · Simulation</CardTitle>
            <div className="flex items-center gap-2">
              <Badge tone="success">{result.matched} imputable(s)</Badge>
              {result.pending ? <Badge tone="warning">{result.pending} à rapprocher</Badge> : null}
              {result.rowErrors?.length ? (
                <Badge tone="danger">{result.rowErrors.length} en erreur</Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardBody className="space-y-3 p-0">
            {result.rowErrors?.length ? (
              <div className="border-b border-border px-5 py-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-faint">
                  Lignes ignorées
                </p>
                <ul className="space-y-0.5 text-sm text-danger">
                  {result.rowErrors.slice(0, 10).map((e) => (
                    <li key={e.rowNumber}>
                      Ligne {e.rowNumber} — {e.message}
                    </li>
                  ))}
                  {result.rowErrors.length > 10 ? (
                    <li className="text-faint">
                      … et {result.rowErrors.length - 10} autre(s)
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2.5 text-left font-medium">Commande</th>
                    <th className="px-4 py-2.5 text-left font-medium">SKU</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                    <th className="px-4 py-2.5 text-right font-medium">Frais</th>
                    <th className="px-4 py-2.5 text-left font-medium">Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((r, i) => (
                    <tr key={`${r.externalId}-${i}`} className="border-b border-border last:border-0">
                      <td className="tnum px-4 py-2.5 text-muted">{r.externalId}</td>
                      <td className="tnum px-4 py-2.5 text-foreground">{r.sku ?? "—"}</td>
                      <td className="tnum px-4 py-2.5 text-muted">{r.soldAt}</td>
                      <td className="tnum px-4 py-2.5 text-right text-foreground">
                        {formatCents(r.grossCents)}
                      </td>
                      <td className="tnum px-4 py-2.5 text-right text-muted">
                        {r.feeCount > 0 ? formatCents(r.feeTotalBaseCents) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.outcome === "matched" ? (
                          <Badge tone="success">Imputable</Badge>
                        ) : (
                          <Badge tone="warning">{r.reason ?? "À rapprocher"}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-xs text-faint">
                Réimporter le même fichier ne crée pas de doublon : chaque ligne de frais porte une
                clé stable.
              </p>
              <Button size="sm" disabled={pending || result.matched === 0} onClick={apply}>
                {pending ? "Import…" : "Importer"}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {result && !result.ok && !result.headers ? (
        <p className="text-sm text-danger">{result.error}</p>
      ) : null}
    </div>
  );
}
