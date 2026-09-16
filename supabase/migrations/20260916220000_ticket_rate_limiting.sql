-- Support ticket spam protection. The help.html form used to insert into support_tickets
-- directly with the anon key (RLS: "with check (true)") - anyone who found that endpoint could
-- script unlimited submissions straight through PostgREST, bypassing the form's own honeypot
-- entirely. Both defenses now live server-side in the submit-ticket Edge Function instead:
--   1. A honeypot field (bots that fill every input get silently discarded).
--   2. A per-IP rate limit, tracked here.
-- The Edge Function writes with the service_role key, which bypasses RLS regardless of policy -
-- so the fix is removing the public insert policy, not adding a smarter one.
drop policy "support_tickets_insert_public" on public.support_tickets;

create table public.ticket_rate_limits (
    ip text primary key,
    window_start timestamptz not null,
    count integer not null default 0
);

alter table public.ticket_rate_limits enable row level security;

-- No client policies at all (admin included) - only the Edge Function's service_role client
-- touches this table; it's bookkeeping, not something anyone needs to read from the dashboard.
