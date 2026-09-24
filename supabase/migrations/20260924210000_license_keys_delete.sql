-- Let an admin delete a license key ledger row directly via RLS (same pattern as stores/
-- store_access - see admin_audit_log's original comment). This only removes the admin's own
-- record of having issued the key; it does NOT revoke the key itself, which remains offline
-- signed/verifiable by app.py forever, same as license_keys never granting the key any authority
-- in the first place. Logged via the existing audit_admin_write() trigger, extended here to
-- also cover this table.
create policy "license_keys_delete_admin" on public.license_keys
    for delete using (public.is_admin());

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

create trigger trg_audit_license_keys_delete
    after delete on public.license_keys
    for each row execute function public.audit_admin_write();
