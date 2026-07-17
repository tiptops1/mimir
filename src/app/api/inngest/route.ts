import { serve } from "inngest/next";
import { inngest } from "@/lib/jobs/client";
import { proofRun } from "@/lib/jobs/proof";
import { ingestDocument } from "@/lib/jobs/ingest";

// Inngest execution endpoint — every step of every job arrives here as its
// own sub-60s invocation (the memo §5.1 architecture). Requests are verified
// against INNGEST_SIGNING_KEY in production; the local dev server needs none.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [proofRun, ingestDocument],
});
