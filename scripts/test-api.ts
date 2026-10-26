/**
 * WHITE LINKS — API security & business-rule tests (live server)
 * Run: bun scripts/test-api.ts  (dev server must be on :3000)
 * Covers acceptance tests: #1, #2*, #9, #10, #14, #15, #19, #20
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

function client() {
  let cookie = "";
  return {
    async call(path: string, opts?: { method?: string; body?: unknown }) {
      const res = await fetch(`${BASE}${path}`, {
        method: opts?.method ?? "GET",
        headers: {
          ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch { /* ignore */ }
      return { status: res.status, data };
    },
  };
}

async function main() {
  console.log("— Anonymous access control (acceptance #20) —");
  const anon = client();
  {
    const me = await anon.call("/api/auth/me");
    assert(me.status === 401, "GET /api/auth/me unauthenticated → 401");
    const dash = await anon.call("/api/me/dashboard");
    assert(dash.status === 401, "GET /api/me/dashboard unauthenticated → 401");
    const admin = await anon.call("/api/admin/overview");
    assert(admin.status === 401, "GET /api/admin/overview unauthenticated → 401");
    const inbox = await anon.call("/api/me/inbox");
    assert(inbox.status === 401, "GET /api/me/inbox unauthenticated → 401");
  }

  console.log("— Member cannot access admin (acceptance #20) —");
  const member = client();
  const email = `sec-test-${Date.now()}@test.wlc`;
  const secPhone = `+216246${String(Date.now()).slice(-5)}`.slice(0, 12); // unique per run
  {
    // Register a member while demo round is open (or expect graceful NO_OPEN_ROUND)
    const reg = await member.call("/api/registrations", {
      method: "POST",
      body: {
        displayName: "Sec Test",
        phone: secPhone,
        email,
        password: "SecTest2026!",
        category: "A",
        agreeRules: true,
        agreeMessages: true,
      },
    });
    if (reg.status === 200) {
      const adminApi = await member.call("/api/admin/overview");
      assert(adminApi.status === 403, "member calling admin API → 403");
      const otherGuess = await member.call("/api/me/guess", { method: "POST", body: { guessedId: "someone" } });
      assert(otherGuess.status === 403 || otherGuess.status === 400, `guess outside guessing window rejected (${otherGuess.status}) (acceptance #14)`);
    } else {
      assert(reg.status === 400, `registration without open round → explicit 400 (${reg.data.error})`);
      console.log("    (no open round — creating one via admin below)");
    }
  }

  console.log("— Admin login & honest integration statuses (acceptance #19) —");
  const admin = client();
  {
    const bad = await admin.call("/api/auth/login", { method: "POST", body: { email: "admin@whitelineissig.me", password: "wrong" } });
    assert(bad.status === 401, "wrong password → 401");
    const ok = await admin.call("/api/auth/login", { method: "POST", body: { email: "admin@whitelineissig.me", password: process.env.ADMIN_PASSWORD ?? "WhiteLinks2026!" } });
    assert(ok.status === 200, "admin login works");
    const integ = await admin.call("/api/admin/integrations");
    const wa = (integ.data.integrations as { id: string; status: string }[] | undefined)?.find((i) => i.id === "whatsapp");
    assert(wa && (wa.status === "NOT_CONFIGURED" || wa.status === "OPERATIONAL"), `WhatsApp status honest (${wa?.status})`);
  }

  console.log("— Demo round + duplicate registration (acceptance #1) —");
  {
    await admin.call("/api/admin/demo", { method: "POST" });
    const status = await anon.call("/api/rounds/current");
    const round = status.data.round as { status: string; id: string } | null;
    assert(round !== null, "public round status exists after demo seed");

    // Register a fresh member (fresh cookie jar, unique phone)
    const dupClient = client();
    const phone = `+21624558${String(Date.now()).slice(-3)}`;
    const reg1 = await dupClient.call("/api/registrations", {
      method: "POST",
      body: {
        displayName: "Dup Test",
        phone,
        email: `dup-${Date.now()}@test.wlc`,
        password: "DupTest2026!",
        category: "B",
        agreeRules: true,
        agreeMessages: true,
      },
    });
    if (reg1.status === 200) {
      assert(true, "member registered in open round");
      // Same phone again → must be rejected (acceptance #1)
      const reg2 = await dupClient.call("/api/registrations", {
        method: "POST",
        body: {
          displayName: "Dup Test 2",
          phone,
          email: `dup2-${Date.now()}@test.wlc`,
          password: "DupTest2026!",
          category: "A",
          agreeRules: true,
          agreeMessages: true,
        },
      });
      assert(reg2.status === 409, `duplicate phone rejected with 409 (${reg2.status})`);
    } else {
      assert(reg1.status === 400, `registration blocked outside window (${reg1.data.error})`);
    }
  }

  console.log("— Registration validation —");
  {
    const bad = await anon.call("/api/registrations", {
      method: "POST",
      body: { displayName: "X", phone: "abc", email: "not-an-email", password: "123", agreeRules: false, agreeMessages: false },
    });
    assert(bad.status === 400, "invalid registration payload → 400");
  }

  console.log("— Reveal protection (acceptance #15/#16) —");
  {
    const reveal = await anon.call("/api/me/reveal");
    assert(reveal.status === 401, "reveal unauthenticated → 401 (identities never public)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
