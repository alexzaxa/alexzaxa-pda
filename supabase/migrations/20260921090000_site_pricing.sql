-- Lets the admin edit the homepage's Pricing section (both languages) and show/hide it, without
-- a code deploy. Singleton row (id always 1) holding the same key names index.html's STRINGS.en
-- STRINGS.el objects already use for pricing - index.html merges this over those defaults on
-- load, so if the row is ever missing/unreachable the page still renders the shipped copy.
-- Public SELECT because index.html itself (anonymous visitors) needs to read it to render the
-- page; only the admin can write, same direct-RLS pattern as stores_admin_write.
create table public.site_pricing (
    id int primary key default 1 check (id = 1),
    visible boolean not null default true,
    plan1_total text not null default '€1,000',
    plan2_total text not null default '€200',
    content jsonb not null default '{
        "en": {
            "receipt_kind_onetime": "One-time",
            "pricing1_title": "Buy the software",
            "pricing1_unit": "one-time",
            "pricing1_line1_label": "Software license",
            "pricing1_line1_value": "€1,000",
            "pricing1_line2_label": "Support, from month 2",
            "pricing1_line2_value": "€100/mo",
            "pricing1_body": "First month of support is free. Hardware (PC, screen, printer) isn'\''t included — ask us if you'\''d like help sourcing it.",
            "receipt_kind_monthly": "Monthly",
            "pricing2_title": "Pay monthly",
            "pricing2_unit": "/month",
            "pricing2_line1_label": "Software + support",
            "pricing2_line1_value": "€200/mo",
            "pricing2_line2_label": "Minimum term",
            "pricing2_line2_value": "3 months",
            "pricing2_body": "No upfront software cost. You provide your own PC, screen, and printer."
        },
        "el": {
            "receipt_kind_onetime": "Εφάπαξ",
            "pricing1_title": "Αγορά λογισμικού",
            "pricing1_unit": "εφάπαξ",
            "pricing1_line1_label": "Άδεια λογισμικού",
            "pricing1_line1_value": "1.000€",
            "pricing1_line2_label": "Υποστήριξη, από τον 2ο μήνα",
            "pricing1_line2_value": "100€/μήνα",
            "pricing1_body": "Ο πρώτος μήνας υποστήριξης είναι δωρεάν. Ο εξοπλισμός (υπολογιστής, οθόνη, εκτυπωτής) δεν περιλαμβάνεται — ρωτήστε μας αν θέλετε βοήθεια να τον βρείτε.",
            "receipt_kind_monthly": "Μηνιαία",
            "pricing2_title": "Μηνιαία συνδρομή",
            "pricing2_unit": "/μήνα",
            "pricing2_line1_label": "Λογισμικό + υποστήριξη",
            "pricing2_line1_value": "200€/μήνα",
            "pricing2_line2_label": "Ελάχιστη διάρκεια",
            "pricing2_line2_value": "3 μήνες",
            "pricing2_body": "Χωρίς αρχικό κόστος λογισμικού. Παρέχετε τον δικό σας υπολογιστή, οθόνη και εκτυπωτή."
        }
    }'::jsonb,
    updated_at timestamptz not null default now()
);

insert into public.site_pricing (id) values (1);

alter table public.site_pricing enable row level security;

create policy "site_pricing_select_public" on public.site_pricing
    for select using (true);

create policy "site_pricing_update_admin" on public.site_pricing
    for update using (public.is_admin()) with check (public.is_admin());
