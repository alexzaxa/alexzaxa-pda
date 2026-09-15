// Called by restaurant PDA installs (no Supabase Auth session — they authenticate with an
// opaque per-store secret in X-Store-Secret, matched against stores.secret_hash). Accepts a
// batch of completed orders and inserts them into order_income. Writes always go through this
// function's service_role client; RLS on order_income has no client insert policy at all, so a
// leaked anon/authenticated key can never forge income rows, and a leaked store secret can only
// ever insert rows for that one store (client-supplied store_id is never trusted).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function sha256Hex(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

interface OrderRecord {
    source_order_id: number;
    order_kind: "dine_in" | "phone";
    receipt_number?: string | null;
    opened_at?: string | null;
    closed_at?: string | null;
    subtotal_cents?: number;
    discount_cents?: number;
    total_cents?: number;
    tip_cents?: number;
    payment_method?: string | null;
    payment_status?: string | null;
    waiter_id?: number | null;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
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
        const { data: store, error: storeError } = await adminClient
            .from("stores")
            .select("id, active")
            .eq("secret_hash", secretHash)
            .maybeSingle();
        if (storeError || !store || !store.active) {
            return new Response(JSON.stringify({ error: "Invalid or inactive store credential" }), {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = await req.json();
        const orders: OrderRecord[] = Array.isArray(body?.orders) ? body.orders : [];
        if (orders.length === 0) {
            return new Response(JSON.stringify({ error: "orders array required" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        if (orders.length > 200) {
            return new Response(JSON.stringify({ error: "orders batch too large (max 200)" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const rows = orders.map((o) => ({
            store_id: store.id,
            source_order_id: o.source_order_id,
            order_kind: o.order_kind,
            receipt_number: o.receipt_number ?? null,
            opened_at: o.opened_at ?? null,
            closed_at: o.closed_at ?? null,
            subtotal_cents: o.subtotal_cents ?? 0,
            discount_cents: o.discount_cents ?? 0,
            total_cents: o.total_cents ?? 0,
            tip_cents: o.tip_cents ?? 0,
            payment_method: o.payment_method ?? null,
            payment_status: o.payment_status ?? null,
            waiter_id: o.waiter_id ?? null,
        }));

        // Idempotent: a row already landed for (store_id, order_kind, source_order_id) is left
        // untouched rather than overwritten — this is a third party's financial record, so a
        // retried/duplicate send must never silently mutate an already-accepted value.
        const { error: upsertError } = await adminClient
            .from("order_income")
            .upsert(rows, {
                onConflict: "store_id,order_kind,source_order_id",
                ignoreDuplicates: true,
            });
        if (upsertError) throw upsertError;

        return new Response(
            JSON.stringify({ accepted: rows.length }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
