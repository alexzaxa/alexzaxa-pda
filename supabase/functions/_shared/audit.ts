// Shared by every admin-only Edge Function: records a row in admin_audit_log after a
// privileged action succeeds. Uses the caller's own adminClient (service_role) - never throws
// on failure, since a logging hiccup should never block or roll back the action it's logging.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function logAudit(
    adminClient: SupabaseClient,
    actor: { id: string; email?: string | null },
    action: string,
    targetLabel: string,
    details: string = "",
): Promise<void> {
    try {
        await adminClient.from("admin_audit_log").insert({
            actor_id: actor.id,
            actor_label: actor.email || actor.id,
            action,
            target_label: targetLabel,
            details,
        });
    } catch {
        // Logging failures are never fatal to the action itself.
    }
}
