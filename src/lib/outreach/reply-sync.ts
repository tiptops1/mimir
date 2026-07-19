import { google } from "googleapis";
import type { PrismaClient } from "@prisma/client";
import type { GoogleOAuthClient } from "@/lib/google-oauth";
import { isAutomatedSender } from "@/lib/email-sync";
import { sendGmail } from "@/lib/gmail-send";

// Stop-on-reply + bounce detection for the OUTREACH inbox. Deliberately NOT the
// heavy runGmailSync pipeline (that would turn every prospect reply into
// PendingContact review noise): a metadata-only scan that matches inbox messages
// against the OutreachMessage ledger by Gmail threadId (fallback: In-Reply-To /
// References vs our stamped Message-IDs), then:
//   bounce (mailer-daemon)  → message BOUNCED, enrollment BOUNCED, email INVALID
//   human reply             → enrollment REPLIED (immediate exit), INBOUND
//                             Activity, « Répondre » task due now, and an
//                             instant alert mail to the owner's MAIN mailbox.

const CURSOR_SOURCE = "outreach-inbox";
const FIRST_RUN_LOOKBACK_MS = 24 * 3_600_000;

export interface ReplySyncReport {
  scanned: number;
  replies: number;
  bounces: number;
}

interface MainMailer {
  client: GoogleOAuthClient;
  accountEmail: string;
}

// The slice of the Gmail API this sync touches — also the probe/test seam.
export interface GmailInboxApi {
  list(q: string): Promise<{ id: string }[]>;
  get(id: string): Promise<{
    threadId?: string | null;
    snippet?: string | null;
    payload?: {
      headers?: { name?: string | null; value?: string | null }[];
    } | null;
  }>;
}

function realGmailApi(client: GoogleOAuthClient): GmailInboxApi {
  const gmail = google.gmail({ version: "v1", auth: client });
  return {
    async list(q) {
      const res = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: 100,
      });
      return (res.data.messages ?? [])
        .filter((m) => m.id)
        .map((m) => ({ id: m.id! }));
    },
    async get(id) {
      const res = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: [
          "From",
          "Subject",
          "In-Reply-To",
          "References",
          "Message-ID",
        ],
      });
      return {
        threadId: res.data.threadId,
        snippet: res.data.snippet,
        payload: res.data.payload,
      };
    },
  };
}

