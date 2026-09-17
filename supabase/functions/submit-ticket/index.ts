// Public, unauthenticated - called from help.html by restaurant staff with no site login.
// Writes with service_role (support_tickets has no public insert policy - see the
// ticket_rate_limiting migration), so this function is the only path a ticket can be created
// through. That's what makes the two defenses below actually mean something instead of being
// cosmetic client-side checks a script could just skip by calling PostgREST directly.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const CATEGORIES = ["technical", "how_to", "billing", "other", "new_store"];
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5; // submissions per IP per window

function clientIp(req: Request): string {
    const forwarded = req.headers.get("x-forwarded-for") ?? "";
    return forwarded.split(",")[0].trim() || "unknown";
}

function badRequest(message: string) {
    return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const body = await req.json();

        // Honeypot: a real user never fills this (it's hidden off-screen in help.html); anything
        // that does is almost certainly a bot filling every field it can find. Return a normal
        // "ok" response anyway so the bot has no signal it was caught.
        if (String(body?.website ?? "").trim()) {
            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const store_name = String(body?.store_name ?? "").trim();
        const contact_name = String(body?.contact_name ?? "").trim();
        const contact_info = String(body?.contact_info ?? "").trim();
        const category = String(body?.category ?? "");
        const message = String(body?.message ?? "").trim();

        if (!store_name || store_name.length > 200) return badRequest("store_name is required (max 200 chars)");
        if (!contact_name || contact_name.length > 200) return badRequest("contact_name is required (max 200 chars)");
        if (!contact_info || contact_info.length > 200) return badRequest("contact_info is required (max 200 chars)");
        if (!CATEGORIES.includes(category)) return badRequest("category must be one of: " + CATEGORIES.join(", "));
        if (!message || message.length > 5000) return badRequest("message is required (max 5000 chars)");

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        // Per-IP rate limit: fixed window, reset once it's stale. A read-then-write race under
        // simultaneous requests from the same IP could let a couple of extra ones through - fine
        // for what this defends against (script spam), not worth a stored procedure for.
        const ip = clientIp(req);
        const now = Date.now();
        const { data: existing } = await adminClient
            .from("ticket_rate_limits")
            .select("window_start, count")
            .eq("ip", ip)
            .maybeSingle();

        if (existing && now - new Date(existing.window_start).getTime() < RATE_LIMIT_WINDOW_MS) {
            if (existing.count >= RATE_LIMIT_MAX) {
                return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
                    status: 429,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            await adminClient.from("ticket_rate_limits").update({ count: existing.count + 1 }).eq("ip", ip);
        } else {
            await adminClient.from("ticket_rate_limits")
                .upsert({ ip, window_start: new Date(now).toISOString(), count: 1 });
        }

        const { error: insertError } = await adminClient.from("support_tickets").insert({
            store_name, contact_name, contact_info, category, message,
        });
        if (insertError) throw insertError;

        return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
