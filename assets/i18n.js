// Tiny, dependency-free language switch shared by the public-facing pages (index, help, login,
// changelog). Each page keeps its own dictionary (content differs too much page to page for a
// shared one to be worth it) and just calls initLangSwitch(dict) with it. Admin-side tools
// (admin/dashboard/download/menu-creator) are deliberately not part of this - they're used by
// the operator and store owners, who already work in English there.
const STORAGE_KEY = "site-lang";

export function getLang() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "el") return stored;
    return (navigator.language || "").toLowerCase().startsWith("el") ? "el" : "en";
}

function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
}

export function applyTranslations(dict, lang) {
    document.documentElement.lang = lang;
    const strings = dict[lang] || {};
    if (strings.__title) document.title = strings.__title;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const value = strings[el.dataset.i18n];
        if (value !== undefined) el.textContent = value;
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
        const value = strings[el.dataset.i18nHtml];
        if (value !== undefined) el.innerHTML = value;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const value = strings[el.dataset.i18nPlaceholder];
        if (value !== undefined) el.placeholder = value;
    });
}

export function initLangSwitch(dict) {
    const button = document.getElementById("lang-switch");
    const label = (lang) => (lang === "en" ? "ΕΛ" : "EN");
    let current = getLang();
    applyTranslations(dict, current);
    if (!button) return;
    button.textContent = label(current);
    button.addEventListener("click", () => {
        current = current === "en" ? "el" : "en";
        setLang(current);
        applyTranslations(dict, current);
        button.textContent = label(current);
    });
}
