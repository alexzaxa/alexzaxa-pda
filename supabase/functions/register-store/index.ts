// Public - no admin session exists here, same trust model as claim-license. Called directly by
// app.py right after the store owner types their restaurant name into the PDA's first-run setup
// screen (after license activation, before normal use). Authorization comes from proving the
// caller genuinely owns an already-activated license: license_id + fingerprint must match a row
// in license_keys that claim-license already bound to this exact machine. Without that check,
// anyone could spam-create stores with a made-up license_id.
//
// Creates the store and returns its one-time plaintext secret, exactly like the admin dashboard's
// create-store - app.py writes that secret straight into data/income-sync-config.json, which is
// what turns on the existing income-sync/remote-kill-switch background task with no further setup.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function slugify(name: string): string {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

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
        const name = String(body?.name ?? "").trim();
        if (!licenseId || !fingerprint || !name) {
            return errorResponse(400, "license_id, fingerprint, and name are required");
        }
        if (name.length > 120) return errorResponse(400, "Store name is too long");

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

        const { data: existingStore, error: existingError } = await adminClient
            .from("stores")
            .select("id")
            .eq("license_id", licenseId)
            .maybeSingle();
        if (existingError) throw existingError;
        if (existingStore) {
            return errorResponse(
                409,
                "A store is already registered for this license. Contact AlexZaxa PDA Solutions if you need this reset.",
            );
        }

        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = btoa(String.fromCharCode(...secretBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const secretHash = await sha256Hex(secret);
        const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;

        const { data: store, error: insertError } = await adminClient
            .from("stores")
            .insert({ name, slug, secret_hash: secretHash, license_id: licenseId })
            .select("id")
            .single();
        if (insertError) throw insertError;

        return new Response(
            JSON.stringify({ ok: true, store_id: store.id, store_secret: secret }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return errorResponse(500, String(err));
    }
});
