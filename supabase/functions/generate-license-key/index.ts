// Admin-only. Mints a signed AlexZaxa PDA license key.
//
// Payload format MUST exactly match app.py's parse_license_key(): 4 random bytes (license id)
// + a 2-byte big-endian expiry_days count (days since LICENSE_EPOCH = 2026-01-01 UTC; 0 = a
// perpetual/never-expiring license). The 6-byte payload plus its 64-byte Ed25519 signature (70
// bytes total, a clean multiple of 5) is base32-encoded with no padding, grouped into 4-char
// blocks, and prefixed "ALEXPDA1-". Changing any of this breaks every key already issued.
//
// LICENSE_PRIVATE_KEY_SEED is a Supabase secret (the raw 32-byte Ed25519 seed, base64) - it is
// only ever read inside this Edge Function, same trust model as SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as ed from "npm:@noble/ed25519@2";
import { sha512 } from "npm:@noble/hashes@1/sha512";
import { corsHeaders } from "../_shared/cors.ts";
import { logAudit } from "../_shared/audit.ts";

ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));

const LICENSE_EPOCH = Date.UTC(2026, 0, 1);
const KEY_PREFIX = "ALEXPDA1-";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
    let bits = 0, value = 0, output = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return output;
}

function formatKey(blob: Uint8Array): string {
    const b32 = base32Encode(blob);
    const groups: string[] = [];
    for (let i = 0; i < b32.length; i += 4) groups.push(b32.slice(i, i + 4));
    return KEY_PREFIX + groups.join("-");
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

        const body = await req.json().catch(() => ({}));
        const days = Number(body?.days);
        const note = body?.note ? String(body.note).trim().slice(0, 200) : null;
        if (!Number.isInteger(days) || days < 0) {
            return new Response(
                JSON.stringify({ error: "days must be a non-negative integer (0 = perpetual)" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }

        const seedB64 = Deno.env.get("LICENSE_PRIVATE_KEY_SEED");
        if (!seedB64) throw new Error("LICENSE_PRIVATE_KEY_SEED is not configured");
        const privateKeySeed = Uint8Array.from(atob(seedB64), (c) => c.charCodeAt(0));

        const licenseIdBytes = crypto.getRandomValues(new Uint8Array(4));
        let expiryDays = 0;
        let expiresAt: string | null = null;
        if (days > 0) {
            const now = new Date();
            const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
            const todayDays = Math.round((todayUTC - LICENSE_EPOCH) / 86400000);
            expiryDays = todayDays + days;
            if (expiryDays <= 0 || expiryDays >= 65536) {
                return new Response(
                    JSON.stringify({ error: "Expiry is out of range for this key format" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
            }
            expiresAt = new Date(LICENSE_EPOCH + expiryDays * 86400000).toISOString().slice(0, 10);
        }

        const payload = new Uint8Array(6);
        payload.set(licenseIdBytes, 0);
        new DataView(payload.buffer).setUint16(4, expiryDays, false);

        const signature = ed.sign(payload, privateKeySeed);
        const blob = new Uint8Array(payload.length + signature.length);
        blob.set(payload, 0);
        blob.set(signature, payload.length);
        const key = formatKey(blob);
        const licenseId = toHex(licenseIdBytes);

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { error: insertError } = await adminClient.from("license_keys").insert({
            license_id: licenseId,
            key,
            expires_at: expiresAt,
            note,
            issued_by: userData.user.id,
        });
        if (insertError) throw insertError;

        await logAudit(adminClient, userData.user, "issue_license_key", licenseId, note ?? "");

        return new Response(
            JSON.stringify({ key, license_id: licenseId, expires_at: expiresAt }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
