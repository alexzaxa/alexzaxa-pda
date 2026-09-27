// Called by app.py right when the login page's QR tab is opened. Authorization mirrors
// register-store: license_id + fingerprint must match a license_keys row already bound to this
// exact machine, so only a genuinely activated PDA can mint a login token (this doesn't grant
// anything by itself - it's just "a real install is asking to be approved", same trust model as
// the rest of the license/store flow).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const TOKEN_TTL_SECONDS = 180;

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
        const licenseId = String(body?.license_id ?? "").trim();
        const fingerprint = String(body?.fingerprint ?? "").trim();
        const storeName = String(body?.store_name ?? "").trim().slice(0, 120) || null;
        if (!licenseId || !fingerprint) {
            return errorResponse(400, "license_id and fingerprint are required");
        }

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const { data: license, error: licenseError } = await adminClient
            .from("license_keys")
            .select("machine_fingerprint")
            .eq("license_id", licenseId)
            .maybeSingle();
        if (licenseError) throw licenseError;
        if (!license || license.machine_fingerprint !== fingerprint) {
            return errorResponse(403, "This license is not recognized as activated on this computer.");
        }

        const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

        const { error: insertError } = await adminClient.from("pda_login_requests").insert({
            token,
            license_id: licenseId,
            store_name: storeName,
            status: "pending",
            expires_at: expiresAt,
        });
        if (insertError) throw insertError;

        return new Response(
            JSON.stringify({ ok: true, token, expires_in: TOKEN_TTL_SECONDS }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return errorResponse(500, String(err));
    }
});
