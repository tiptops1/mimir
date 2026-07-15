import type { PrismaClient } from "@prisma/client";
import { getNotificationSummary } from "./notifications";
import type { GoogleOAuthClient } from "./google-oauth";
import { sendGmail } from "./gmail-send";
import { getTenantConfig } from "./tenant-config";

// Daily email digest: "X prospects à relancer / Y tâches aujourd'hui", emailed to
// the owner's own mailbox via the connected Gmail account. Guarded by a per-day
// cursor (SyncCursor "digest") so the 4-hourly cron sends it at most once a day.

const CURSOR = "digest";
const APP_URL =
  process.env.APP_URL || "http://localhost:3000";

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export interface DigestGoogle {
  client: GoogleOAuthClient;
  accountEmail: string;
}

export async function sendDailyDigest(
  prisma: PrismaClient,
  // Callers (the per-tenant cron loop) pass their own Google connection, or
  // `null`/omitted for "this tenant has none". `ownerName` overrides the
  // default config greeting with the connected account's derived name.
  opts: { google?: DigestGoogle | null; ownerName?: string } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const today = todayKey();
  const cursor = await prisma.syncCursor.findUnique({ where: { source: CURSOR } });
  if (cursor?.cursor === today) return { sent: false, reason: "already sent today" };

  const summary = await getNotificationSummary(prisma);

  // Stamp the cursor regardless so we don't recompute every 4h; only actually
  // send when there's something worth reporting and Google is connected.
  const stamp = () =>
    prisma.syncCursor.upsert({
      where: { source: CURSOR },
      create: { source: CURSOR, cursor: today },
      update: { cursor: today },
    });

  if (summary.total === 0) {
    await stamp();
    return { sent: false, reason: "nothing to report" };
  }

  const google = opts.google ?? null;
  if (!google) return { sent: false, reason: "google not connected" };

  const owner = opts.ownerName ?? getTenantConfig().owner.name;
  const body = [
    `Bonjour ${owner},`,
    "",
    "Voici votre point du jour :",
    `• ${summary.taskCount} tâche(s) à faire (en retard ou aujourd'hui)`,
    `• ${summary.staleCount} prospect(s) à relancer (sans contact depuis 30 jours)`,
    "",
    "À traiter en priorité :",
    ...summary.items.map((it) => `- ${it.label} (${it.sub})`),
    "",
    `Agir maintenant : ${APP_URL}/todo`,
    "",
    "— Vision RM",
  ].join("\n");

  await sendGmail(google.client, {
    fromName: "Vision RM",
    fromEmail: google.accountEmail,
    to: google.accountEmail,
    subject: `Vision RM — ${summary.taskCount} tâche(s), ${summary.staleCount} relance(s)`,
    body,
  });

  await stamp();
  return { sent: true };
}
