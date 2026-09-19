// Admin-only. Invites a new restricted-dashboard user by email, without needing the Supabase
// dashboard: sends Supabase's built-in invite email (magic link to set a password). The
// on_auth_user_created trigger (see init_schema.sql) auto-creates the matching profiles row
// with role='restricted' the moment the auth.users row exists, so the invitee shows up in
// admin.html's "Restricted account" picker immediately, before they even open the email.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logAudit } from "../_shared/audit.ts";

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
            return new Response(JSON.stringify({ error: "Not authenticated" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        const { data: profile } = await callerClient
            .from("profiles").select("role").eq("id", userData.user.id).single();
        if (profile?.role !== "admin") {
            return new Response(JSON.stringify({ error: "Admin access required" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = await req.json();
        const email = String(body?.email ?? "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return new Response(JSON.stringify({ error: "Enter a valid email address" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Privileged write — service_role is injected by the platform, never sent to any client.
        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);
        if (inviteError) throw inviteError;

        await logAudit(adminClient, userData.user, "invite_user", email);

        return new Response(
            JSON.stringify({ ok: true, user: { id: invited.user.id, email: invited.user.email } }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
