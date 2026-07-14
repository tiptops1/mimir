"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import type { SequenceMode, SequenceStep } from "@/lib/sequences";

// CRUD for outreach sequences (/outreach/sequences). ADMIN-only writes, like the
// stage/field config editors. Unlike those, the editor is a stateful client
// component, so actions take a typed payload rather than FormData.

export interface SequencePayload {
  name: string;
  mode: SequenceMode;
  active: boolean;
  steps: SequenceStep[];
}

export interface SequenceResult {
  error?: string;
  ok?: boolean;
  id?: string;
}

function revalidateAll() {
  revalidatePath("/outreach");
  revalidatePath("/outreach/sequences");
}

/** Validate + normalize a payload; returns an error string or the clean steps. */
function validate(payload: SequencePayload): string | SequenceStep[] {
  if (!payload.name.trim()) return "Le nom de la séquence est requis.";
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    return "Ajoutez au moins une étape.";
  }
  if (payload.mode !== "TASKS" && payload.mode !== "AUTO_EMAIL") {
    return "Mode invalide.";
  }

  const steps: SequenceStep[] = [];
  let prevOffset = -1;
  let firstEmailSeen = false;
  for (const [i, s] of payload.steps.entries()) {
    const offsetDays = Math.max(0, Math.round(Number(s.offsetDays) || 0));
    if (offsetDays < prevOffset) {
      return `Étape ${i + 1} : le délai (J+${offsetDays}) est antérieur à l'étape précédente.`;
    }
    prevOffset = offsetDays;
    const channel =
      s.channel === "APPEL" || s.channel === "LINKEDIN" ? s.channel : "EMAIL";
    const title = String(s.title ?? "").trim();
    if (!title) return `Étape ${i + 1} : le titre est requis.`;

    const step: SequenceStep = { offsetDays, channel, title };
    if (payload.mode === "AUTO_EMAIL" && channel === "EMAIL") {
      const body = String(s.body ?? "").trim();
      if (!body) return `Étape ${i + 1} : le texte de l'email est requis.`;
      step.body = String(s.body);
      if (!firstEmailSeen) {
        const subject = String(s.subject ?? "").trim();
        if (!subject) {
          return `Étape ${i + 1} : le premier email doit avoir un objet.`;
        }
        step.subject = subject;
        firstEmailSeen = true;
      }
      // Follow-up emails deliberately carry NO subject — they thread as "Re:".
    }
    steps.push(step);
  }
  if (payload.mode === "AUTO_EMAIL" && !firstEmailSeen) {
    return "Une séquence d'envoi automatique doit contenir au moins un email.";
  }
  return steps;
}

export async function createSequence(
  payload: SequencePayload,
): Promise<SequenceResult> {
  await requireRole(["ADMIN"]);
  const steps = validate(payload);
  if (typeof steps === "string") return { error: steps };

  const prisma = await getTenantDb();
  const seq = await prisma.sequence.create({
    data: {
      name: payload.name.trim(),
      mode: payload.mode,
      active: payload.active,
      steps: steps as unknown as object[],
    },
  });
  revalidateAll();
  return { ok: true, id: seq.id };
}

export async function updateSequence(
  id: string,
  payload: SequencePayload,
): Promise<SequenceResult> {
  await requireRole(["ADMIN"]);
  const steps = validate(payload);
  if (typeof steps === "string") return { error: steps };

  const prisma = await getTenantDb();
  const existing = await prisma.sequence.findUnique({ where: { id } });
  if (!existing) return { error: "Séquence introuvable." };

  await prisma.sequence.update({
    where: { id },
    data: {
      name: payload.name.trim(),
      mode: payload.mode,
      active: payload.active,
      steps: steps as unknown as object[],
    },
  });
  revalidateAll();
  return { ok: true, id };
}

export async function deleteSequence(id: string): Promise<SequenceResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const existing = await prisma.sequence.findUnique({ where: { id } });
  if (!existing) return { error: "Séquence introuvable." };

  // Deleting cascades enrollments + sent-message history — refuse if anything
  // ever ran through it; deactivate instead (the toggle keeps history intact).
  const enrollments = await prisma.enrollment.count({ where: { sequenceId: id } });
  if (enrollments > 0) {
    return {
      error: `Impossible de supprimer : ${enrollments} société(s) sont ou ont été inscrites. Désactivez la séquence à la place.`,
    };
  }

  await prisma.sequence.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}
