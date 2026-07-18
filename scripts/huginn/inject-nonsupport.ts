import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// S14b dev helper — inject one clearly non-support inbound email (vendor
// newsletter) to exercise the Haiku not_support branch. Idempotent.

const p = new PrismaClient();

async function main() {
  const messageId = "fixture:NS-01";
  const existing = await p.activity.findFirst({ where: { messageId }, select: { id: true } });
  if (existing) {
    console.log("already present");
    return;
  }
  await p.activity.create({
    data: {
      type: "EMAIL",
      direction: "INBOUND",
      subject: "Webinaire : 5 astuces pour booster votre productivite commerciale",
      note: "Newsletter marketing",
      body: "Bonjour, decouvrez notre webinaire gratuit jeudi prochain : 5 astuces pour booster votre productivite commerciale grace a notre logiciel de CRM nouvelle generation. Inscription en un clic. Pour ne plus recevoir nos emails, cliquez ici.",
      fromEmail: "marketing@saas-vendor.example",
      toEmail: "support@cabinet.example",
      messageId,
      date: new Date(),
    },
  });
  console.log("+ NS-01 injected");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());
