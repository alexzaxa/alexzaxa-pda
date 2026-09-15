// Admin-only. Creates a new store and returns its one-time plaintext secret.
// The secret is hashed before storage; this response is the only time it is ever visible.
// Called from the admin dashboard with the caller's own Supabase Auth session (their JWT),
// which is what lets us verify they're actually an admin before doing anything privileged.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 60);
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization") ?? "";

        // Client scoped to the caller's own JWT — used only to confirm who they are.
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

        const { data: profile, error: profileError } = await callerClient
            .from("profiles")
            .select("role")
            .eq("id", userData.user.id)
            .single();
        if (profileError || profile?.role !== "admin") {
            return new Response(JSON.stringify({ error: "Admin access required" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = await req.json();
        const name = String(body?.name ?? "").trim();
        if (!name) {
            return new Response(JSON.stringify({ error: "name is required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = btoa(String.fromCharCode(...secretBytes))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
        const secretHash = await sha256Hex(secret);
        const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;

        // Privileged write — service_role is injected by the platform, never sent to any client.
        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: store, error: insertError } = await adminClient
            .from("stores")
            .insert({ name, slug, secret_hash: secretHash })
            .select("id, name, slug, created_at")
            .single();
        if (insertError) throw insertError;

        return new Response(
            JSON.stringify({ store, secret }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
