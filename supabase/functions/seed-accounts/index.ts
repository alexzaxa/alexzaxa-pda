// One-time setup function: creates the two initial website accounts by sending Supabase Auth
// invite emails (the recipient sets their own password via the emailed link — this function,
// and the operator running it, never chooses or sees a password). Protected by a setup key
// (a secret set via `supabase secrets set SEED_SETUP_KEY=...`, required as X-Setup-Key), since
// this function has access to the service_role client and must not be callable by the public.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface SeedUser {
    email: string;
    role: "admin" | "restricted";
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const setupKey = req.headers.get("X-Setup-Key") ?? "";
    if (!setupKey || setupKey !== Deno.env.get("SEED_SETUP_KEY")) {
        return new Response(JSON.stringify({ error: "Invalid setup key" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const users: SeedUser[] = [
        { email: "alexzaxa70@gmail.com", role: "admin" },
        { email: "dpoulos@halcor.com", role: "restricted" },
    ];

    const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: Record<string, string> = {};
    for (const u of users) {
        try {
            const { data, error } = await adminClient.auth.admin.inviteUserByEmail(u.email);
            let userId = data?.user?.id;
            if (error) {
                if (String(error.message).toLowerCase().includes("already been registered")) {
                    const { data: list } = await adminClient.auth.admin.listUsers();
                    userId = list?.users?.find((existing) => existing.email === u.email)?.id;
                    results[u.email] = "already existed, role synced";
                } else {
                    throw error;
                }
            } else {
                results[u.email] = "invite sent";
            }

            if (userId) {
                await adminClient.from("profiles").update({ role: u.role }).eq("id", userId);
            }
        } catch (err) {
            results[u.email] = `error: ${String(err)}`;
        }
    }

    return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});
