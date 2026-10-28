import { db } from "@/lib/db";
import { getSessionUser, jsonError } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { normalizePhone } from "@/lib/phone";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { tick } from "@/lib/lifecycle";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  displayName: z.string().trim().min(3).max(80),
  phone: z.string().trim().min(6),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(100),
  category: z.enum(["A", "B"]),
  interests: z.string().trim().max(500).optional().or(z.literal("")),
  giftPrefs: z.string().trim().max(500).optional().or(z.literal("")),
  agreeRules: z.literal(true),
  agreeMessages: z.boolean(),
});

export async function POST(req: Request) {
  await ensureBootstrap();
  await tick();
  try {
    // Anti-spam: 10 registration attempts per IP per hour
    if (!rateLimit(`reg:${clientIp(req)}`, 10, 3600 * 1000)) {
      return jsonError("RATE_LIMITED", 429);
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[String(issue.path[0])] = "INVALID";
      }
      return Response.json({ error: "VALIDATION", fieldErrors }, { status: 400 });
    }
    const data = parsed.data;

    // The registration target is the currently-open round
    const round = await db.round.findFirst({
      where: { status: "registration_open" },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return jsonError("NO_OPEN_ROUND", 400);
    const now = new Date();
    if (now < round.registrationStart || now >= round.registrationEnd) {
      return jsonError("REGISTRATION_CLOSED", 400);
    }

    const phone = normalizePhone(data.phone);
    if (!phone) {
      return Response.json(
        { error: "VALIDATION", fieldErrors: { phone: "INVALID_PHONE" } },
        { status: 400 }
      );
    }

    // Duplicate checks (same phone OR same user already registered in this round)
    const dupPhone = await db.registration.findFirst({
      where: { roundId: round.id, phone, status: { in: ["ACTIVE", "WITHDRAWN"] } },
    });
    if (dupPhone && dupPhone.status === "ACTIVE") {
      return jsonError("DUPLICATE_PHONE", 409);
    }
    if (dupPhone && dupPhone.status === "WITHDRAWN") {
      return jsonError("WITHDRAWN_BEFORE_DEADLINE", 409);
    }

    // Account: reuse session user if logged in, else find/create by email
    const sessionUser = await getSessionUser();
    let userId: string;
    if (sessionUser) {
      userId = sessionUser.id;
      const existingReg = await db.registration.findUnique({
        where: { roundId_userId: { roundId: round.id, userId } },
      });
      if (existingReg && existingReg.status === "ACTIVE") return jsonError("ALREADY_REGISTERED", 409);
      if (existingReg && existingReg.status === "WITHDRAWN") return jsonError("WITHDRAWN_BEFORE_DEADLINE", 409);
      await db.user.update({
        where: { id: userId },
        data: { displayName: data.displayName, phone },
      });
    } else {
      const existingByEmail = await db.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });
      if (existingByEmail) {
        // SECURITY: an account can only be reused (and updated) by someone
        // who proves ownership with its current password. Otherwise this
        // endpoint would hand out a session for any known email.
        const { verifyPassword } = await import("@/lib/phone");
        if (!verifyPassword(data.password, existingByEmail.passwordHash)) {
          return jsonError("EMAIL_TAKEN", 409);
        }
        userId = existingByEmail.id;
        const existingReg = await db.registration.findUnique({
          where: { roundId_userId: { roundId: round.id, userId } },
        });
        if (existingReg && existingReg.status === "ACTIVE") return jsonError("ALREADY_REGISTERED", 409);
        if (existingReg && existingReg.status === "WITHDRAWN") return jsonError("WITHDRAWN_BEFORE_DEADLINE", 409);
        await db.user.update({ where: { id: userId }, data: { displayName: data.displayName, phone } });
      } else {
        const { hashPassword } = await import("@/lib/phone");
        const created = await db.user.create({
          data: {
            email: data.email.toLowerCase(),
            passwordHash: hashPassword(data.password),
            displayName: data.displayName,
            phone,
            role: "MEMBER",
            phoneVerified: false, // unverified → requires admin approval before matching
          },
        });
        userId = created.id;
      }
    }

    // Unverified phones require administrator approval before matching
    const user = await db.user.findUnique({ where: { id: userId } });
    const verificationStatus = user?.phoneVerified ? "APPROVED" : "PENDING";

    const registration = await db.registration.create({
      data: {
        roundId: round.id,
        userId,
        phone,
        category: data.category,
        interests: data.interests || null,
        giftPrefs: data.giftPrefs || null,
        consentRulesAt: now,
        consentMessages: data.agreeMessages,
        verificationStatus,
        status: "ACTIVE",
      },
    });

    await notify({
      userId,
      roundId: round.id,
      type: "REGISTRATION_CONFIRMED",
      title: "Inscription confirmée ✅",
      body: verificationStatus === "PENDING"
        ? "Ton inscription est enregistrée. Le club doit valider ton numéro avant le tirage — c'est rapide !"
        : "Ton inscription est validée. Rendez-vous au lancement de la manche !",
      dedupeKey: `reg-confirm:${registration.id}`,
    });
    await audit(null, "system", "REGISTRATION_CREATED", registration.id, { roundId: round.id });

    const { setSessionCookie } = await import("@/lib/auth");
    await setSessionCookie(userId);

    return Response.json({
      ok: true,
      registrationId: registration.id,
      verificationStatus,
      round: { id: round.id, name: round.name, registrationEnd: round.registrationEnd },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return jsonError("DUPLICATE", 409);
    return jsonError("BAD_REQUEST", 400);
  }
}
