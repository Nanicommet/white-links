import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/bootstrap";

export const runtime = "nodejs";

// Account recovery: creates a reset request for club administrators.
// No email provider is configured in this environment, so the honest
// flow is: request → admin reviews → admin sets a temporary password.
export async function POST(req: Request) {
  await ensureBootstrap();
  try {
    const { email } = (await req.json()) as { email?: string };
    if (!email) return Response.json({ error: "MISSING_EMAIL" }, { status: 400 });
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    // Always return ok (do not leak which emails exist)
    if (user) {
      const open = await db.passwordResetRequest.findFirst({
        where: { userId: user.id, status: "OPEN" },
      });
      if (!open) {
        await db.passwordResetRequest.create({ data: { userId: user.id } });
      }
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
}
