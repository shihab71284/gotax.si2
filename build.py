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
FALLBACK_PARTIALS = {
    "head.html": '<!doctype html>\n<html lang="en" dir="ltr">\n<head>\n<link rel="manifest" href="{{BASE}}manifest.webmanifest">\n<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-EWEL5GNQY6"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag(\'js\', new Date());\n\n  gtag(\'config\', \'G-EWEL5GNQY6\');\n</script>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>{{TITLE}}</title>\n<meta name="description" content="{{DESCRIPTION}}">\n<meta name="robots" content="index,follow,max-image-preview:large">\n<link rel="canonical" href="{{CANONICAL}}">\n{{HREFLANG}}\n<meta name="theme-color" content="#0b3a5c">\n<meta name="color-scheme" content="light">\n<meta name="format-detection" content="telephone=no">\n<meta property="og:type" content="website">\n<meta property="og:site_name" content="GoTax.SI">\n<meta property="og:title" content="{{TITLE}}">\n<meta property="og:description" content="{{DESCRIPTION}}">\n<meta property="og:url" content="{{CANONICAL}}">\n<meta property="og:locale" content="en_US">\n<meta property="og:locale:alternate" content="hi_IN">\n<meta property="og:locale:alternate" content="bn_BD">\n<meta property="og:locale:alternate" content="ar_EG">\n<meta property="og:locale:alternate" content="sw_KE">\n<meta property="og:locale:alternate" content="es_MX">\n<meta property="og:locale:alternate" content="de_DE">\n<meta property="og:locale:alternate" content="ko_KR">\n<meta property="og:locale:alternate" content="tl_PH">\n<meta property="og:locale:alternate" content="fr_FR">\n<meta property="og:locale:alternate" content="zh_CN">\n<meta property="og:locale:alternate" content="zh_TW">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="{{TITLE}}">\n<meta name="twitter:description" content="{{DESCRIPTION}}">\n<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'%3E%3Crect width=\'64\' height=\'64\' rx=\'14\' fill=\'%230b3a5c\'/%3E%3Ctext x=\'32\' y=\'44\' font-family=\'Helvetica,Arial\' font-size=\'30\' font-weight=\'700\' fill=\'%233ddc97\' text-anchor=\'middle\'%3ESI%3C/text%3E%3C/svg%3E">\n<link rel="icon" type="image/png" sizes="32x32" href="{{BASE}}assets/img/favicon-32.png">\n<link rel="icon" type="image/png" sizes="192x192" href="{{BASE}}assets/img/icon-192.png">\n<link rel="icon" type="image/png" sizes="512x512" href="{{BASE}}assets/img/icon-512.png">\n<link rel="apple-touch-icon" href="{{BASE}}assets/img/apple-touch-icon.png">\n<meta property="og:image" content="https://gotax.si/assets/img/icon-512.png">\n<meta property="og:image:width" content="512">\n<meta property="og:image:height" content="512">\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&family=Noto+Sans+Devanagari:wght@400;600;700&family=Noto+Sans+Bengali:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;600;700&family=Noto+Sans+SC:wght@400;600;700&family=Noto+Sans+TC:wght@400;600;700&family=Noto+Sans+KR:wght@400;600;700&display=swap">\n<link rel="stylesheet" href="{{BASE}}assets/css/styles.css">\n<link rel="stylesheet" href="{{BASE}}assets/css/print.css" media="print">\n<script>window.__GOTAX_BASE__ = "{{BASE}}";</script>\n<script src="{{BASE}}assets/js/i18n/en.js" defer></script>\n<script src="{{BASE}}assets/js/i18n.js" defer></script>\n<script src="{{BASE}}assets/js/app.js" defer></script>\n{{SCRIPTS}}\n{{JSONLD}}\n</head>\n<body class="page-{{SLUG}}">\n<a class="skip-link" href="#main" data-i18n="nav.skip">Skip to main content</a>\n',
    "header.html": '<div class="top-strip">\n  <div class="wrap top-strip-in">\n    <p class="ts-note"><span class="ts-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg></span><span data-i18n="lang.mtNote">Translations are machine-assisted. The English version controls.</span></p>\n    <div class="ts-right">\n      <span class="ts-lang" data-i18n="lang.showBoth">Every explanation is shown in English and your language, side by side.</span>\n      <a class="ts-link" href="{{BASE}}contact.html" data-i18n="contact.helpCenter">Help centre</a>\n    </div>\n  </div>\n</div>\n\n<header class="site-header" id="site-header">\n  <div class="wrap header-in">\n    <a class="brand" href="{{BASE}}index.html" aria-label="GoTax.SI home">\n      <span class="gt-mark" aria-hidden="true">SI</span>\n      <span class="gt-word">GoTax<span class="si">.SI</span></span>\n      <span class="brand-sub" data-i18n="brand.siMeaning">Smart Intelligence for taxes</span>\n    </a>\n\n    <nav class="main-nav" aria-label="Main">\n      <a href="{{BASE}}index.html" data-i18n="nav.home" data-nav="home">Home</a>\n      <a href="{{BASE}}decoder.html" data-i18n="nav.decoder" data-nav="decoder">Notice Decoder</a>\n      <a href="{{BASE}}returns.html" data-i18n="nav.returns" data-nav="returns">Return prep</a>\n      <a href="{{BASE}}pricing.html" data-i18n="nav.pricing" data-nav="pricing">Pricing</a>\n      <a href="{{BASE}}notices/index.html" data-i18n="nav.notices" data-nav="notices">Notice library</a>\n      <a href="{{BASE}}contact.html" data-i18n="nav.contact" data-nav="contact">Contact</a>\n    </nav>\n\n    <div class="header-tools">\n      <div data-lang-switcher></div>\n      <div data-account-chip></div>\n      <a class="btn btn-primary btn-sm header-cta" href="{{BASE}}decoder.html">\n        <span data-i18n="cta.startFree">Decode a notice</span>\n      </a>\n      <button class="icon-btn menu-btn" id="menu-btn" aria-expanded="false" aria-controls="drawer" data-i18n-attr="aria-label:nav.openMenu">\n        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>\n      </button>\n    </div>\n  </div>\n</header>\n\n<div class="drawer" id="drawer" data-open="false" aria-hidden="true">\n  <div class="drawer-scrim" data-close-drawer></div>\n  <div class="drawer-panel" role="dialog" aria-modal="true" data-i18n-attr="aria-label:nav.menu">\n    <div class="drawer-head">\n      <span class="brand"><span class="gt-mark" aria-hidden="true">SI</span><span class="gt-word">GoTax<span class="si">.SI</span></span></span>\n      <button class="icon-btn" data-close-drawer data-i18n-attr="aria-label:nav.closeMenu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>\n    </div>\n    <nav class="drawer-nav" aria-label="Mobile">\n      <a href="{{BASE}}index.html" data-i18n="nav.home" data-close-drawer>Home</a>\n      <a href="{{BASE}}decoder.html" data-i18n="nav.decoder" data-close-drawer>Notice Decoder</a>\n      <a href="{{BASE}}returns.html" data-i18n="nav.returns" data-close-drawer>Return prep</a>\n      <a href="{{BASE}}pricing.html" data-i18n="nav.pricing" data-close-drawer>Pricing</a>\n      <a href="{{BASE}}notices/index.html" data-i18n="nav.notices" data-close-drawer>Notice library</a>\n      <a href="{{BASE}}checkout.html" data-i18n="nav.checkout" data-close-drawer>Checkout</a>\n      <a href="{{BASE}}account.html" data-i18n="nav.account" data-close-drawer>Account</a>\n      <a href="{{BASE}}admin.html" data-i18n="nav.admin" data-close-drawer>Admin</a>\n      <a href="{{BASE}}contact.html" data-i18n="nav.contact" data-close-drawer>Contact &amp; help</a>\n      <a href="{{BASE}}legal/index.html" data-i18n="nav.legal" data-close-drawer>Legal</a>\n    </nav>\n    <div class="drawer-foot">\n      <div data-lang-switcher></div>\n      <p class="tiny muted" data-i18n="lang.mtNote">Translations are machine-assisted. The English version controls.</p>\n    </div>\n  </div>\n</div>\n\n<div class="demo-banner" data-demo-banner hidden>\n  <div class="wrap demo-banner-in">\n    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8.2v.1"/></svg></span>\n    <p><strong data-i18n="common.demoMode">Demo mode</strong> <span data-i18n="footer.analytics">No personal data is sent anywhere. Payments, OCR and AI results are simulated in your browser.</span></p>\n  </div>\n</div>\n\n',
    "footer.html": '<footer class="site-footer">\n  <div class="wrap footer-grid">\n    <div class="f-col f-brand">\n      <span class="brand"><span class="gt-mark" aria-hidden="true">SI</span><span class="gt-word">GoTax<span class="si">.SI</span></span></span>\n      <p class="f-tag" data-i18n="brand.tagline">Understand your IRS notice in minutes, in your own language.</p>\n      <p class="tiny muted" data-i18n="brand.siMeaning">Smart Intelligence for taxes</p>\n      <div class="badge-row">\n        <span class="seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 118 0v3"/></svg><span data-i18n="trust.d1">Encrypted in transit and at rest</span></span>\n        <span class="seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg><span data-i18n="trust.d2">No SSNs or full documents in logs</span></span>\n        <span class="seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg><span data-i18n="trust.d3">Reviewed by licensed professionals</span></span>\n      </div>\n      <p class="tiny muted mt4"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.2 10.6c.4-1.9-1.1-2.9-3.1-3.6l.7-2.6-1.6-.4-.6 2.5-1.3-.3.6-2.5L7.3 3l-.7 2.6c-.3-.1-.6-.2-1-.3v0L4.1 5l.3 1.2s.7-.2.7-.1c.4-.1.6.1.7.3l-.8 3v.2c0 0 .1 0 0 0l-.1.3-1 4c-.1.2-.3.5-.7.4 0 0-.7-.1-.7-.1L3 16l1.6.4.8.2-.7 2.8 1.6.4.6-2.6c.3.1.6.2.9.3l-.6 2.6 1.6.4.7-2.7c2.7.5 4.8.3 5.7-2.2.7-2-.1-3.2-1.6-4 1.1-.3 1.9-1 2.1-2.5zm-3.8 5c-.5 2-4 1-5.1.7l1-3.9c1.1.3 4.6.8 4.1 3.2zm.5-5.1c-.5 1.9-3.4.9-4.3.7l.9-3.6c.9.2 3.9.7 3.4 2.9z"/></svg> <span data-i18n="checkout.bitcoinDesc">Bitcoin accepted (on-chain and Lightning). Card and bank transfer also available.</span></p>\n    </div>\n\n    <div class="f-col">\n      <h4 data-i18n="footer.services">Services</h4>\n      <ul>\n        <li><a href="{{BASE}}decoder.html" data-i18n="nav.decoder">Notice Decoder</a></li>\n        <li><a href="{{BASE}}notices/cp2000.html">CP2000 <span data-i18n="notices.explained">explained</span></a></li>\n        <li><a href="{{BASE}}notices/cp504.html">CP504 <span data-i18n="notices.explained">explained</span></a></li>\n        <li><a href="{{BASE}}notices/ltr3219c.html">LTR3219C / LT11 <span data-i18n="notices.explained">explained</span></a></li>\n        <li><a href="{{BASE}}notices/ltr5071c.html">LTR5071C <span data-i18n="notices.explained">explained</span></a></li>\n        <li><a href="{{BASE}}returns.html" data-i18n="nav.returns">Tax return preparation</a></li>\n        <li><a href="{{BASE}}pricing.html" data-i18n="nav.pricing">Pricing</a></li>\n      </ul>\n    </div>\n\n    <div class="f-col">\n      <h4 data-i18n="footer.company">Company</h4>\n      <ul>\n        <li><a href="{{BASE}}index.html#how" data-i18n="steps.title">How it works</a></li>\n        <li><a href="{{BASE}}index.html#trust" data-i18n="trust.title">Security &amp; trust</a></li>\n        <li><a href="{{BASE}}index.html#faq" data-i18n="faq.title">FAQ</a></li>\n        <li><a href="{{BASE}}contact.html" data-i18n="contact.title">Contact &amp; help</a></li>\n        <li><a href="{{BASE}}account.html" data-i18n="nav.account">Your account</a></li>\n        <li><a href="{{BASE}}admin.html" data-i18n="nav.admin">Admin console</a></li>\n      </ul>\n    </div>\n\n    <div class="f-col">\n      <h4 data-i18n="footer.legalTitle">Legal</h4>\n      <ul>\n        <li><a href="{{BASE}}legal/privacy.html" data-i18n="legal.privacy">Privacy policy</a></li>\n        <li><a href="{{BASE}}legal/terms.html" data-i18n="legal.terms">Terms of service</a></li>\n        <li><a href="{{BASE}}legal/disclaimer.html" data-i18n="legal.disclaimerPage">Disclaimer</a></li>\n        <li><a href="{{BASE}}legal/refunds.html" data-i18n="legal.refunds">Refund policy</a></li>\n        <li><a href="{{BASE}}legal/retention.html" data-i18n="legal.retention">Data retention</a></li>\n      </ul>\n      <div class="f-lang" data-lang-switcher></div>\n    </div>\n  </div>\n\n  <div class="wrap footer-legal">\n    <p class="tiny">© <span data-year>2026</span> <span data-i18n="legal.businessName">[COMPANY LEGAL NAME — placeholder]</span> · <span data-i18n="legal.businessAddress">[REGISTERED ADDRESS — placeholder]</span> · <a href="mailto:support@gotax.si">support@gotax.si</a></p>\n    <p class="tiny" data-i18n="legal.disclaimer">GoTax.SI provides AI-assisted explanations and document preparation support. It is not a law firm or a government agency and is not affiliated with the IRS. Information is general and not legal or tax advice.</p>\n    <p class="tiny muted" data-i18n="footer.rights">All rights reserved. IRS, CP2000 and other notice names are used for identification only.</p>\n  </div>\n</footer>\n<a href="https://wa.me/8801578367800?text=Hello%2C%20I%20need%20help%20with%20my%20IRS%20notice." target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp" style="position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.25);z-index:9999;"><svg viewBox="0 0 24 24" width="30" height="30" fill="#fff" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></a>\n<script>if (\'serviceWorker\' in navigator) { window.addEventListener(\'load\', () => navigator.serviceWorker.register(\'/sw.js\')); }</script>\n<!-- GoTax.SI AI Assistant -->\n<style>\n#gt-chat-btn{position:fixed;left:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#0b3a5c;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.25);z-index:9999;font-size:24px}\n#gt-chat-panel{position:fixed;left:20px;bottom:88px;width:360px;max-width:calc(100vw - 40px);height:480px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.3);z-index:9999;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}\n#gt-chat-panel.gt-open{display:flex}\n.gt-chat-head{background:#0b3a5c;color:#fff;padding:14px 16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}\n.gt-chat-head button{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}\n#gt-chat-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f4f7fa}\n.gt-msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}\n.gt-msg-user{align-self:flex-end;background:#0b3a5c;color:#fff;border-bottom-right-radius:4px}\n.gt-msg-ai{align-self:flex-start;background:#fff;color:#1a2b3c;border:1px solid #dde5ec;border-bottom-left-radius:4px}\n.gt-chat-form{display:flex;gap:8px;padding:10px;border-top:1px solid #dde5ec;background:#fff}\n.gt-chat-form input{flex:1;border:1px solid #c9d4de;border-radius:8px;padding:9px 11px;font-size:14px;outline:none;min-width:0}\n.gt-chat-form input:focus{border-color:#0b3a5c}\n.gt-chat-form button{background:#0b3a5c;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:14px;cursor:pointer}\n.gt-chat-form button:disabled{opacity:.55;cursor:default}\n@media (max-width:480px){#gt-chat-panel{left:0;right:0;bottom:0;width:100%;max-width:100%;height:78vh;border-radius:14px 14px 0 0}}\n</style>\n<button id="gt-chat-btn" type="button" aria-label="Open AI chat assistant">&#128172;</button>\n<div id="gt-chat-panel" role="dialog" aria-label="GoTax.SI AI Assistant">\n  <div class="gt-chat-head"><span>GoTax.SI AI Assistant</span><button type="button" id="gt-chat-close" aria-label="Close chat">&times;</button></div>\n  <div id="gt-chat-msgs"><div class="gt-msg gt-msg-ai">Hello! I can explain IRS notices in plain language. Ask me anything about GoTax.SI.</div></div>\n  <form class="gt-chat-form" id="gt-chat-form"><input id="gt-chat-input" type="text" placeholder="Type your message..." maxlength="1000" autocomplete="off"><button type="submit" id="gt-chat-send">Send</button></form>\n</div>\n<script>\n(function(){\n  var btn=document.getElementById(\'gt-chat-btn\'),panel=document.getElementById(\'gt-chat-panel\'),closeBtn=document.getElementById(\'gt-chat-close\'),form=document.getElementById(\'gt-chat-form\'),input=document.getElementById(\'gt-chat-input\'),sendBtn=document.getElementById(\'gt-chat-send\'),msgs=document.getElementById(\'gt-chat-msgs\');\n  var history=[];\n  function toggle(open){panel.classList.toggle(\'gt-open\',open);if(open)input.focus();}\n  btn.addEventListener(\'click\',function(){toggle(!panel.classList.contains(\'gt-open\'));});\n  closeBtn.addEventListener(\'click\',function(){toggle(false);});\n  function addMsg(text,who){var d=document.createElement(\'div\');d.className=\'gt-msg \'+(who===\'user\'?\'gt-msg-user\':\'gt-msg-ai\');d.textContent=text;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d;}\n  form.addEventListener(\'submit\',function(e){\n    e.preventDefault();\n    var text=input.value.trim();if(!text)return;\n    input.value=\'\';addMsg(text,\'user\');history.push({role:\'user\',content:text});\n    sendBtn.disabled=true;var thinking=addMsg(\'Thinking...\',\'ai\');\n    fetch(\'/api/chat\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({site:\'gotax\',messages:history})})\n    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})\n    .then(function(res){\n      if(res.ok&&res.j&&res.j.reply){thinking.textContent=res.j.reply;history.push({role:\'assistant\',content:res.j.reply});}\n      else{thinking.innerHTML=\'AI chat is coming soon — for urgent help, message us on <a href="https://wa.me/8801578367800" target="_blank" rel="noopener noreferrer">WhatsApp</a>\';}\n    })\n    .catch(function(){thinking.innerHTML=\'AI chat is coming soon — for urgent help, message us on <a href="https://wa.me/8801578367800" target="_blank" rel="noopener noreferrer">WhatsApp</a>\';})\n    .finally(function(){sendBtn.disabled=false;msgs.scrollTop=msgs.scrollHeight;input.focus();});\n  });\n})();\n</script>\n',
    "legalnav.html": '<nav class="side-nav card card-pad" aria-label="Legal">\n  <h2 class="h-card" data-i18n="footer.legalTitle">Legal</h2>\n  <ul>\n    <li><a href="{{BASE}}legal/index.html" data-legal="index"><span data-i18n="legal.overview">Overview</span></a></li>\n    <li><a href="{{BASE}}legal/privacy.html" data-legal="privacy"><span data-i18n="legal.privacy">Privacy policy</span></a></li>\n    <li><a href="{{BASE}}legal/terms.html" data-legal="terms"><span data-i18n="legal.terms">Terms of service</span></a></li>\n    <li><a href="{{BASE}}legal/disclaimer.html" data-legal="disclaimer"><span data-i18n="legal.disclaimerPage">Disclaimer</span></a></li>\n    <li><a href="{{BASE}}legal/refunds.html" data-legal="refunds"><span data-i18n="legal.refunds">Refund policy</span></a></li>\n    <li><a href="{{BASE}}legal/retention.html" data-legal="retention"><span data-i18n="legal.retention">Data retention</span></a></li>\n  </ul>\n  <hr>\n  <p class="tiny muted" data-i18n="legal.updated">Last updated: [DATE — placeholder]</p>\n  <p class="tiny muted" data-i18n="legal.businessName">[COMPANY LEGAL NAME — placeholder]</p>\n  <a class="btn btn-sm btn-outline btn-block mt2" href="{{BASE}}contact.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg><span data-i18n="contact.title">Questions?</span></a>\n</nav>',
}


def partial(name: str) -> str:
    path = os.path.join(PARTIALS, name)
    if os.path.isfile(path):
        return open(path, encoding="utf-8").read()
    if name in FALLBACK_PARTIALS:
        return FALLBACK_PARTIALS[name]
    raise FileNotFoundError(f"build.py: partial '{name}' not found")


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
    "cp12": ("CP12", "notice", 1, 0.95),
    "cp501": ("CP501", "notice", 1, 0.93),
    "cp503": ("CP503", "notice", 1, 0.92),
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
