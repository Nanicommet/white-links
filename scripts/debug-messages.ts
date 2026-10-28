// Debug helper: dump recent Message rows (moderation status) — local use only.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const msgs = await p.message.findMany({
  orderBy: { createdAt: "desc" },
  take: 8,
  select: { body: true, modStatus: true, modReason: true, modExplanation: true, deliveryStatus: true, createdAt: true },
});
for (const m of msgs) {
  console.log(JSON.stringify({ modStatus: m.modStatus, modReason: m.modReason, deliveryStatus: m.deliveryStatus, body: m.body.slice(0, 70) }));
}
await p.$disconnect();
