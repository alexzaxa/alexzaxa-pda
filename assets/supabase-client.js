import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://fuzbuvmpfriprinypbaz.supabase.co";
// Safe to ship in a public frontend - it has no access beyond what RLS allows.
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1emJ1dm1wZnJpcHJpbnlwYmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTAyNzIsImV4cCI6MjEwNTA2NjI3Mn0.cScZuXf5YoFqAGNjroYVWt2TdYreEgGc3X22UyXbf9k";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function requireSession() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
        window.location.href = "login.html";
        return null;
    }
    return data.session;
}

export async function requireRole(role) {
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
    if (role && profile.role !== role) {
        window.location.href = profile.role === "admin" ? "admin.html" : "dashboard.html";
        return null;
    }
    return { session, role: profile.role };
}

export function formatCents(cents) {
    return (Number(cents || 0) / 100).toLocaleString(undefined, { style: "currency", currency: "EUR" });
}

export function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString();
}
