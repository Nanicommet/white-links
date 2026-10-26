// @ts-nocheck
// Starts an embedded PostgreSQL on port 54329 for local verification.
// Usage: bun run /home/z/my-project/scripts/start-pg.ts [--stop]
import { join } from "path";
import { homedir } from "os";

const PKG = "/tmp/pgtest/node_modules/@embedded-postgres/linux-x64/native";
const DATA = "/tmp/pgtest/pgdata";
const PORT = 54329;

async function sh(cmd: string, args: string[]): Promise<void> {
  const p = Bun.spawn([join(PKG, "bin", cmd), ...args], {
    env: { ...process.env, LD_LIBRARY_PATH: join(PKG, "lib") },
    stdout: "pipe", stderr: "pipe",
  });
  const code = await p.exited;
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  if (code !== 0) throw new Error(`${cmd} failed (${code}): ${err || out}`);
  if (out.trim()) console.log(out.trim());
}

if (process.argv.includes("--stop")) {
  try {
    await sh("pg_ctl", ["-D", DATA, "stop", "-m", "fast"]);
  } catch (e) {
    console.log("stop:", (e as Error).message.split("\n")[0]);
  }
  process.exit(0);
}

// Already running?
const probe = Bun.spawn(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${PORT} && echo open`], { stdout: "pipe" });
const probeOut = await new Response(probe.stdout).text();
await probe.exited;
if (probeOut.includes("open")) {
  console.log(`Postgres already running on ${PORT}`);
  process.exit(0);
}

console.log("Initializing data dir…");
await sh("initdb", ["-D", DATA, "-U", "postgres", "-A", "trust", "-E", "UTF8"]);

// Configure unix socket dir + port
await Bun.write(
  join(DATA, "postgresql.conf"),
  `\nport = ${PORT}\nunix_socket_directories = '/tmp/pgtest'\nlisten_addresses = '127.0.0.1'\n`
);

console.log("Starting postgres…");
Bun.spawn([join(PKG, "bin", "pg_ctl"), "-D", DATA, "-l", "/tmp/pgtest/pg.log", "start"], {
  env: { ...process.env, LD_LIBRARY_PATH: join(PKG, "lib") },
  stdout: "pipe", stderr: "pipe",
});

// Wait for readiness
let ready = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const p = Bun.spawn(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${PORT} && echo open`], { stdout: "pipe" });
  const o = await new Response(p.stdout).text();
  await p.exited;
  if (o.includes("open")) { ready = true; break; }
}
if (!ready) {
  console.error("Postgres failed to start. Log tail:");
  console.error(await Bun.file("/tmp/pgtest/pg.log").text().catch(() => ""));
  process.exit(1);
}
console.log(`Postgres ready on 127.0.0.1:${PORT}`);
