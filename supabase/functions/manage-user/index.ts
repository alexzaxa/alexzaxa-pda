// Admin-only. Account-management actions that don't belong in the other user-management
// functions:
//  - create_username_login: create a real login authenticated by username+password instead of
//    an email invite - same synthetic-email trick as download accounts (see
//    manage-download-user), just usable for 'restricted' or 'admin' roles too, not just
//    'download'.
//  - promote: grant admin role to any existing profile. profiles has no client write RLS policy
//    at all (see init_schema.sql) - this endpoint, backed by service_role, is intentionally the
//    only way a role can change from the app.
//  - delete: permanently remove a login (any role). Blocks deleting your own account so an
//    admin can never lock themselves out from this UI - that still has to be done deliberately,
//    from a second admin account or directly in Supabase.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Same non-deliverable placeholder domain manage-download-user and assets/supabase-client.js's
// usernameToEmail() use - Supabase Auth needs an email-shaped identifier internally even for a
// username-only login.
const USERNAME_EMAIL_DOMAIN = "downloads.alexzaxa-pda.internal";

function usernameToEmail(username: string): string {
    return `${username.toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
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
        const { data: callerProfile } = await callerClient
            .from("profiles").select("role").eq("id", userData.user.id).single();
        if (callerProfile?.role !== "admin") {
            return new Response(JSON.stringify({ error: "Admin access required" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = await req.json();
        const action = String(body?.action ?? "");
        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        if (action === "create_username_login") {
            const username = String(body?.username ?? "").trim().toLowerCase();
            const password = String(body?.password ?? "");
            const role = String(body?.role ?? "restricted");
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
            if (!["admin", "restricted"].includes(role)) {
                return new Response(JSON.stringify({ error: "role must be 'admin' or 'restricted'" }), {
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
                .update({ role, username })
                .eq("id", created.user.id);
            if (profileError) throw profileError;
            return new Response(JSON.stringify({ ok: true, username, role }), {
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
            if (userId === userData.user.id) {
                return new Response(JSON.stringify({ error: "You can't delete your own account here." }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
            if (deleteError) throw deleteError;
            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (action === "promote") {
            const userId = String(body?.user_id ?? "");
            if (!userId) {
                return new Response(JSON.stringify({ error: "user_id required" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            const { error: updateError } = await adminClient
                .from("profiles").update({ role: "admin" }).eq("id", userId);
            if (updateError) throw updateError;
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
