#!/usr/bin/env python3
"""Generates the Greek pages (el/index.html, el/lab/index.html) from their English
sources + assets/i18n/el.json.

Each English source (index.html, lab/index.html) is the single hand-maintained
template (English text, with data-i18n / data-i18n-html / data-i18n-attr marking
what's translatable). This script never hand-duplicates markup - it transforms a
copy of the real page.

IMPORTANT - re-run this and commit the result after every change to index.html,
lab/index.html, or assets/i18n/el.json. The live site at alexzaxa.com is served
by a Cloudflare Worker (see wrangler.jsonc) that Cloudflare auto-builds straight
from whatever is committed on `master` - it runs no build step of its own, so
el/index.html and el/lab/index.html must already be real, up-to-date files in
the repo, not CI-only artifacts. (.github/workflows/pages.yml also runs this
script, but that workflow deploys to GitHub Pages, which is not what the custom
domain actually serves.)

Conventions read from the English source:
  data-i18n="key"                 -> replace the element's direct text content
  data-i18n-html="key"            -> replace the element's inner HTML (markup allowed)
  data-i18n-attr="attr:key[,attr:key...]" -> replace attr="..." on the same tag with
                                     trans[key], for one or more real attributes
                                     (works for both data-* attributes like
                                     data-prefill and ordinary ones like aria-label)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DICT = ROOT / "assets" / "i18n" / "el.json"

GREEK_HOME = {
    "title": "AlexZaxa: παραγγελίες εστιατορίου offline-first & αξιόπιστα μικρά συστήματα",
    "meta_description": (
        "Παραγγελίες εστιατορίου offline-first, που σχεδιάζει και υποστηρίζει ο AlexZaxa "
        "(Αλέξανδρος Ζαχαρόπουλος) στη Χαλκίδα — tablet σερβιτόρων, εκτύπωση κουζίνας, λογισμικό "
        "που ενημερώνεται μόνο του, και τα μικρά εργαλεία που το κρατούν σε λειτουργία."
    ),
    "og_description": (
        "Παραγγελίες εστιατορίου που δουλεύουν στο δικό σας Wi-Fi, χωρίς εξάρτηση από cloud, "
        "και ενημερώνονται μόνες τους — μαζί με τα μικρά εργαλεία που τα κρατούν σε λειτουργία."
    ),
}

GREEK_LAB = {
    "title": "Το εργαστήριο · AlexZaxa",
    "meta_description": (
        "Δευτερεύοντα έργα του AlexZaxa (Αλέξανδρος Ζαχαρόπουλος) — γραμμένα από άκρη σε άκρη, "
        "αλλά όχι ακόμα δοκιμασμένα σε πραγματικό φόρτο: μια βιβλιοθήκη κλειδιών άδειας, μια "
        "ελαφριά εφαρμογή φωνής, ένα backtester στρατηγικών trading, και τα επόμενα σχέδια."
    ),
    "og_description": "Δευτερεύοντα έργα — γραμμένα από άκρη σε άκρη, όχι ακόμα δοκιμασμένα σε πραγματικό φόρτο.",
}

PAGES = [
    {
        "src": ROOT / "index.html",
        "out": ROOT / "el" / "index.html",
        "canonical_en": "https://alexzaxa.com/",
        "canonical_el": "https://alexzaxa.com/el/",
        "lang_switch_en": '<a id="lang-switch" class="lang-switch" href="/el/">ΕΛ</a>',
        "lang_switch_el": '<a id="lang-switch" class="lang-switch" href="/">EN</a>',
        "greek": GREEK_HOME,
    },
    {
        "src": ROOT / "lab" / "index.html",
        "out": ROOT / "el" / "lab" / "index.html",
        "canonical_en": "https://alexzaxa.com/lab/",
        "canonical_el": "https://alexzaxa.com/el/lab/",
        "lang_switch_en": '<a id="lang-switch" class="lang-switch" href="/el/lab/">ΕΛ</a>',
        "lang_switch_el": '<a id="lang-switch" class="lang-switch" href="/lab/">EN</a>',
        "greek": GREEK_LAB,
    },
]


def load_translations():
    return json.loads(DICT.read_text(encoding="utf-8"))


def replace_attrs(html, trans):
    """data-i18n-attr="attr:key[,attr:key...]" -> set each attr="..." on that tag."""
    tag_pattern = re.compile(r'<[a-zA-Z][^<>]*\sdata-i18n-attr="[^"]+"[^<>]*>')

    def repl_tag(m):
        tag = m.group(0)
        attr_value_match = re.search(r'data-i18n-attr="([^"]+)"', tag)
        pairs = [p.split(":", 1) for p in attr_value_match.group(1).split(",")]
        for attr_name, key in pairs:
            if key not in trans:
                raise KeyError(f"Missing el.json translation for key: {key}")
            value = trans[key].replace('"', "&quot;")
            # Negative lookbehind matters: e.g. attr "prefill" must not match inside a
            # longer attribute name that happens to end in "-prefill".
            tag = re.sub(rf'(?<![-\w]){re.escape(attr_name)}="[^"]*"', f'{attr_name}="{value}"', tag)
        return tag

    return tag_pattern.sub(repl_tag, html)


def replace_inner_html(html, trans):
    """data-i18n-html="key" -> replace the element's inner HTML (nested tags allowed)."""
    pattern = re.compile(r'(<([a-zA-Z]+)[^<>]*\sdata-i18n-html="([a-zA-Z0-9_]+)"[^<>]*>)(.*?)(</\2>)', re.DOTALL)

    def repl(m):
        tag_open, _tag_name, key, _inner, tag_close = m.groups()
        if key not in trans:
            raise KeyError(f"Missing el.json translation for key: {key}")
        return tag_open + trans[key] + tag_close

    return pattern.sub(repl, html)


