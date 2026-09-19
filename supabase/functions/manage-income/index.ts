// Admin-only. Deletes a store's recorded income for one day.
// store_daily_totals is the permanent per-(store,day) total (see 20260915223000_daily_totals_
// and_retention.sql) - it has no client write/delete RLS policy at all, only the bump_daily_total
// trigger writes to it, so removing a bad/test total requires this service_role-backed endpoint.
// Also clears any order_income raw rows still inside the 15-day retention window for that same
// (store, day), so a re-load of the Income tab can't show stale detail for a total that's gone.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logAudit } from "../_shared/audit.ts";

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
        const { data: callerProfile } = await callerClient
            .from("profiles").select("role").eq("id", userData.user.id).single();
        if (callerProfile?.role !== "admin") {
            return new Response(JSON.stringify({ error: "Admin access required" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = await req.json();
        const action = String(body?.action ?? "");
        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        if (action === "delete_day") {
            const storeId = String(body?.store_id ?? "");
            const day = String(body?.day ?? "");
            if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
                return new Response(JSON.stringify({ error: "store_id and a day (YYYY-MM-DD) are required" }), {
                    status: 400,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
            const { error: totalsError } = await adminClient
                .from("store_daily_totals").delete().eq("store_id", storeId).eq("day", day);
            if (totalsError) throw totalsError;

            const dayStart = `${day}T00:00:00Z`;
            const dayEnd = `${day}T23:59:59.999Z`;
            const { error: rawError } = await adminClient
                .from("order_income").delete()
                .eq("store_id", storeId)
                .gte("closed_at", dayStart)
                .lte("closed_at", dayEnd);
            if (rawError) throw rawError;

            const { data: store } = await adminClient.from("stores").select("name").eq("id", storeId).single();
            await logAudit(adminClient, userData.user, "delete_income_day", `${store?.name ?? storeId} / ${day}`);

            return new Response(JSON.stringify({ ok: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