function headerValue(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

/** "Jean Dupont <jean@x.fr>" → "jean@x.fr" */
function addressOf(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

export async function runOutreachReplySync(
  prisma: PrismaClient,
  outreach: { client: GoogleOAuthClient; accountEmail: string },
  main: MainMailer | null,
  opts: {
    now?: Date;
    gmailApi?: GmailInboxApi;
    send?: typeof sendGmail;
  } = {},
): Promise<ReplySyncReport> {
  const now = opts.now ?? new Date();
  const report: ReplySyncReport = { scanned: 0, replies: 0, bounces: 0 };
  const gmail = opts.gmailApi ?? realGmailApi(outreach.client);

  const cursorRow = await prisma.syncCursor.findUnique({
    where: { source: CURSOR_SOURCE },
  });
  const sinceMs = cursorRow?.cursor
    ? Number(cursorRow.cursor)
    : now.getTime() - FIRST_RUN_LOOKBACK_MS;
  // `after:` has seconds granularity; overlap by a minute and dedupe below.
  const afterSec = Math.max(0, Math.floor(sinceMs / 1000) - 60);

  const ids = (await gmail.list(`in:inbox after:${afterSec}`)).map((m) => m.id);

  for (const id of ids) {
    const msg = await gmail.get(id);
    report.scanned++;

    const threadId = msg.threadId ?? "";
    const headers = msg.payload?.headers ?? undefined;
    const fromAddress = addressOf(headerValue(headers, "From"));
    const subject = headerValue(headers, "Subject");
    const replyMessageId = headerValue(headers, "Message-ID");
    const refIds = `${headerValue(headers, "In-Reply-To")} ${headerValue(headers, "References")}`
      .split(/\s+/)
      .filter((s) => s.startsWith("<"));

    // Never react to our own sent copies landing in list results.
    if (fromAddress === outreach.accountEmail.toLowerCase()) continue;

    // Match against the ledger: same Gmail thread, else RFC reference chain.
    let ours = threadId
      ? await prisma.outreachMessage.findFirst({
          where: { gmailThreadId: threadId },
          orderBy: { sentAt: "desc" },
        })
      : null;
    if (!ours && refIds.length > 0) {
      ours = await prisma.outreachMessage.findFirst({
        where: { messageId: { in: refIds } },
        orderBy: { sentAt: "desc" },
      });
    }
    if (!ours) continue; // unrelated inbox mail

    // Re-runs and cursor overlap: skip anything already ingested.
    if (replyMessageId) {
      const seen = await prisma.activity.findFirst({
        where: { messageId: replyMessageId },
        select: { id: true },
      });
      if (seen) continue;
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: ours.enrollmentId },
      include: { company: true },
    });
    if (!enrollment) continue;

    if (isAutomatedSender(fromAddress)) {
      // ---- bounce ----
      await prisma.outreachMessage.update({
        where: { id: ours.id },
        data: { status: "BOUNCED" },
      });
      if (enrollment.status === "ACTIVE" || enrollment.status === "PAUSED") {
        await prisma.enrollment.update({
          where: { id: enrollment.id },
          data: { status: "BOUNCED", nextDueAt: null },
        });
      }
      if (ours.contactId) {
        await prisma.contact.update({
          where: { id: ours.contactId },
          data: { emailStatus: "INVALID" },
        });
      }
      // Trace the bounce on the timeline so the fiche explains itself.
      await prisma.activity.create({
        data: {
          companyId: ours.companyId,
          type: "NOTE",
          note: `Cold email en échec (bounce) vers ${ours.toEmail} — adresse marquée invalide.`,
          messageId: replyMessageId || undefined,
        },
      });
      report.bounces++;
      continue;
    }

    // ---- human reply ----
    if (
      enrollment.status === "ACTIVE" ||
      enrollment.status === "PAUSED" ||
      enrollment.status === "DONE"
    ) {
      await prisma.enrollment.update({
        where: { id: enrollment.id },
        data: { status: "REPLIED", nextDueAt: null },
      });
    }
    await prisma.activity.create({
      data: {
        companyId: ours.companyId,
        contactId: ours.contactId ?? undefined,
        type: "EMAIL",
        direction: "INBOUND",
        subject,
        body: msg.snippet ?? undefined,
        fromEmail: fromAddress,
        toEmail: outreach.accountEmail,
        messageId: replyMessageId || undefined,
      },
    });
    const companyLabel =
      enrollment.company.enseigne || enrollment.company.nomSociete || fromAddress;
    await prisma.task.create({
      data: {
        title: `Répondre à ${companyLabel} (réponse cold email)`,
        type: "EMAIL",
        source: "OUTREACH",
        dueDate: now,
        companyId: ours.companyId,
        contactId: ours.contactId ?? undefined,
      },
    });
    await prisma.company.update({
      where: { id: ours.companyId },
      data: { dernierContact: now },
    });

    // A hot reply is worth minutes, not the daily digest — ping the MAIN box.
    if (main) {
      const base = process.env.APP_URL || "http://localhost:3000";
      try {
        const doSend = opts.send ?? sendGmail;
        await doSend(main.client, {
          fromName: "Mimir",
          fromEmail: main.accountEmail,
          to: main.accountEmail,
          subject: `Réponse cold email — ${companyLabel}`,
          body:
            `${fromAddress} vient de répondre à votre séquence.\n\n` +
            `Objet : ${subject}\n` +
            `Extrait : ${msg.snippet ?? ""}\n\n` +
            `Fiche : ${base.replace(/\/$/, "")}/companies/${ours.companyId}\n\n` +
            `Répondez depuis la boîte ${outreach.accountEmail} pour rester dans le fil.`,
        });
      } catch (e) {
        // Alert failure must not fail the sync — the task + activity are in.
        console.error("outreach reply alert failed:", (e as Error).message);
      }
    }
    report.replies++;
  }

  await prisma.syncCursor.upsert({
    where: { source: CURSOR_SOURCE },
    update: { cursor: String(now.getTime()) },
    create: { source: CURSOR_SOURCE, cursor: String(now.getTime()) },
  });

  return report;
}
