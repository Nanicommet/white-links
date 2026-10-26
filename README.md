# WHITE LINKS

Le jeu d'ami secret du **White Line Club ISSIG** — messages anonymes modérés, missions quotidiennes, devinettes et révélation finale, le tout dans l'identité monochrome du club.

> 🚀 **Vous déployez le projet ?** Suivez le guide pas-à-pas : **[DEPLOY.md](./DEPLOY.md)** (GitHub → Supabase → Vercel → WhatsApp → IA, aucune expérience requise).

## Fonctionnalités

- **Manches complètes** : draft → inscriptions → clôture → appariement → jeu → devinettes → révélation → archivage, avec transitions automatiques (cron) et manuelles (console admin).
- **Appariement équitable** : bijection aléatoire, mode croisé A↔B, exclusions, honneur des préférences de récompense des gagnants, vérification d'invariants.
- **Messagerie anonyme** : deux fils (mon ami / mon admirateur), modération en 2 couches (filtres déterministes + IA), file de révision humaine, signalements.
- **WhatsApp** : envoi/réception via l'API Cloud officielle, commandes `1`/`2`, déduplication + vérification de signature. Fonctionne aussi 100 % via le web sans WhatsApp.
- **Console admin** : 9 onglets (vue d'ensemble, manches, participants, modération, récompenses, réglages, intégrations, audit, journal).
- **Sécurité** : sessions HMAC httpOnly, scrypt pour les mots de passe, limitation de débit, journal d'audit, aucune fuite d'identité/téléphone dans les API (testé).
- **i18n** : français / arabe avec support RTL.

## Stack

Next.js 16 (App Router) · TypeScript · Prisma · PostgreSQL (Supabase) · Tailwind CSS 4 · shadcn/ui · TanStack Query · Framer Motion.

## Développement local

```bash
cp .env.example .env        # puis remplissez DATABASE_URL (Supabase) etc.
bun install                 # génère aussi le client Prisma
bun run db:push             # crée les tables (ou: prisma migrate deploy)
bun run dev                 # http://localhost:3000
```

Le compte admin est créé automatiquement au premier lancement avec `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Tests

```bash
bun scripts/test-matching.ts    # moteur d'appariement (18 checks)
bun scripts/test-api.ts         # sécurité API (serveur dev requis)
bun scripts/e2e-lifecycle.ts    # cycle de vie complet (serveur dev requis)
```
