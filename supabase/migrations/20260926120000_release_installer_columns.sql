-- Adds the standalone-exe (installer.iss/PyInstaller) channel alongside the existing zip channel
-- on pda_releases, so the admin.html "Publish a release" form (manage-release Edge Function) can
-- attach a Setup.exe to a release in addition to the zip, not only via the operator-only CLI path.
-- Both columns are nullable: a release can ship zip-only, exe-only, or both.
alter table public.pda_releases
    add column if not exists installer_storage_path text,
    add column if not exists installer_sha256 text;
