"use client";

import { useState, useTransition } from "react";
import { Button, Select, Textarea, Label } from "@/components/ui";
import { submitLegalDraftSA } from "@/app/actions/forseti-legal";
import type { LegalDocType } from "@/lib/forseti/legal-draft";

// Forseti legal drafting (S23) — paste-text entry point. Mirrors the plain
// useTransition + server-action-call shape used by other manual-trigger
// forms in the app; no client-side router, this is a single-purpose page.

export function ForsetiLegalForm({
  companies,
}: {
  companies: Array<{ id: string; name: string }>;
}) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [docType, setDocType] = useState<LegalDocType>("contract_review");
  const [inputText, setInputText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setResult(null);
    startTransition(async () => {
      const res = await submitLegalDraftSA(companyId, docType, inputText);
      if (res.outcome === "proposed") {
        setResult("Brouillon proposé — à retrouver dans la boîte de réception des agents.");
        setInputText("");
      } else if (res.outcome === "quarantined") {
        setResult(
          "Contenu mis en quarantaine par le filtre de conformité — rien n'a été rédigé.",
        );
      } else if (res.outcome === "failed") {
        setResult("La rédaction a échoué (réponse du modèle invalide). Réessayez.");
      } else {
        setResult(res.message);
      }
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Société</Label>
        <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={pending}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Type de document</Label>
        <Select
          value={docType}
          onChange={(e) => setDocType(e.target.value as LegalDocType)}
          disabled={pending}
        >
          <option value="contract_review">Revue de contrat</option>
          <option value="terms_draft">Rédaction de conditions</option>
        </Select>
      </div>
      <div>
        <Label>
          {docType === "contract_review"
            ? "Texte du contrat à examiner"
            : "Brief pour les conditions à rédiger"}
        </Label>
        <Textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={pending}
          rows={10}
          placeholder={
            docType === "contract_review"
              ? "Collez ici le texte du contrat…"
              : "Décrivez ce que les conditions doivent couvrir…"
          }
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={pending || !companyId || inputText.trim().length === 0}
          onClick={submit}
        >
          {pending ? "Rédaction en cours…" : "Rédiger"}
        </Button>
        {result && <p className="text-xs text-muted">{result}</p>}
      </div>
    </div>
  );
}
