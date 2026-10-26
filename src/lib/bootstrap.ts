import { db } from "@/lib/db";
import { hashPassword } from "@/lib/phone";

// ── Idempotent bootstrap: settings singleton + admin account ─────

let bootstrapped = false;

export async function ensureBootstrap(): Promise<void> {
  if (bootstrapped) return;
  await db.settings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@whitelineissig.me";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "WhiteLinks2026!";
  const existing = await db.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    await db.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashPassword(adminPassword),
        displayName: "Bureau WLC",
        phone: "+21600000000",
        role: "ADMIN",
        phoneVerified: true,
      },
    });
  }
  bootstrapped = true;
}
