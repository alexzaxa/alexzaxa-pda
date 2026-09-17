-- Adds a "new_store" category so the homepage's lead-capture form (prospective restaurant
-- owners who don't run the PDA yet) can reuse the exact same submit-ticket pipeline as
-- help.html's support form, instead of standing up a second table/function/admin UI for leads.
alter table public.support_tickets drop constraint support_tickets_category_check;
alter table public.support_tickets add constraint support_tickets_category_check
    check (category in ('technical', 'how_to', 'billing', 'other', 'new_store'));
