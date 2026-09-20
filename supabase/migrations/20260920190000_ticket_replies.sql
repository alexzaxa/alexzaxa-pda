-- Lets admin reply to a support ticket from admin.html. The reply itself is stored here rather
-- than a separate replies table - a ticket gets at most an occasional follow-up, not a threaded
-- conversation, so one nullable text column is enough and admin_reply_sent-editing it just sends
-- an update. Email delivery is tracked separately (reply_email_sent_at) because contact_info is
-- free text (help.html/index.html both label it "Email or phone") - not every ticket has an
-- emailable address, and the reply-ticket Edge Function needs to record whether it actually sent
-- mail or only saved the reply.
alter table public.support_tickets add column admin_reply text not null default '';
alter table public.support_tickets add column admin_reply_at timestamptz;
alter table public.support_tickets add column reply_email_sent_at timestamptz;