def replace_text_content(html, trans):
    """data-i18n="key" -> replace the element's immediate text content (no nested tags)."""
    pattern = re.compile(r'(<[a-zA-Z][^<>]*\sdata-i18n="([a-zA-Z0-9_]+)"[^<>]*>)([^<]*)(?=<)')

    def repl(m):
        tag_open, key, _text = m.groups()
        if key not in trans:
            raise KeyError(f"Missing el.json translation for key: {key}")
        return tag_open + trans[key]

    return pattern.sub(repl, html)


def swap_head_meta(html, page):
    g = page["greek"]
    html = re.sub(r"<title>[^<]*</title>", f"<title>{g['title']}</title>", html, count=1)
    html = re.sub(r'(<meta name="description" content=")[^"]*(")', rf"\1{g['meta_description']}\2", html)
    html = html.replace(
        f'<link rel="canonical" href="{page["canonical_en"]}">',
        f'<link rel="canonical" href="{page["canonical_el"]}">',
    )
    html = html.replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="el_GR">')
    html = re.sub(r'(<meta property="og:title" content=")[^"]*(")', rf"\1{g['title']}\2", html)
    html = re.sub(r'(<meta property="og:description" content=")[^"]*(")', rf"\1{g['og_description']}\2", html)
    html = html.replace(
        f'<meta property="og:url" content="{page["canonical_en"]}">',
        f'<meta property="og:url" content="{page["canonical_el"]}">',
    )
    html = re.sub(r'(<meta name="twitter:title" content=")[^"]*(")', rf"\1{g['title']}\2", html)
    html = re.sub(r'(<meta name="twitter:description" content=")[^"]*(")', rf"\1{g['og_description']}\2", html)
    return html


def remove_lang_banner(html):
    # The "read this in Greek" banner only makes sense on the English page.
    return re.sub(r'\n<div class="lang-banner"[^>]*>.*?</div>\n', "\n", html, flags=re.DOTALL)


def build_page(page, trans):
    html = page["src"].read_text(encoding="utf-8")

    html = html.replace('<html lang="en">', '<html lang="el">', 1)
    html = swap_head_meta(html, page)
    html = html.replace(page["lang_switch_en"], page["lang_switch_el"])
    html = remove_lang_banner(html)
    html = replace_attrs(html, trans)
    html = replace_inner_html(html, trans)
    html = replace_text_content(html, trans)

    page["out"].parent.mkdir(parents=True, exist_ok=True)
    page["out"].write_text(html, encoding="utf-8")
    print(f"wrote {page['out']} ({len(html)} bytes)")


def build():
    trans = load_translations()
    for page in PAGES:
        build_page(page, trans)


if __name__ == "__main__":
    try:
        build()
    except KeyError as e:
        print(f"build-el.py: {e}", file=sys.stderr)
        sys.exit(1)
