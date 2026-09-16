import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://fuzbuvmpfriprinypbaz.supabase.co";
// Safe to ship in a public frontend - it has no access beyond what RLS allows.
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1emJ1dm1wZnJpcHJpbnlwYmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTAyNzIsImV4cCI6MjEwNTA2NjI3Mn0.cScZuXf5YoFqAGNjroYVWt2TdYreEgGc3X22UyXbf9k";

// detectSessionInUrl is disabled deliberately: it auto-parses AND CLEARS the URL hash the
// moment this module is evaluated, which races ahead of login.html's own code (ES module
// imports execute before the importing script's body runs) — the hash could already be gone
// by the time login.html tries to check it for "type=invite" vs a normal visit. login.html
// parses and applies the hash itself via supabase.auth.setSession() instead.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});

// Download accounts are username-only (no email) - Supabase Auth still needs an email-shaped
// identifier internally, so one is derived deterministically here and never shown to the user
// or sent anywhere. Must match supabase/functions/manage-download-user's DOWNLOAD_EMAIL_DOMAIN.
const DOWNLOAD_EMAIL_DOMAIN = "downloads.alexzaxa-pda.internal";
export function usernameToEmail(username) {
    return `${username.toLowerCase()}@${DOWNLOAD_EMAIL_DOMAIN}`;
}

const ROLE_HOME = { admin: "admin.html", restricted: "dashboard.html", download: "download.html" };
export function roleHome(role) {
    return ROLE_HOME[role] || "login.html";
}

export async function requireSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
        window.location.href = "login.html";
        return null;
    }
    return data.session;
}

export async function requireRole(allowedRoles) {
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const session = await requireSession();
    if (!session) return null;
    const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
    if (error || !profile) {
        window.location.href = "login.html";
        return null;
    }
    if (roles.length && !roles.includes(profile.role)) {
        window.location.href = roleHome(profile.role);
        return null;
    }
    return { session, role: profile.role };
}

export function formatCents(cents) {
    return (Number(cents || 0) / 100).toLocaleString(undefined, { style: "currency", currency: "EUR" });
}

// Anything rendered via innerHTML that could contain public, unauthenticated input (e.g.
// support_tickets, submitted with no login from help.html) must go through this first - unlike
// admin-authored fields elsewhere (store names, etc.) where only the admin can inject anything.
export function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString();
}
