// Operator-only. Records a published release in pda_releases (backs the changelog page).
// The zip and latest.json themselves are uploaded straight to Storage by
// scripts/publish-release.ps1 using the operator's own Supabase CLI access token (a different,
// narrower credential than service_role) — this function only needs to write the one DB row,
// which has no client insert policy, so it goes through here using the auto-injected
// service_role. Protected by the same setup key as seed-accounts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const setupKey = req.headers.get("X-Setup-Key") ?? "";
    if (!setupKey || setupKey !== Deno.env.get("SEED_SETUP_KEY")) {
        return new Response(JSON.stringify({ error: "Invalid setup key" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    try {
        const body = await req.json();
        const { version, sha256, storage_path, notes } = body ?? {};
        if (!version || !sha256 || !storage_path) {
            return new Response(
                JSON.stringify({ error: "version, sha256, storage_path are required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data, error } = await adminClient
            .from("pda_releases")
            .upsert({ version, sha256, storage_path, notes: notes ?? null }, { onConflict: "version" })
            .select()
            .single();
        if (error) throw error;

        return new Response(JSON.stringify({ release: data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
