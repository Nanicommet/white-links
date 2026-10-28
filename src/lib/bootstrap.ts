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
  // SECURITY: the admin account is only created when explicit credentials
  // are provided via environment variables. No default password fallback —
  // a known default would let anyone take over a freshly deployed instance.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
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
  } else {
    console.warn(
      "[bootstrap] ADMIN_EMAIL / ADMIN_PASSWORD not set — admin account not created. Set both in your environment (see .env.example)."
    );
  }
  bootstrapped = true;
}
