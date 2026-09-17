// Minimal, privacy-friendly page-view counter for the public pages (index/help/changelog/login/
// 404) - no cookies, no localStorage, no fingerprinting, no IP capture. Just a path and, if
// present, the browser's own referrer. Best-effort: a failed insert must never affect the page.
import { supabase } from "./supabase-client.js";

export async function trackPageView() {
    try {
        await supabase.from("page_views").insert({
            path: window.location.pathname,
            referrer: document.referrer || null,
        });
    } catch {
        // best-effort only
    }
}
