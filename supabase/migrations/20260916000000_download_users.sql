-- Username-only accounts (no email) for people who should be able to see/download the PDA
-- release zip, but shouldn't have an income dashboard login. Supabase Auth requires an
-- email-shaped identifier internally, so each download user gets a synthetic one derived
-- deterministically from their username (see DOWNLOAD_EMAIL_DOMAIN in create-download-user and
-- login.html) - never a real, deliverable address. The admin sets the password directly when
-- creating the account (there's nowhere to email an invite to), and tells the person in person.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'restricted', 'download'));
alter table public.profiles add column username text unique;

-- Download users can read their own profile (already covered by profiles_select_self_or_admin)
-- and pda_releases (already public-read) - no new RLS needed for what they can see.
