/**
 * ONE-TIME data fix — release messages stuck in the old human "review" queue.
 *
 * Background: before the "no human approval" policy (2026-10), messages whose
 * AI moderation failed or was uncertain were parked with modStatus="REVIEW"
 * and never delivered. The club decided messages must flow automatically.
 *
 * This script:
 *   1. Sets modStatus REVIEW → ALLOWED for all stuck messages (so the
 *      recipient can finally see them in the app).
 *   2. For WEB-sourced messages, sets deliveryStatus QUEUED → SENT
 *      (in-app delivery is immediate).
 *   3. Leaves WHATSAPP-sourced delivery status untouched (those were never
 *      forwarded to WhatsApp; they become visible in the web inbox only).
 *   4. Prints a summary.
 *
 * Usage (from the project root, with DATABASE_URL pointing at Supabase):
 *   bunx tsx scripts/release-review-queue.ts
 *   # or
 *   bun run scripts/release-review-queue.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const stuck = await db.message.findMany({
    where: { modStatus: "REVIEW" },
    select: { id: true, source: true, deliveryStatus: true },
  });

  if (stuck.length === 0) {
    console.log("No REVIEW-status messages found — nothing to do. ✅");
    return;
  }

  const result = await db.message.updateMany({
    where: { modStatus: "REVIEW" },
    data: { modStatus: "ALLOWED", modSource: "ADMIN" },
  });

  const webIds = stuck.filter((m) => m.source === "WEB").map((m) => m.id);
  const webResult = webIds.length
    ? await db.message.updateMany({
        where: { id: { in: webIds }, deliveryStatus: "QUEUED" },
        data: { deliveryStatus: "SENT" },
      })
    : { count: 0 };

  console.log(`Released ${result.count} stuck message(s): modStatus REVIEW → ALLOWED.`);
  console.log(`Marked ${webResult.count} web message(s) as delivered (SENT).`);
  console.log("Recipients will now see them in their inbox. ✅");
}

main()
  .catch((e) => {
    console.error("Release failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
