import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { SequenceEditor } from "@/components/outreach/sequence-editor";

export default async function NewOutreachSequencePage() {
  await verifySession();
  return (
    <div>
      <PageHeader
        title="Nouvelle séquence"
        subtitle="Délais en jours ouvrés — J+0 est le jour de l'inscription"
      />
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <SequenceEditor
          initial={{
            name: "",
            mode: "AUTO_EMAIL",
            active: true,
            steps: [
              { offsetDays: 0, channel: "EMAIL", title: "Accroche" },
              { offsetDays: 3, channel: "EMAIL", title: "Relance douce" },
              { offsetDays: 7, channel: "EMAIL", title: "Preuve / valeur" },
              { offsetDays: 13, channel: "EMAIL", title: "Porte de sortie" },
            ],
          }}
        />
      </div>
    </div>
  );
}
