-- Every privileged Edge Function action (create/delete store, invite/create/promote/delete user,
-- delete income) now writes a row here after it succeeds. No client write policy - only
-- service_role (from inside each Edge Function) inserts, same trust model as everything else in
-- this schema. Read-only for admins, so there's finally a paper trail for the "super user" tools
-- in admin.html (delete user, delete income, promote to admin, etc).
create table public.admin_audit_log (
    id bigint generated always as identity primary key,
    actor_id uuid references public.profiles(id),
    actor_label text not null,
    action text not null,
    target_label text not null default '',
    details text not null default '',
    created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

create policy "admin_audit_log_select_admin" on public.admin_audit_log
    for select using (public.is_admin());

-- stores (update/delete) and store_access (insert/delete) are the two tables an admin writes to
-- directly via RLS rather than through an Edge Function (see stores_update_admin/
-- stores_delete_admin/store_access_insert_admin/store_access_delete_admin policies) - those
-- writes would otherwise never reach admin_audit_log at all. stores INSERT is deliberately not
-- covered here: it only ever happens through create-store, which already logs itself, and a
-- trigger on INSERT too would double the entry.
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
    else
        label := '';
    end if;
    insert into public.admin_audit_log(actor_id, actor_label, action, target_label, details)
    values (actor, coalesce(actor_email, actor::text, 'unknown'), TG_TABLE_NAME || '_' || lower(TG_OP), coalesce(label, ''), '');
    return coalesce(NEW, OLD);
end;
$$;

create trigger trg_audit_stores_write
    after update or delete on public.stores
    for each row execute function public.audit_admin_write();

create trigger trg_audit_store_access_write
    after insert or delete on public.store_access
    for each row execute function public.audit_admin_write();
