// Public - no admin session exists here. This is called directly by app.py during license
// activation on a restaurant PC, which has no Supabase Auth login of its own. Authorization comes
// from the Ed25519 signature (only a key minted by generate-license-key can pass verification),
// not from a JWT - same trust model as store-status/sync-order using X-Store-Secret instead of a
// user session.
//
// Binds a license_id to whichever machine claims it first (a hashed Windows MachineGuid sent as
// `fingerprint`); any later claim attempt with a different fingerprint is rejected. This is what
// stops one sold key being pasted into unlimited installs - app.py only writes its local
// data/license.json after this call succeeds, so activation requires internet once. Re-claiming
// with the SAME fingerprint (e.g. reinstalling on the same PC) is idempotent, not an error.
//
// Payload/signature format must exactly match app.py's parse_license_key() and
// generate-license-key's formatKey() - see the comments there.
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as ed from "npm:@noble/ed25519@2";
import { sha512 } from "npm:@noble/hashes@1/sha512";
import { corsHeaders } from "../_shared/cors.ts";

ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

const LICENSE_EPOCH = Date.UTC(2026, 0, 1);
const KEY_PREFIX = "ALEXPDA1-";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Uint8Array {
    const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = 0, value = 0;
    const output: number[] = [];
    for (const char of cleaned) {
        const idx = BASE32_ALPHABET.indexOf(char);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return new Uint8Array(output);
}

function parseKey(
    raw: string,
): { licenseId: string; payload: Uint8Array; signature: Uint8Array; expiryDays: number } | null {
    let cleaned = raw.trim().toUpperCase();
    if (cleaned.startsWith(KEY_PREFIX)) cleaned = cleaned.slice(KEY_PREFIX.length);
    cleaned = cleaned.replace(/-/g, "").replace(/\s/g, "");
    const blob = base32Decode(cleaned);
    if (blob.length !== 70) return null;
    const payload = blob.slice(0, 6);
    const signature = blob.slice(6);
    const licenseId = Array.from(payload.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const expiryDays = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(4, false);
    return { licenseId, payload, signature, expiryDays };
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
        const key = String(body?.key ?? "");
        const fingerprint = String(body?.fingerprint ?? "").trim();
        if (!key || !fingerprint || fingerprint.length > 128) {
            return errorResponse(400, "key and fingerprint are required");
        }

        const parsed = parseKey(key);
        if (!parsed) return errorResponse(400, "Malformed license key");

        const seedB64 = Deno.env.get("LICENSE_PRIVATE_KEY_SEED");
        if (!seedB64) throw new Error("LICENSE_PRIVATE_KEY_SEED is not configured");
        const privateKeySeed = Uint8Array.from(atob(seedB64), (c) => c.charCodeAt(0));
        const publicKey = ed.getPublicKey(privateKeySeed);
        if (!ed.verify(parsed.signature, parsed.payload, publicKey)) {
            return errorResponse(400, "Invalid license key signature");
        }

        if (parsed.expiryDays) {
            const expiresAtMs = LICENSE_EPOCH + parsed.expiryDays * 86400000;
            if (Date.now() >= expiresAtMs) return errorResponse(400, "This license key has expired");
        }

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const { data: existing, error: fetchError } = await adminClient
            .from("license_keys")
            .select("id, machine_fingerprint")
            .eq("license_id", parsed.licenseId)
            .maybeSingle();
        if (fetchError) throw fetchError;

        if (existing) {
            if (existing.machine_fingerprint && existing.machine_fingerprint !== fingerprint) {
                return errorResponse(
                    409,
                    "This license key is already active on a different computer. Contact AlexZaxa PDA Solutions if you believe this is an error.",
                );
            }
            if (!existing.machine_fingerprint) {
                const { error: updateError } = await adminClient
                    .from("license_keys")
                    .update({ machine_fingerprint: fingerprint, activated_at: new Date().toISOString() })
                    .eq("id", existing.id);
                if (updateError) throw updateError;
            }
        } else {
            // No dashboard record of this key (e.g. it was minted with the offline
            // generate_license_key.py CLI tool rather than the dashboard). The signature already
            // proves it's legitimate - only the real private key can produce one - so record it
            // now rather than rejecting it; the ledger is a convenience view, not the source of
            // authority.
            const expiresAt = parsed.expiryDays
                ? new Date(LICENSE_EPOCH + parsed.expiryDays * 86400000).toISOString().slice(0, 10)
                : null;
            const { error: insertError } = await adminClient.from("license_keys").insert({
                license_id: parsed.licenseId,
                key: key.trim(),
                expires_at: expiresAt,
                note: null,
                machine_fingerprint: fingerprint,
                activated_at: new Date().toISOString(),
            });
            if (insertError) throw insertError;
        }

        return new Response(JSON.stringify({ ok: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return errorResponse(500, String(err));
    }
});
