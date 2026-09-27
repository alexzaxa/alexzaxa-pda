// Polled by app.py every couple of seconds while the QR is on screen. The token itself is the
// only credential here (same shape as store-status's X-Store-Secret) - whoever holds it already
// proved they're the PDA that started this request, so no separate auth is needed. The
// approved->consumed flip is conditional on the current row still being "approved", so two
// concurrent polls can't both report success for the same login.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function errorResponse(status: number, error: string): Response {
    return new Response(JSON.stringify({ error }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const body = await req.json().catch(() => ({}));
        const token = String(body?.token ?? "").trim();
        if (!token) return errorResponse(400, "token is required");

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const { data: updated, error: updateError } = await adminClient
            .from("pda_login_requests")
            .update({ status: "consumed" })
            .eq("token", token)
            .eq("status", "approved")
            .select("license_id")
            .maybeSingle();
        if (updateError) throw updateError;

        return new Response(JSON.stringify({ ok: true, approved: Boolean(updated) }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return errorResponse(500, String(err));
    }
});
