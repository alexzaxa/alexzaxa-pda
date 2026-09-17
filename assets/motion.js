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
