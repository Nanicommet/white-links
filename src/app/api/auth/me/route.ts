import { getSessionUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";

export const runtime = "nodejs";

export async function GET() {
  await ensureBootstrap();
  const user = await getSessionUser();
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user });
}
