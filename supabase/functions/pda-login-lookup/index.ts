// Public - called by pda-login.html (before the vendor signs in) to show "you're about to approve
// admin login for <store>" rather than a blind Approve button. Read-only, and only ever returns
// the handful of fields needed to display that confirmation - never anything from license_keys
// or stores themselves.
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
        const url = new URL(req.url);
        const token = (req.method === "GET" ? url.searchParams.get("token") : (await req.json().catch(() => ({})))?.token) ?? "";
        if (!token) return errorResponse(400, "token is required");

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const { data: request_, error } = await adminClient
            .from("pda_login_requests")
            .select("license_id, store_name, status, expires_at")
            .eq("token", token)
            .maybeSingle();
        if (error) throw error;
        if (!request_) return errorResponse(404, "This QR code is invalid or has already expired. Refresh it on the PDA and scan again.");
        if (new Date(request_.expires_at).getTime() < Date.now()) {
            return errorResponse(410, "This QR code has expired. Refresh it on the PDA and scan again.");
        }
        if (request_.status !== "pending") {
            return errorResponse(409, "This QR code has already been used.");
        }

        return new Response(
            JSON.stringify({ ok: true, license_id: request_.license_id, store_name: request_.store_name }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return errorResponse(500, String(err));
    }
});
