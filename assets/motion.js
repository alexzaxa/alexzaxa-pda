// Shared motion helpers: scroll-reveal animations and skeleton-loading placeholders. The `js`
// class gates all animation in styles.css so pages render fully visible with no JS at all - see
// the comment there. Import this on any page that uses `.reveal-up` elements or skeletonRows().
document.documentElement.classList.add("js");

export function initScrollReveal(selector = ".reveal-up") {
    const els = document.querySelectorAll(selector);
    if (!els.length) return;
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        els.forEach((el) => el.classList.add("is-visible"));
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((el) => observer.observe(el));
}

// Renders `rowCount` placeholder <tr>s with `colCount` shimmering cells - a drop-in replacement
// for a plain "Loading…" <tr> in a table's initial tbody.
export function skeletonRows(colCount, rowCount = 3) {
    const cells = Array.from({ length: colCount }, () => `<td><span class="skeleton-text"></span></td>`).join("");
    return Array.from({ length: rowCount }, () => `<tr>${cells}</tr>`).join("");
}

// Thin top-of-page bar shown while navigating to another page. This is a classic multi-page
// site (full reloads, no router) so there's no "complete" event to fire on the same document -
// the bar just animates toward 80% and stays there, visually, until the browser swaps in the
// next page (which replaces it entirely). That's the same trick nprogress/Turbo use.
let progressEl = null;
export function startPageProgress() {
    if (!progressEl) {
        progressEl = document.createElement("div");
        progressEl.id = "page-progress";
        document.body.appendChild(progressEl);
    }
    requestAnimationFrame(() => progressEl.classList.add("active"));
}

export function initPageProgress() {
    document.addEventListener("click", (event) => {
        const link = event.target.closest("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (link.target === "_blank" || link.hasAttribute("download")) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname && url.hash) return; // same-page anchor
        startPageProgress();
    });
}

// Toggles a button between its normal label and a spinner + loading label, disabling it either
// way. Stashes the original label on the element itself so callers don't have to track it.
export function setButtonLoading(button, loading, loadingText) {
    if (loading) {
        if (button.dataset.originalLabel === undefined) button.dataset.originalLabel = button.textContent;
        button.disabled = true;
        button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${loadingText}`;
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalLabel ?? button.textContent;
    }
}
