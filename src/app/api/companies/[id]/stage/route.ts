import { NextResponse, type NextRequest } from "next/server";
import { getTenantDb } from "@/lib/tenant-context";
import { getOptionalSession } from "@/lib/dal";
import { stageSchema } from "@/lib/validations";
import { mirrorStageToPrimaryDeal } from "@/lib/deals";
import { getStageDefs, stageLabelsFrom } from "@/lib/stage-config";
import { recordStageChange } from "@/lib/stage-history";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const prisma = await getTenantDb();

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = stageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const stage = parsed.data.stage;
  const stageDefs = await getStageDefs();
  if (!stageDefs.some((s) => s.value === stage)) {
    return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  }

  try {
    const before = await prisma.company.findUnique({
      where: { id },
      select: { stage: true },
    });
    await prisma.company.update({
      where: { id },
      data: {
        stage,
        ...(stage === "DEMO_REALISEE" ? { demoRealisee: true } : {}),
        ...(stage === "PROPOSITION_ENVOYEE" ? { propositionEnvoyee: true } : {}),
      },
    });
    await mirrorStageToPrimaryDeal(prisma, id, stage);
    await recordStageChange(prisma, {
      companyId: id,
      from: before?.stage ?? null,
      to: stage,
      userId: session.userId,
    });
    await prisma.activity.create({
      data: {
        companyId: id,
        type: "STAGE_CHANGE",
        note: `Étape déplacée vers « ${stageLabelsFrom(stageDefs)[stage]} »`,
        userId: session.userId,
      },
    });
  } catch {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, stage });
}
