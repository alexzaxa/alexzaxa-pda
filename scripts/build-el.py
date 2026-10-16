#!/usr/bin/env python3
"""Generates el/index.html from index.html + assets/i18n/el.json.

index.html is the single hand-maintained source (English text, with data-i18n /
data-i18n-html / data-i18n-data-* attributes marking what's translatable). This
script never hand-duplicates markup - it transforms a copy of the real page.

IMPORTANT - re-run this and commit the result after every change to index.html
or assets/i18n/el.json. The live site at alexzaxa.com is served by a Cloudflare
Worker (see wrangler.jsonc) that Cloudflare auto-builds straight from whatever
is committed on `master` - it runs no build step of its own, so el/index.html
must already be a real, up-to-date file in the repo, not a CI-only artifact.
(.github/workflows/pages.yml also runs this script, but that workflow deploys
to GitHub Pages, which is not what the custom domain actually serves.)

Conventions read from index.html:
  data-i18n="key"             -> replace the element's direct text content
  data-i18n-html="key"        -> replace the element's inner HTML (markup allowed)
  data-i18n-data-ATTR="key"   -> replace the element's own data-ATTR="..." value
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DICT = ROOT / "assets" / "i18n" / "el.json"
OUT = ROOT / "el" / "index.html"

GREEK_TITLE = "AlexZaxa: παραγγελίες εστιατορίου offline-first & αξιόπιστα μικρά συστήματα"
GREEK_META_DESCRIPTION = (
    "Παραγγελίες εστιατορίου offline-first, φτιαγμένες και λειτουργούμενες από τον AlexZaxa "
    "(Αλέξανδρος Ζαχαρόπουλος) στη Χαλκίδα — tablet σερβιτόρων, εκτύπωση κουζίνας, λογισμικό "
    "που ενημερώνεται μόνο του, και τα μικρά εργαλεία που το κρατούν σε λειτουργία."
)
GREEK_OG_DESCRIPTION = (
    "Παραγγελίες εστιατορίου που δουλεύουν στο δικό σας Wi-Fi, χωρίς εξάρτηση από cloud, "
    "και ενημερώνονται μόνες τους — μαζί με τα μικρά εργαλεία που τα κρατούν σε λειτουργία."
)


def load_translations():
    return json.loads(DICT.read_text(encoding="utf-8"))


def replace_attr_values(html, trans):
    """data-i18n-data-ATTR="key" on an opening tag -> set that tag's data-ATTR value."""
    tag_pattern = re.compile(r'<[a-zA-Z][^<>]*data-i18n-data-\w+="\w+"[^<>]*>')

    def repl_tag(m):
        tag = m.group(0)
        markers = re.findall(r'data-i18n-data-(\w+)="(\w+)"', tag)
        for attr_name, key in markers:
            if key not in trans:
                raise KeyError(f"Missing el.json translation for key: {key}")
            value = trans[key].replace('"', "&quot;")
            # Negative lookbehind matters: attr_name "prefill" must not match inside the
            # marker's own name "data-i18n-data-prefill" (which also ends in "data-prefill=").
            tag = re.sub(rf'(?<!-)data-{re.escape(attr_name)}="[^"]*"', f'data-{attr_name}="{value}"', tag)
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


def swap_head_meta(html):
    html = html.replace(
        "<title>AlexZaxa: offline-first restaurant ordering & reliable small systems</title>",
        f"<title>{GREEK_TITLE}</title>",
    )
    html = re.sub(r'(<meta name="description" content=")[^"]*(")', rf"\1{GREEK_META_DESCRIPTION}\2", html)
    html = re.sub(r'(<link rel="canonical" href=")https://alexzaxa\.com/(")', r"\1https://alexzaxa.com/el/\2", html)
    html = html.replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="el_GR">')
    html = re.sub(
        r'(<meta property="og:title" content=")[^"]*(")',
        rf"\1{GREEK_TITLE}\2",
        html,
    )
    html = re.sub(
        r'(<meta property="og:description" content=")[^"]*(")',
        rf"\1{GREEK_OG_DESCRIPTION}\2",
        html,
    )
    html = re.sub(r'(<meta property="og:url" content=")https://alexzaxa\.com/(")', r"\1https://alexzaxa.com/el/\2", html)
    html = re.sub(
        r'(<meta name="twitter:title" content=")[^"]*(")',
        rf"\1{GREEK_TITLE}\2",
        html,
    )
    html = re.sub(
        r'(<meta name="twitter:description" content=")[^"]*(")',
        rf"\1{GREEK_OG_DESCRIPTION}\2",
        html,
    )
    return html


def swap_lang_switch(html):
    # EN page's switch points to /el/ and reads "ΕΛ"; the generated page must point back
    # to / and read "EN".
    return html.replace(
        '<a id="lang-switch" class="lang-switch" href="/el/">ΕΛ</a>',
        '<a id="lang-switch" class="lang-switch" href="/">EN</a>',
    )


def remove_lang_banner(html):
    # The "read this in Greek" banner only makes sense on the English page.
    return re.sub(r'\n<div class="lang-banner"[^>]*>.*?</div>\n', "\n", html, flags=re.DOTALL)


def build():
    trans = load_translations()
    html = SRC.read_text(encoding="utf-8")

    html = html.replace('<html lang="en">', '<html lang="el">', 1)
    html = swap_head_meta(html)
    html = swap_lang_switch(html)
    html = remove_lang_banner(html)
    html = replace_attr_values(html, trans)
    html = replace_inner_html(html, trans)
    html = replace_text_content(html, trans)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({len(html)} bytes)")


if __name__ == "__main__":
    try:
        build()
    except KeyError as e:
        print(f"build-el.py: {e}", file=sys.stderr)
        sys.exit(1)
