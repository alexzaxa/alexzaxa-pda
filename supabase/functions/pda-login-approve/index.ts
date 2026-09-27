// Called from pda-login.html after the caller has signed in with Supabase Auth. This is the one
// real authorization check in the whole QR-login flow: it hard-codes the single vendor account
// (alexzaxa70@gmail.com) rather than accepting any admin-role dashboard profile, because this
// grants local admin access on WHICHEVER customer's PDA scanned the code - deliberately narrower
// than is_admin(), which several support-dashboard staff could satisfy.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const AUTHORIZED_EMAIL = "alexzaxa70@gmail.com";

function errorResponse(status: number, error: string): Response {
    return new Response(JSON.stringify({ error }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization") ?? "";
        const callerClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: authHeader } } },
        );
        const { data: userData, error: userError } = await callerClient.auth.getUser();
        if (userError || !userData.user) {
            return errorResponse(401, "Not authenticated");
        }
        if ((userData.user.email ?? "").toLowerCase() !== AUTHORIZED_EMAIL) {
            return errorResponse(403, "Only the AlexZaxa Solutions account can approve PDA admin logins.");
        }

        const body = await req.json().catch(() => ({}));
        const token = String(body?.token ?? "").trim();
        if (!token) return errorResponse(400, "token is required");

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const { data: request_, error: fetchError } = await adminClient
            .from("pda_login_requests")
            .select("status, expires_at")
            .eq("token", token)
            .maybeSingle();
        if (fetchError) throw fetchError;
        if (!request_) return errorResponse(404, "This QR code is invalid or has already expired.");
        if (new Date(request_.expires_at).getTime() < Date.now()) {
            return errorResponse(410, "This QR code has expired.");
        }
        if (request_.status !== "pending") {
            return errorResponse(409, "This QR code has already been used.");
        }

        const { error: updateError } = await adminClient
            .from("pda_login_requests")
            .update({ status: "approved" })
            .eq("token", token)
            .eq("status", "pending");
        if (updateError) throw updateError;

        return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return errorResponse(500, String(err));
    }
});
