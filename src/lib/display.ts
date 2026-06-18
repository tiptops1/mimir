export function companyName(c: {
  nomSociete?: string | null;
  enseigne?: string | null;
  siret?: string | null;
}): string {
  return (
    c.nomSociete?.trim() ||
    c.enseigne?.trim() ||
    (c.siret ? `SIRET ${c.siret}` : "Société sans nom")
  );
}

export function contactName(c: {
  prenom?: string | null;
  nom?: string | null;
}): string {
  const full = [c.prenom, c.nom].filter(Boolean).join(" ").trim();
  return full || "Contact sans nom";
}
