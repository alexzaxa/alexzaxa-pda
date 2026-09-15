// Operator-only. Publishes a PDA release: uploads the zip AND latest.json to Storage (both
// upsert:true, so re-publishing the same version safely overwrites rather than colliding), and
// records the release in pda_releases (backs the changelog/download pages). Everything routes
// through the auto-injected service_role client here rather than the operator's own machine
// calling Storage directly - the Supabase CLI's `storage cp`/`rm` proved unreliable for
// overwriting an existing object (silently no-op on rm, hard 409 on cp), so this sidesteps that
// entirely rather than depending on it. Protected by the same setup key as seed-accounts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
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

    try {
        const body = await req.json();
        const { version, sha256, notes, zip_base64 } = body ?? {};
        if (!version || !sha256 || !zip_base64) {
            return new Response(
                JSON.stringify({ error: "version, sha256, zip_base64 are required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const storagePath = `releases/alexzaxa-pda-${version}.zip`;
        const zipBytes = base64ToBytes(zip_base64);

        const { error: uploadError } = await adminClient.storage
            .from("pda-releases")
            .upload(storagePath, zipBytes, { contentType: "application/zip", upsert: true });
        if (uploadError) throw uploadError;

        const manifest = JSON.stringify({
            version,
            sha256,
            url: `${supabaseUrl}/storage/v1/object/public/pda-releases/${storagePath}`,
        });
        const { error: manifestError } = await adminClient.storage
            .from("pda-releases")
            .upload("latest.json", new TextEncoder().encode(manifest), {
                contentType: "application/json",
                upsert: true,
            });
        if (manifestError) throw manifestError;

        const { data: release, error: dbError } = await adminClient
            .from("pda_releases")
            .upsert({ version, sha256, storage_path: storagePath, notes: notes ?? null }, { onConflict: "version" })
            .select()
            .single();
        if (dbError) throw dbError;

        return new Response(JSON.stringify({ ok: true, release }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
