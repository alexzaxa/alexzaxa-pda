// Admin-only. Saves an admin's reply to a support ticket and, when contact_info looks like an
// email address (it's free text - help.html/index.html both label it "Email or phone", so not
// every ticket has one), sends it via Resend from projects@alexzaxa.com. Mirrors the
// auth-check-then-service_role-write pattern used by every other admin Edge Function here (see
// invite-user) - RLS already blocks anon writes to support_tickets, this just adds the email step
// and keeps the write path enforced through one function rather than direct client updates.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logAudit } from "../_shared/audit.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        const { data: profile } = await callerClient
            .from("profiles").select("role").eq("id", userData.user.id).single();
        if (profile?.role !== "admin") {
            return new Response(JSON.stringify({ error: "Admin access required" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const body = await req.json();
        const ticket_id = String(body?.ticket_id ?? "");
        const message = String(body?.message ?? "").trim();
        if (!ticket_id) return badRequest("ticket_id is required");
        if (!message || message.length > 5000) return badRequest("message is required (max 5000 chars)");

        const adminClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        const { data: ticket, error: ticketError } = await adminClient
            .from("support_tickets")
            .select("store_name, contact_name, contact_info, message")
            .eq("id", ticket_id)
            .single();
        if (ticketError || !ticket) return badRequest("Ticket not found");

        const now = new Date().toISOString();
        let emailSent = false;
        const resendKey = Deno.env.get("RESEND_API_KEY");

        if (resendKey && EMAIL_RE.test(ticket.contact_info)) {
            const emailRes = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${resendKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: "AlexZaxa Solutions <projects@alexzaxa.com>",
                    to: ticket.contact_info,
                    subject: `Re: your message about ${ticket.store_name}`,
                    text:
                        `Hi ${ticket.contact_name},\n\n${message}\n\n` +
                        `---\nYour original message:\n${ticket.message}\n\n` +
                        `— AlexZaxa Solutions\nprojects@alexzaxa.com`,
                }),
            });
            emailSent = emailRes.ok;
        }

        const { error: updateError } = await adminClient
            .from("support_tickets")
            .update({
                admin_reply: message,
                admin_reply_at: now,
                reply_email_sent_at: emailSent ? now : null,
                updated_at: now,
            })
            .eq("id", ticket_id);
        if (updateError) throw updateError;

        await logAudit(adminClient, userData.user, "reply_ticket", ticket.store_name, emailSent ? "emailed" : "saved only");

        return new Response(JSON.stringify({ ok: true, email_sent: emailSent }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});

function badRequest(message: string) {
    return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
