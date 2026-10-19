#!/usr/bin/env python3
"""
GoTax.SI static site builder — standard library only.

    python3 build.py            # build everything
    python3 build.py --check    # build + report, no writes

What it does
------------
1. Reads page sources from  build/pages/**.html  (front-matter + markers).
2. Injects the shared head / header / footer / legal-nav partials.
3. Substitutes {{BASE}}, {{ICON_x}} and the SEO tokens.
4. Generates the per-notice SEO pages  notices/<code>.html  from data/notices.json.
5. Generates data/samples.js (the demo OCR corpus) from samples/*.txt.
6. Writes sitemap.xml and robots.txt.

Output goes to the repository root so the site can be served (or opened) with
no build step at runtime:  python3 -m http.server 8000
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(ROOT, "build", "pages")
PARTIALS = os.path.join(ROOT, "build", "partials")
SITE = "https://gotax.si"
TODAY = date.today().isoformat()

LOCALES = ["en", "hi", "bn", "ar", "sw", "es", "de", "ko", "tl", "fr", "zh-CN", "zh-TW"]
XDEFAULT = "en"

# ----------------------------------------------------------------- icons ----
ICON_RE = re.compile(r"^\s{4}(\w+):\s*'(<svg.*?</svg>)',?\s*$", re.M | re.S)


def load_icons() -> dict[str, str]:
    src = open(os.path.join(ROOT, "assets", "js", "app.js"), encoding="utf-8").read()
    block = src[src.index("var ICONS = W.ICONS = {"):]
    block = block[: block.index("};")]
    return {m.group(1): m.group(2) for m in ICON_RE.finditer(block)}


ICONS = load_icons()

# ------------------------------------------------------------- front-matter --
FM_RE = re.compile(r"^<!--@\s*\n(.*?)\n-->\s*\n", re.S)


def parse_front_matter(text: str) -> tuple[dict, str]:
    m = FM_RE.match(text)
    if not m:
        return {}, text
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.rstrip()
        if not line or ":" not in line:
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    return meta, text[m.end():]


# ------------------------------------------------------------------ partials --
def partial(name: str) -> str:
    if not os.path.isdir(PARTIALS):
        raise SystemExit(
            "build.py: template sources are missing from this workspace snapshot\n"
            "  (the directory name 'build/' is excluded from snapshots, so build/partials,\n"
            "   build/pages and build/content did not persist).\n"
            "  The 24 generated pages at the repository root are complete and authoritative -\n"
            "  serve them directly, e.g.:  python3 -m http.server 8000 --directory .\n"
            "  To regenerate pages, restore the template sources first.")
    return open(os.path.join(PARTIALS, name), encoding="utf-8").read()


HEAD = partial("head.html")
HEADER = partial("header.html")
FOOTER = partial("footer.html")
LEGALNAV = partial("legalnav.html")


def base_for(path: str) -> str:
    depth = len([p for p in path.split("/")[:-1] if p])
    return "../" * depth


def hreflang(canonical: str) -> str:
    out = []
    clean = canonical.split("?")[0]
    for code in LOCALES:
        href = clean if code == XDEFAULT else clean + "?lang=" + code
        out.append(f'<link rel="alternate" hreflang="{code}" href="{href}">')
    out.append(f'<link rel="alternate" hreflang="x-default" href="{clean}">')
    return "\n".join(out)


def jsonld(kind: str, meta: dict) -> str:
    """Build the JSON-LD block for a page (empty string when kind == 'none')."""
    if not kind or kind == "none":
        return ""
    blocks: list[dict] = []
    org = {
        "@type": "Organization",
        "name": "GoTax.SI",
        "url": SITE + "/",
        "description": "AI-assisted IRS notice explanations and tax return preparation support, "
                       "reviewed by licensed CPA/EA partners. Not a law firm and not affiliated with the IRS.",
        "email": "support@gotax.si",
        "knowsLanguage": LOCALES,
        "areaServed": "US",
    }
    if "organization" in kind:
        blocks.append({"@context": "https://schema.org", **org})
    if "faq" in kind:
        faq = faq_from_locale_file()
        if faq:
            blocks.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": faq})
    if "service" in kind:
        blocks.append({
            "@context": "https://schema.org",
            "@type": "Service",
            "name": meta.get("title", "GoTax.SI"),
            "description": meta.get("description", ""),
            "url": meta.get("canonical", SITE + "/"),
            "provider": {k: v for k, v in org.items() if k != "@type"} | {"@type": "Organization"},
            "audience": {"@type": "Audience", "audienceType": "US taxpayers receiving IRS notices"},
            "availableLanguage": LOCALES,
        })
    if "offers" in kind:
        try:
            services = json.load(open(os.path.join(ROOT, "data", "services.json"), encoding="utf-8"))
        except Exception:
            services = {"groups": []}
        offers = []
        for g in services.get("groups", []):
            for it in g.get("items", []):
                offers.append({
                    "@type": "Offer",
                    "name": en_value(it.get("i18nKey", "")) or it.get("id", ""),
                    "description": en_value(it.get("descKey", "")),
                    "price": it.get("usd"),
                    "priceCurrency": "USD",
                    "url": SITE + "/pricing.html#" + it.get("id", ""),
                    "availability": "https://schema.org/InStock",
                })
        if offers:
            blocks.append({"@context": "https://schema.org", "@type": "Product",
                           "name": "GoTax.SI services", "offers": offers})
    if "contact" in kind:
        blocks.append({"@context": "https://schema.org", **org,
                       "contactPoint": {"@type": "ContactPoint", "contactType": "customer support",
                                          "email": "support@gotax.si", "availableLanguage": LOCALES}})
    if "collection" in kind:
        blocks.append({"@context": "https://schema.org", "@type": "CollectionPage",
                       "name": meta.get("title", ""), "description": meta.get("description", ""),
                       "url": meta.get("canonical", "")})
    if not blocks:
        return ""
    return '<script type="application/ld+json">\n' + \
        "\n</script>\n".join(json.dumps(b, ensure_ascii=False, indent=2) for b in blocks) + "\n</script>"


_EN_DICT: dict | None = None


def en_dict() -> dict:
    global _EN_DICT
    if _EN_DICT is None:
        src = open(os.path.join(ROOT, "assets", "js", "i18n", "en.js"), encoding="utf-8").read()
        body = src[src.index("{"): src.rindex("}") + 1]
        try:
            _EN_DICT = json.loads(body)
        except Exception:
            pairs = re.findall(r"'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'", body)
            _EN_DICT = {k: v for k, v in pairs}
    return _EN_DICT


def en_value(key: str) -> str:
    return en_dict().get(key, "")


def faq_from_locale_file() -> list[dict]:
    try:
        services = json.load(open(os.path.join(ROOT, "data", "services.json"), encoding="utf-8"))
    except Exception:
        return []
    out = []
    for k in services.get("faq", []):
        q = en_value(k)
        a = en_value(k.replace(".q", ".a"))
        if q and a:
            out.append({"@type": "Question", "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a}})
    return out


# ------------------------------------------------------------------- render --
def render(meta: dict, body: str, src_path: str) -> str:
    path = meta["path"]
    base = base_for(path)
    canonical = meta.get("canonical") or (SITE + "/" + path if path != "index.html" else SITE + "/")
    if canonical.endswith("index.html"):
        canonical = canonical[: -len("index.html")]

    scripts = ""
    for s in [x.strip() for x in meta.get("scripts", "").split(",") if x.strip()]:
        s = s if s.startswith(base) or s.startswith("http") else base + s
        scripts += f'<script src="{s}" defer></script>\n'

    robots = "noindex,nofollow" if meta.get("noindex") == "true" else "index,follow,max-image-preview:large"

    head = (HEAD
            .replace("{{TITLE}}", meta.get("title", "GoTax.SI"))
            .replace("{{DESCRIPTION}}", meta.get("description", ""))
            .replace("{{CANONICAL}}", canonical)
            .replace("{{HREFLANG}}", hreflang(canonical))
            .replace("{{SCRIPTS}}", scripts.rstrip("\n"))
            .replace("{{JSONLD}}", jsonld(meta.get("jsonld", "none"), meta))
            .replace("{{SLUG}}", meta.get("slug", "page"))
            .replace("{{BASE}}", base)
            .replace('<meta name="robots" content="index,follow,max-image-preview:large">',
                     f'<meta name="robots" content="{robots}">'))

    header = HEADER.replace("{{BASE}}", base)
    footer = FOOTER.replace("{{BASE}}", base)
    legalnav = LEGALNAV.replace("{{BASE}}", base)

    html = head + body
    html = html.replace("<!-- @head -->", "")
    html = html.replace("<!-- @header -->", header)
    html = html.replace("<!-- @legalnav -->", legalnav)
    html = html.replace("<!-- @footer -->", footer)
    html = html.replace("{{BASE}}", base)

    # mark the active legal nav item
    slug = meta.get("slug", "")
    if slug.startswith("legal-"):
        active = slug[len("legal-"):]
        html = re.sub(r'(<a href="[^"]*legal/%s\.html" data-legal="%s")' % (active, active),
                      r'\1 aria-current="page" class="active"', html)

    # icons last so injected SVG is never re-scanned
    def icon_sub(m: re.Match) -> str:
        name = m.group(1)
        return ICONS.get(name, "")

    html = re.sub(r"\{\{ICON_(\w+)\}\}", icon_sub, html)
    html = re.sub(r"\n{3,}", "\n\n", html)
    return html.strip() + "\n"


# ------------------------------------------------------------- notice pages --
NOTICE_TEMPLATE = """<!-- @head -->
<!-- @header -->

