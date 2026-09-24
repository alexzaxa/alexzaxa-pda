-- Binds each license key to the one machine that first activates it, closing the "copy the same
-- key to unlimited installs" piracy gap. claim-license (a public Edge Function, called by app.py
-- itself during activation - no user session exists on a restaurant PC) verifies the key's
-- signature server-side, then sets these two fields on first claim; any later claim attempt with
-- a different fingerprint is rejected there. A NULL/NULL row means "issued, never activated yet".
alter table public.license_keys
    add column machine_fingerprint text,
    add column activated_at timestamptz;

-- Lets the admin dashboard directly clear a claim (e.g. a customer replaced their PC) so the same
-- key can be activated again elsewhere - same direct-RLS-write pattern as stores/store_access.
create policy "license_keys_update_admin" on public.license_keys
    for update using (public.is_admin());

-- claim-license also writes to this table (as service_role, from a restaurant PC with no admin
-- session) every time a customer activates - that's routine customer activity, not a privileged
-- admin action, and would otherwise flood admin_audit_log with actor='unknown' rows on every
-- install. audit_admin_write() now skips logging entirely when there's no authenticated actor, so
-- the trigger below only ever fires for the admin's own "release activation" click in the
-- dashboard (a real auth.uid() session), exactly like every other entry in this log.
create or replace function public.audit_admin_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    actor uuid := auth.uid();
    actor_email text;
    label text;
begin
    if actor is null then
        return coalesce(NEW, OLD);
    end if;
    select email into actor_email from public.profiles where id = actor;
    if TG_TABLE_NAME = 'stores' then
        label := coalesce(NEW.name, OLD.name);
    elsif TG_TABLE_NAME = 'store_access' then
        label := coalesce(NEW.store_id, OLD.store_id)::text;
    elsif TG_TABLE_NAME = 'license_keys' then
        label := coalesce(NEW.license_id, OLD.license_id);
    else
        label := '';
    end if;
    insert into public.admin_audit_log(actor_id, actor_label, action, target_label, details)
    values (actor, coalesce(actor_email, actor::text, 'unknown'), TG_TABLE_NAME || '_' || lower(TG_OP), coalesce(label, ''), '');
    return coalesce(NEW, OLD);
end;
$$;

create trigger trg_audit_license_keys_update
    after update on public.license_keys
    for each row execute function public.audit_admin_write();
