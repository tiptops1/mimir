import { getTenantDb } from "@/lib/tenant-context";
import { findDuplicateCompanies, findDuplicateContacts } from "@/lib/dedupe";
import {
  CompanyDuplicateGroup,
  ContactDuplicateGroup,
} from "@/components/duplicate-groups";
import { EmptyState } from "@/components/ui";

// P2.2 duplicate review (ADMIN via the settings layout): conservative
// exact-key detection (lib/dedupe.ts), human-confirmed merges (actions/dedupe.ts).

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const prisma = await getTenantDb();
  const [companyGroups, contactGroups] = await Promise.all([
    findDuplicateCompanies(prisma),
    findDuplicateContacts(prisma),
  ]);

  const empty = companyGroups.length === 0 && contactGroups.length === 0;

  return (
    <div className="max-w-4xl space-y-8">
      <p className="text-sm text-muted">
        Groupes de fiches qui semblent être des doublons (même nom, même site
        web ou même email). Choisissez la fiche à conserver — les contacts,
        activités, tâches et affaires des autres lui seront rattachés, puis les
        doublons supprimés.
      </p>

      {empty ? (
        <EmptyState
          title="Aucun doublon détecté"
          hint="Les sociétés et contacts semblent tous uniques."
        />
      ) : (
        <>
          {companyGroups.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Sociétés ({companyGroups.length} groupe
                {companyGroups.length > 1 ? "s" : ""})
              </h2>
              {companyGroups.map((g) => (
                <CompanyDuplicateGroup key={`${g.kind}:${g.key}`} group={g} />
              ))}
            </section>
          )}
          {contactGroups.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Contacts ({contactGroups.length} groupe
                {contactGroups.length > 1 ? "s" : ""})
              </h2>
              {contactGroups.map((g) => (
                <ContactDuplicateGroup key={`${g.kind}:${g.key}`} group={g} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