<main id="main">
  <div class="wrap" data-notice-code="{code}">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="{{{{BASE}}}}index.html" data-i18n="nav.home">Home</a><span aria-hidden="true">/</span>
      <a href="{{{{BASE}}}}notices/index.html" data-i18n="nav.notices">Notice library</a><span aria-hidden="true">/</span>
      <span aria-current="page">{code}</span>
    </nav>

    <header class="page-head notice-head">
      <p class="eyebrow"><span data-i18n="notices.explained">IRS notice explained</span> · <span class="mono">{code}</span></p>
      <h1>{title}</h1>
      <p class="lead">{summary}</p>
      <div class="pills">
        <span class="pill {risk_pill}">{{{{ICON_alert}}}} <span data-i18n="notices.risk{risk_cap}">{risk}</span></span>
        <span class="pill pill-muted">{{{{ICON_clock}}}} <span data-i18n="notices.deadlineTypical">Typical deadline</span>: {deadline}</span>
        {aliases_pill}
      </div>
    </header>

    {risk_banner}

    <div class="decoder-layout rail-right">
      <div class="decoder-main">
        <section class="bilingual notice-bilingual" id="notice-bilingual">
          <div class="lang-pane" id="pane-en" data-authoritative="true">
            <header><strong>English</strong><span class="pill pill-brand" data-i18n="lang.englishAuthoritative">Authoritative</span></header>
            <div class="body" id="pane-en-body">{sections_en}</div>
            <p class="mt-note" data-i18n="legal.notAdvice">Not legal or tax advice.</p>
          </div>
          <div class="lang-pane" id="pane-loc">
            <header><strong id="pane-loc-label">Your language</strong><span class="pill chip-mint" data-i18n="decoder.yourLangPane">Your language</span></header>
            <div class="body" id="pane-loc-body"></div>
            <p class="mt-note" id="pane-loc-note" data-i18n="lang.mtNote">Translations are machine-assisted. The English version controls.</p>
          </div>
        </section>

        <section class="card card-pad mt6" id="related">
          <h2 class="mt0" data-i18n="notices.relatedTitle">Related notices</h2>
          <div class="related-grid">{related}</div>
        </section>

        <section class="cta-band mt6">
          <div class="wrap cta-in">
            <h2 data-i18n="notices.decodeYours">Decode your notice</h2>
            <p class="lead" data-i18n="hero.sub">Upload a photo or PDF of the letter the IRS sent you.</p>
            <div class="btn-row center-both">
              <a class="btn btn-mint btn-lg" href="{{{{BASE}}}}decoder.html?code={code}">{{{{ICON_scan}}}}<span data-i18n="cta.startFree">Decode my notice free</span></a>
              <a class="btn btn-ghost btn-lg on-dark" href="{{{{BASE}}}}pricing.html"><span data-i18n="cta.seePricing">See pricing</span></a>
            </div>
          </div>
        </section>
      </div>

      <aside class="decoder-rail pane-sticky">
        <div class="card card-pad">
          <h2 class="mt0 h-card">{{{{ICON_doc}}}} <span data-i18n="notices.atAGlance">At a glance</span></h2>
          <dl class="kv">
            <div><dt data-i18n="decoder.fType">Notice type</dt><dd class="mono">{code}</dd></div>
            <div><dt data-i18n="notices.risk">Risk level</dt><dd><span class="pill {risk_pill}" data-i18n="notices.risk{risk_cap}">{risk}</span></dd></div>
            <div><dt data-i18n="notices.deadlineTypical">Typical deadline</dt><dd>{deadline}</dd></div>
            <div><dt data-i18n="notices.responseNeeded">Response needed</dt><dd>{response}</dd></div>
          </dl>
          {risk_tags}
        </div>

        <div class="card card-pad mt4">
          <h2 class="mt0 h-card">{{{{ICON_brain}}}} <span data-i18n="decoder.explanationTitle">Get your own explanation</span></h2>
          <p class="small muted" data-i18n="decoder.sub">Upload your IRS notice. Get a clear, bilingual explanation in minutes.</p>
          <a class="btn btn-primary btn-block btn-sm mt2" href="{{{{BASE}}}}decoder.html?sample={sample_key}">{{{{ICON_scan}}}}<span data-i18n="cta.trySample">Try a sample notice</span></a>
          <a class="btn btn-outline btn-block btn-sm mt2" href="{{{{BASE}}}}decoder.html">{{{{ICON_upload}}}}<span data-i18n="cta.upload">Upload your notice</span></a>
        </div>

        <div class="card card-pad mt4">
          <h2 class="mt0 h-card">{{{{ICON_globe}}}} <span data-i18n="notices.otherLangs">Read this in your language</span></h2>
          <div data-lang-switcher></div>
          <p class="tiny muted mt2" data-i18n="lang.mtNote">Translations are machine-assisted. The English version controls.</p>
        </div>

        <div class="card card-pad mt4">
          <h2 class="mt0 h-card">{{{{ICON_shield}}}} <span data-i18n="legal.notAdvice">Not legal or tax advice</span></h2>
          <p class="tiny muted" data-i18n="legal.disclaimer">GoTax.SI provides AI-assisted explanations and document preparation support. It is not a law firm or a government agency and is not affiliated with the IRS. Information is general and not legal or tax advice.</p>
          <p class="tiny muted" data-i18n="legal.reviewedBy">Prepared returns are reviewed and signed by a licensed US CPA or EA partner before filing.</p>
        </div>
      </aside>
    </div>
  </div>
