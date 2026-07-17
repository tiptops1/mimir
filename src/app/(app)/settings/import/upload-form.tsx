"use client";

import { useActionState } from "react";
import { uploadImportFile, type FormResult } from "@/app/actions/import";
import { Button, Card, CardBody, CardHeader, CardTitle, Label } from "@/components/ui";

export function UploadForm() {
  const [state, formAction, pending] = useActionState<FormResult, FormData>(
    uploadImportFile,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importer un export CRM</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="import-file">Fichier CSV (UTF-8, 4 Mo max)</Label>
            <input
              id="import-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1 file:text-sm file:font-medium file:text-foreground"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Analyse du fichier…" : "Téléverser"}
          </Button>
        </form>
        {state.error && (
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Un même fichier téléversé deux fois reprend l&apos;import existant (déduplication par
          empreinte du contenu). Les colonnes seront mappées à l&apos;étape suivante.
        </p>
      </CardBody>
    </Card>
  );
}
