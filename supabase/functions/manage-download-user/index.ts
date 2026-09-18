// Admin-only. Creates or deletes a "download" account: username + password only, no email.
// Supabase Auth still needs an email-shaped identifier internally, so one is derived
// deterministically from the username (see DOWNLOAD_EMAIL_DOMAIN) - it is never real or
// deliverable. The admin sets the password directly here and tells the person in person/by
// phone; there is no invite email for these accounts (that's the whole point of this endpoint).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logAudit } from "../_shared/audit.ts";

const DOWNLOAD_EMAIL_DOMAIN = "downloads.alexzaxa-pda.internal";

function usernameToEmail(username: string): string {
    return `${username.toLowerCase()}@${DOWNLOAD_EMAIL_DOMAIN}`;
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
        const action = String(body?.action ?? "create");
        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        if (action === "create") {
            const username = String(body?.username ?? "").trim().toLowerCase();
            const password = String(body?.password ?? "");
            if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
                return new Response(JSON.stringify({ error: "Username must be 3-32 characters: letters, numbers, - or _ only" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            if (password.length < 8) {
                return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            const { data: created, error: createError } = await adminClient.auth.admin.createUser({
                email: usernameToEmail(username),
                password,
                email_confirm: true,
            });
            if (createError) throw createError;
            const { error: profileError } = await adminClient
                .from("profiles")
                .update({ role: "download", username })
                .eq("id", created.user.id);
            if (profileError) throw profileError;
            await logAudit(adminClient, userData.user, "create_download_user", username);
            return new Response(JSON.stringify({ ok: true, username }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (action === "delete") {
            const userId = String(body?.user_id ?? "");
            if (!userId) {
                return new Response(JSON.stringify({ error: "user_id required" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            const { data: targetProfile } = await adminClient
                .from("profiles").select("username").eq("id", userId).single();
            const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
            if (deleteError) throw deleteError;
            await logAudit(adminClient, userData.user, "delete_download_user", targetProfile?.username || userId);
            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