</main>

<!-- @footer -->
"""


def esc(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def slugify(code: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", code.lower())


def render_sections(sections: dict, titles: dict) -> str:
    out = []
    for i in range(1, 8):
        key = f"sec{i}"
        sec = sections.get(key) or {}
        paras = sec.get("p") or []
        bullets = sec.get("b") or []
        if not paras and not bullets:
            continue
        out.append(f"<h3>{esc(titles.get(key, key))}</h3>")
        for p in paras:
            out.append(f"<p>{esc(p)}</p>")
        if bullets:
            out.append("<ul>" + "".join(f"<li>{esc(b)}</li>" for b in bullets) + "</ul>")
    return "\n".join(out)


def build_notice_pages(notices: list[dict], write: bool) -> list[str]:
    titles = {f"sec{i}": en_value(f"decoder.sec{i}") for i in range(1, 8)}
    made = []
    for n in notices:
        code = n["code"]
        slug = slugify(code)
        path = f"notices/{slug}.html"
        risk = n.get("risk", "medium")
        risk_pill = {"high": "pill-danger", "medium": "pill-warn", "low": "pill-ok"}[risk]
        risk_cap = {"high": "High", "medium": "Med", "low": "Low"}[risk]
        summary = (n.get("summary") or {}).get("en", "")
        sections = (n.get("sections") or {}).get("en") or {}
        aliases = n.get("aliases") or []
        risk_tags = n.get("riskTags") or []
        related = n.get("related") or []

        risk_banner = ""
        if risk == "high":
            tag_txt = ", ".join(en_value("risk." + t) or t for t in risk_tags) or "high risk"
            risk_banner = (
                '<div class="banner banner-danger"><span>{{ICON_alert}}</span><div>'
                f'<h2 class="mt0" data-i18n="decoder.riskBanner">Talk to a licensed professional</h2>'
                f'<p>{esc(en_value("decoder.riskBannerBody"))}</p>'
                f'<p class="small"><strong>{esc(tag_txt)}</strong></p>'
                '<div class="btn-row"><a class="btn btn-sm btn-primary" href="{{BASE}}decoder.html">'
                '<span data-i18n="cta.talkToPro">Talk to a licensed professional</span></a>'
                '<a class="btn btn-sm btn-outline" href="{{BASE}}contact.html?notice=' + code + '">'
                '<span data-i18n="contact.title">Contact &amp; help</span></a></div></div></div>')

        have_page = {x["code"] for x in notices}

        def rel_card(r):
            title = next((x.get("title", "") for x in notices if x["code"] == r), "")
            if r not in have_page:
                # no SEO page for this code yet: show a chip, never a dead link
                return (f'<span class="rel-card static"><span class="mono">{esc(r)}</span>'
                        f'<span class="tiny muted">{esc(title or "no page yet")}</span></span>')
            return (f'<a class="rel-card" href="{{{{BASE}}}}notices/{slugify(r)}.html"><span class="mono">{esc(r)}</span>'
                    f'<span class="tiny muted">{esc(title)}</span></a>')

        related_html = "".join(rel_card(r) for r in related) or '<p class="small muted">—</p>'

        risk_tags_html = ""
        if risk_tags:
            risk_tags_html = ('<p class="tiny muted mt4">' +
                              " ".join(f'<span class="pill pill-danger">{esc(en_value("risk." + t) or t)}</span>'
                                       for t in risk_tags) + '</p>')

        body = NOTICE_TEMPLATE.format(
            code=esc(code),
            title=esc(n.get("title", code)),
            summary=esc(summary),
            risk_pill=risk_pill,
            risk_cap=risk_cap,
            risk=esc(risk),
            deadline=esc(n.get("typicalDeadline", "—")),
            aliases_pill=(f'<span class="pill pill-info">aka {esc(", ".join(aliases))}</span>' if aliases else ""),
            risk_banner=risk_banner,
            sections_en=render_sections(sections, titles),
            related=related_html,
            response=esc(en_value("notices.responseYes") or "Yes — respond in writing"),
            risk_tags=risk_tags_html,
            sample_key=code,
        )

        meta = {
            "title": f"{code} notice explained — what it means and what to do | GoTax.SI",
            "description": (summary[:155] + "…") if len(summary) > 155 else summary,
            "path": path,
            "slug": "notice-" + slug,
            "canonical": SITE + "/" + path,
            "jsonld": "collection",
            "scripts": "assets/js/notice-page.js",
        }
        html = render(meta, body, path)
        made.append(path)
        if write:
            out = os.path.join(ROOT, path)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, "w", encoding="utf-8").write(html)
    return made


# --------------------------------------------------------------- samples.js --
SAMPLE_KEYS = {
    "cp2000": ("CP2000", "notice", 2, 0.94),
    "cp14": ("CP14", "notice", 1, 0.96),
    "cp11": ("CP11", "notice", 1, 0.95),
    "cp501": ("CP501", "notice", 1, 0.93),
    "cp504": ("CP504", "notice", 2, 0.9),
    "ltr3219c": ("LTR3219C", "notice", 2, 0.88),
    "ltr5071c": ("LTR5071C", "notice", 1, 0.91),
    "ltr569c": ("LTR569C", "notice", 2, 0.87),
    "w2-2024": ("W2", "return", 1, 0.95),
    "1099-nec": ("1099-NEC", "return", 1, 0.92),
    "1099-k": ("1099-K", "return", 1, 0.89),
}


def build_samples(notices: list[dict], write: bool) -> str:
    sdir = os.path.join(ROOT, "samples")
    out: dict[str, dict] = {}
    for fname in sorted(os.listdir(sdir)):
        if not fname.endswith(".txt"):
            continue
        stem = fname[:-4]
        key, group, pages, conf = SAMPLE_KEYS.get(stem, (stem.upper(), "notice", 1, 0.9))
        text = open(os.path.join(sdir, fname), encoding="utf-8").read().replace("\r\n", "\n")
        n = next((x for x in notices if x["code"] == key), None)
        label = n["title"] if n else (
            {"W2": "Form W-2 (2024) — wage and tax statement",
             "1099-NEC": "Form 1099-NEC — nonemployee compensation",
             "1099-K": "Form 1099-K — third party network payments"}.get(key, key))
        out[key] = {
            "label": label,
            "group": group,
            "pages": pages,
            "ocrConfidence": conf,
            "text": text,
        }
    js = ("/* Generated by build.py from samples/*.txt — fictional documents.\n"
          "   All names, numbers, addresses and amounts are invented for this demo. */\n"
          "window.NOTICE_SAMPLES = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")
    if write:
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        open(os.path.join(ROOT, "data", "samples.js"), "w", encoding="utf-8").write(js)
    return js


# --------------------------------------------------- sitemap / robots / 404 --
def build_sitemap(paths: list[str], write: bool) -> str:
    urls = []
    for p in sorted(set(paths)):
        loc = SITE + "/" + p
        if loc.endswith("index.html"):
            loc = loc[: -len("index.html")]
        prio = "1.0" if p == "index.html" else ("0.8" if p.startswith("notices/") or p in
                                                ("decoder.html", "pricing.html", "returns.html") else "0.6")
        if p in ("account.html", "admin.html", "checkout.html", "receipts.html"):
            continue
        urls.append(f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{TODAY}</lastmod>\n"
                    f"    <changefreq>monthly</changefreq>\n    <priority>{prio}</priority>\n  </url>")
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
           '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + "\n".join(urls) + "\n</urlset>\n")
    if write:
        open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(xml)
    return xml


def build_robots(write: bool) -> str:
    txt = (f"User-agent: *\nAllow: /\nDisallow: /account.html\nDisallow: /admin.html\n"
           f"Disallow: /checkout.html\nDisallow: /receipts.html\n\nSitemap: {SITE}/sitemap.xml\n")
    if write:
        open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write(txt)
    return txt


# --------------------------------------------------------------------- main --
def main() -> int:
    write = "--check" not in sys.argv
    notices = json.load(open(os.path.join(ROOT, "data", "notices.json"), encoding="utf-8")).get("notices", [])

    built: list[str] = []
    for dirpath, _dirs, files in os.walk(PAGES):
        for f in sorted(files):
            if not f.endswith(".html"):
                continue
            src = os.path.join(dirpath, f)
            raw = open(src, encoding="utf-8").read()
            meta, body = parse_front_matter(raw)
            if "path" not in meta:
                meta["path"] = os.path.relpath(src, PAGES).replace(os.sep, "/")
            html = render(meta, body, src)
            rel = meta["path"]
            built.append(rel)
            if write:
                out = os.path.join(ROOT, rel)
                os.makedirs(os.path.dirname(out) or ROOT, exist_ok=True)
                open(out, "w", encoding="utf-8").write(html)

    built += build_notice_pages(notices, write)
    build_samples(notices, write)
    build_sitemap(built, write)
    build_robots(write)

    print(f"{'built' if write else 'checked'} {len(built)} pages")
    for p in sorted(built):
        print("  " + p)
    print(f"icons resolved: {len(ICONS)}")
    print(f"samples: {len(SAMPLE_KEYS)} entries -> data/samples.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
