// Admin-only, called from admin.html with the caller's own Supabase Auth session (same pattern
// as create-store/manage-download-user) - NOT the X-Setup-Key used by publish-release, which is
// a separate, local-operator-only path for the CLI publishing script. This one lets the admin
// upload a new release zip, edit an existing release's notes, or delete an old one, straight
// from the browser.
//
// sha256 is always computed here from the uploaded bytes rather than trusted from the client,
// unlike publish-release (which trusts the local script's own hash) - a browser upload has no
// equivalent guarantee the given hash actually matches the file.
//
// "latest" (what scripts/check_for_update.py compares against and downloads) is recomputed from
// whatever rows remain after every upload/delete, picking the highest version by numeric
// dot-segment comparison - never just "whatever was touched most recently". That matters because
// an admin might upload an older version to fix its notes, or delete the current newest one.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares "3.2.10" > "3.2.9" correctly (plain string sort would get this backwards).
function compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map((n) => parseInt(n, 10) || 0);
    const partsB = b.split(".").map((n) => parseInt(n, 10) || 0);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

async function regenerateLatestManifest(
    adminClient: ReturnType<typeof createClient>,
    supabaseUrl: string,
): Promise<void> {
    const { data: releases } = await adminClient
        .from("pda_releases")
        .select("version, sha256, storage_path, installer_storage_path, installer_sha256");
    if (!releases || !releases.length) {
        await adminClient.storage.from("pda-releases").remove(["latest.json"]);
        return;
    }
    const latest = releases.reduce((best, r) => (compareVersions(r.version, best.version) > 0 ? r : best));
    const manifest: Record<string, unknown> = {
        version: latest.version,
        sha256: latest.sha256,
        url: `${supabaseUrl}/storage/v1/object/public/pda-releases/${latest.storage_path}`,
    };
    // check_for_update_exe.py reads this "installer" section for the standalone-exe distribution's
    // own update channel; omit it entirely when this version has no exe attached rather than
    // pointing at a file that doesn't exist.
    if (latest.installer_storage_path && latest.installer_sha256) {
        manifest.installer = {
            url: `${supabaseUrl}/storage/v1/object/public/pda-releases/${latest.installer_storage_path}`,
            sha256: latest.installer_sha256,
        };
    }
    const manifestJson = JSON.stringify(manifest);
    await adminClient.storage.from("pda-releases").upload("latest.json", new TextEncoder().encode(manifestJson), {
        contentType: "application/json",
        upsert: true,
    });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization") ?? "";
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: userData, error: userError } = await callerClient.auth.getUser();
        if (userError || !userData.user) return jsonResponse({ error: "Not authenticated" }, 401);

        const { data: profile, error: profileError } = await callerClient
            .from("profiles").select("role").eq("id", userData.user.id).single();
        if (profileError || profile?.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);

        const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const body = await req.json();
        const action = String(body?.action ?? "");

        if (action === "upload") {
            const version = String(body?.version ?? "").trim();
            const notes = body?.notes ? String(body.notes) : null;
            const zipBase64 = String(body?.zip_base64 ?? "");
            const exeBase64 = String(body?.exe_base64 ?? "");
            if (!version || (!zipBase64 && !exeBase64)) {
                return jsonResponse({ error: "version and at least one of zip_base64/exe_base64 are required" }, 400);
            }
            if (!/^[0-9]+(\.[0-9]+)*$/.test(version)) return jsonResponse({ error: "version must look like 3.2.10" }, 400);

            if (!zipBase64) {
                // storage_path/sha256 are not-null - a first-time insert with no zip would violate
                // that, so an exe-only upload only makes sense as an addition to a version that
                // already got its zip uploaded. Checked before touching storage so a rejected
                // request never leaves an orphaned exe behind.
                const { data: existing } = await adminClient
                    .from("pda_releases").select("version").eq("version", version).maybeSingle();
                if (!existing) {
                    return jsonResponse({ error: "No existing release for this version - upload the zip first" }, 400);
                }
            }

            // Only columns actually present in this row are set on conflict (see the comment on
            // regenerateLatestManifest) - re-uploading just the zip for a version that already has
            // an installer attached leaves that installer's row untouched rather than nulling it.
            const row: Record<string, unknown> = { version, notes };

            if (zipBase64) {
                const zipBytes = base64ToBytes(zipBase64);
                row.sha256 = await sha256Hex(zipBytes);
                row.storage_path = `releases/alexzaxa-pda-${version}.zip`;
                const { error: uploadError } = await adminClient.storage
                    .from("pda-releases")
                    .upload(row.storage_path as string, zipBytes, { contentType: "application/zip", upsert: true });
                if (uploadError) throw uploadError;
            }

            if (exeBase64) {
                const exeBytes = base64ToBytes(exeBase64);
                row.installer_sha256 = await sha256Hex(exeBytes);
                row.installer_storage_path = `releases/AlexZaxaPDA-Setup-${version}.exe`;
                const { error: uploadError } = await adminClient.storage
                    .from("pda-releases")
                    .upload(row.installer_storage_path as string, exeBytes, {
                        contentType: "application/octet-stream",
                        upsert: true,
                    });
                if (uploadError) throw uploadError;
            }

            const { data: release, error: dbError } = await adminClient
                .from("pda_releases")
                .upsert(row, { onConflict: "version" })
                .select()
                .single();
            if (dbError) throw dbError;

            await regenerateLatestManifest(adminClient, supabaseUrl);
            return jsonResponse({ ok: true, release });
        }

        if (action === "update") {
            const version = String(body?.version ?? "").trim();
            const notes = body?.notes ? String(body.notes) : null;
            if (!version) return jsonResponse({ error: "version is required" }, 400);
            const { data: release, error: dbError } = await adminClient
                .from("pda_releases").update({ notes }).eq("version", version).select().single();
            if (dbError) throw dbError;
            return jsonResponse({ ok: true, release });
        }

        if (action === "delete") {
            const version = String(body?.version ?? "").trim();
            if (!version) return jsonResponse({ error: "version is required" }, 400);
            const { data: release, error: findError } = await adminClient
                .from("pda_releases").select("storage_path, installer_storage_path").eq("version", version).maybeSingle();
            if (findError) throw findError;
            if (!release) return jsonResponse({ error: "Release not found" }, 404);

            const toRemove = [release.storage_path, release.installer_storage_path].filter(Boolean) as string[];
            await adminClient.storage.from("pda-releases").remove(toRemove);
            const { error: deleteError } = await adminClient.from("pda_releases").delete().eq("version", version);
            if (deleteError) throw deleteError;

            await regenerateLatestManifest(adminClient, supabaseUrl);
            return jsonResponse({ ok: true });
        }

        return jsonResponse({ error: "Unknown action" }, 400);
    } catch (err) {
        return jsonResponse({ error: String(err) }, 500);
    }
});
