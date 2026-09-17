// One-time/idempotent setup function for the public marketing "live demo": creates (or
// refreshes) a fixed-password "restricted" account scoped to exactly one clearly-labeled,
// inactive demo store, seeded with plausible fake daily totals for the trailing 30 days.
// Protected by a setup key (mirrors seed-accounts), since this touches the service_role
// client. Safe to re-run any time - it deletes and reinserts the demo store's totals so the
// dates stay current, and re-syncs the account's password/role/grant rather than duplicating.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const DEMO_STORE_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_EMAIL = "demo@alexzaxa-pda.internal";

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Deterministic PRNG (mulberry32) so re-running produces a similar-looking, still plausible
// spread rather than reshuffling wildly on every refresh.
function seededRandom(seed: number) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const setupKey = req.headers.get("X-Setup-Key") ?? "";
    if (!setupKey || setupKey !== Deno.env.get("DEMO_SETUP_KEY")) {
        return new Response(JSON.stringify({ error: "Invalid setup key" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const demoPassword = Deno.env.get("DEMO_ACCOUNT_PASSWORD");
    if (!demoPassword) {
        return new Response(JSON.stringify({ error: "DEMO_ACCOUNT_PASSWORD secret not set" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    try {
        // 1. Demo store - clearly labeled, inactive (kept out of admin's "active stores" stat;
        // it never runs real PDA software so the kill-switch/install flow never touches it).
        const { error: storeError } = await adminClient.from("stores").upsert({
            id: DEMO_STORE_ID,
            name: "Demo Bistro (public demo - not a real store)",
            slug: "demo-bistro",
            secret_hash: await sha256Hex(crypto.randomUUID()),
            active: false,
        });
        if (storeError) throw storeError;

        // 2. Fresh fake daily totals for the trailing 30 days.
        await adminClient.from("store_daily_totals").delete().eq("store_id", DEMO_STORE_ID);
        const rand = seededRandom(20260101);
        const rows = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() - i);
            const day = d.toISOString().slice(0, 10);
            const isWeekend = [0, 6].includes(d.getUTCDay());
            const orders = Math.round((isWeekend ? 55 : 32) + rand() * (isWeekend ? 25 : 15));
            const avgTicketCents = 1450 + Math.round(rand() * 500);
            rows.push({ store_id: DEMO_STORE_ID, day, orders, total_cents: orders * avgTicketCents });
        }
        const { error: totalsError } = await adminClient.from("store_daily_totals").insert(rows);
        if (totalsError) throw totalsError;

        // 3. Demo Auth account - fixed email/password, role=restricted, scoped ONLY to the demo
        // store (any other grant is defensively revoked so it can never see real data).
        let demoUserId: string | undefined;
        const { data: created, error: createError } = await adminClient.auth.admin.createUser({
            email: DEMO_EMAIL,
            password: demoPassword,
            email_confirm: true,
        });
        if (createError) {
            if (!String(createError.message).toLowerCase().includes("already been registered")) throw createError;
            const { data: list } = await adminClient.auth.admin.listUsers();
            demoUserId = list?.users?.find((u) => u.email === DEMO_EMAIL)?.id;
            if (demoUserId) await adminClient.auth.admin.updateUserById(demoUserId, { password: demoPassword });
        } else {
            demoUserId = created.user.id;
        }
        if (!demoUserId) throw new Error("Could not resolve demo user id");

        await adminClient.from("profiles").update({ role: "restricted" }).eq("id", demoUserId);
        await adminClient.from("store_access").delete().eq("profile_id", demoUserId).neq("store_id", DEMO_STORE_ID);
        await adminClient.from("store_access").upsert({ profile_id: demoUserId, store_id: DEMO_STORE_ID });

        return new Response(JSON.stringify({ ok: true, email: DEMO_EMAIL, storeId: DEMO_STORE_ID, days: rows.length }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
