// Called by every restaurant PDA install periodically (mirrors the update-check pattern) to ask
// "am I still allowed to run?". Authenticates the same way sync-order does: X-Store-Secret,
// never a Supabase key of any kind. Deliberately returns only {active: boolean} - nothing else
// about the store (name, other stores, etc.) is exposed here.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const storeSecret = req.headers.get("X-Store-Secret") ?? "";
    if (!storeSecret) {
        return new Response(JSON.stringify({ error: "X-Store-Secret header required" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const secretHash = await sha256Hex(storeSecret);
    const { data: store, error } = await adminClient
        .from("stores")
        .select("id, active")
        .eq("secret_hash", secretHash)
        .maybeSingle();

    if (error || !store) {
        return new Response(JSON.stringify({ error: "Invalid store credential" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // Best-effort - a store's active/inactive answer must still go out even if this write fails.
    await adminClient.from("stores").update({ last_seen_at: new Date().toISOString() }).eq("id", store.id);

    return new Response(JSON.stringify({ active: store.active }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});
