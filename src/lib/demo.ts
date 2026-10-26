import { db } from "@/lib/db";
import { hashPassword, normalizePhone } from "@/lib/phone";
import { audit } from "@/lib/audit";

// ── Demo environment seeding (clearly labelled, isolated) ────────
// Demo members all carry isDemo=true and rounds isDemo=true so they
// can be told apart from production data at a glance.

const DEMO_MEMBERS: { name: string; email: string; phone: string; cat: "A" | "B"; interests: string; gifts: string }[] = [
  { name: "Yasmine Ben Salah", email: "yasmine@demo.wlc", phone: "+21624551001", cat: "A", interests: "Lecture romans policiers, séries médicales, pâtisserie", gifts: "Notes motivantes, citations inspirantes" },
  { name: "Ahmed Trabelsi", email: "ahmed@demo.wlc", phone: "+21624551002", cat: "B", interests: "Football, jeux vidéo, tech", gifts: "Blagues, mèmes (pas de liens), encouragements avant les exams" },
  { name: "Mariem Gharbi", email: "mariem@demo.wlc", phone: "+21624551003", cat: "A", interests: "Dessin, musique, chats", gifts: "Compliments sur mes dessins, playlists" },
  { name: "Youssef Hammami", email: "youssef@demo.wlc", phone: "+21624551004", cat: "B", interests: "Basket, cuisine, voyages", gifts: "Recettes faciles, mots doux" },
  { name: "Nour Jelassi", email: "nour@demo.wlc", phone: "+21624551005", cat: "A", interests: "Photographie, astronomy, romans", gifts: "Faits étonnants, photos motivantes" },
  { name: "Karim Bouazizi", email: "karim@demo.wlc", phone: "+21624551006", cat: "B", interests: "Gaming, films d'action, sport", gifts: "Messages drôles, défis amusants" },
  { name: "Salma Ferchichi", email: "salma@demo.wlc", phone: "+21624551007", cat: "A", interests: "Mode, make-up, séries", gifts: "Compliments sincères, conseils study" },
  { name: "Bilel Mansouri", email: "bilel@demo.wlc", phone: "+21624551008", cat: "B", interests: "Musique rap, fitness, voitures", gifts: "Citations de motivation, énergie positive" },
  { name: "Ines Chaabane", email: "ines@demo.wlc", phone: "+21624551009", cat: "A", interests: "Cuisine, bénévolat, enfants", gifts: "Mots de gratitude, souvenirs du club" },
  { name: "Hamza Rebai", email: "hamza@demo.wlc", phone: "+21624551010", cat: "B", interests: "Sciences, échecs, randonnée", gifts: "Énigmes, faits scientifiques" },
];

export async function seedDemo(): Promise<{ ok: boolean; message: string; roundId?: string; credentials?: string }> {
  const demoPassword = "Demo2026!";
  const userIds: string[] = [];

  for (const m of DEMO_MEMBERS) {
    const phone = normalizePhone(m.phone)!;
    const user = await db.user.upsert({
      where: { email: m.email },
      update: { displayName: m.name, phone, isDemo: true },
      create: {
        email: m.email,
        passwordHash: hashPassword(demoPassword),
        displayName: m.name,
        phone,
        role: "MEMBER",
        phoneVerified: true,
        isDemo: true,
      },
    });
    userIds.push(user.id);
  }

  const now = new Date();
  const regStart = new Date(now.getTime() - 24 * 3600 * 1000);
  const regEnd = new Date(now.getTime() + 24 * 3600 * 1000);

  const existingRound = await db.round.findFirst({
    where: { isDemo: true, status: { in: ["registration_open", "active", "guessing_open"] } },
  });
  if (existingRound) {
    return { ok: true, message: "Une manche démo existe déjà.", roundId: existingRound.id };
  }

  const round = await db.round.create({
    data: {
      name: "Manche Démo WHITE LINKS",
      status: "registration_open",
      registrationStart: regStart,
      registrationEnd: regEnd,
      matchingMode: "CROSS_CATEGORY",
      isDemo: true,
      messageMaxLength: 500,
    },
  });

  for (let i = 0; i < DEMO_MEMBERS.length; i++) {
    const m = DEMO_MEMBERS[i];
    await db.registration.create({
      data: {
        roundId: round.id,
        userId: userIds[i],
        phone: normalizePhone(m.phone)!,
        category: m.cat,
        interests: m.interests,
        giftPrefs: m.gifts,
        consentRulesAt: now,
        consentMessages: true,
        verificationStatus: "APPROVED",
        status: "ACTIVE",
      },
    });
  }

  await audit(null, "system", "DEMO_SEEDED", round.id, {
    members: DEMO_MEMBERS.length,
    mode: "CROSS_CATEGORY",
  });

  return {
    ok: true,
    message: "Données de démonstration créées : 10 membres (5 A / 5 B), inscriptions ouvertes.",
    roundId: round.id,
    credentials: "Membres démo : prenom@demo.wlc / Demo2026!",
  };
}
