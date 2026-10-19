/* ============================================================
   GoTax.SI — Notice Decoder engine
   ------------------------------------------------------------
   Pipeline: ingest -> (real PDF text extraction | demo OCR)
             -> redaction -> field extraction (with source quotes)
             -> classification + risk -> explanation template
             -> localisation (English authoritative + user locale)

   In production the OCR step is a cloud OCR call and the
   classification/explanation steps are LLM calls with prompts that
   forbid inventing facts and require quoting OCR text. The function
   signatures here match that contract 1:1 — see backend/openapi.yaml.
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  var Decode = W.Decode = {};

  /* ---------------------------------------------------------
     1. INGEST — real text extraction for PDFs, demo OCR otherwise
     --------------------------------------------------------- */

  /* Pull readable text out of a PDF's content streams. Handles both
     uncompressed streams and FlateDecode (via DecompressionStream). */
  Decode.pdfText = async function (arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var latin = '';
    for (var i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);

    var out = [];
    var re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    var m, streams = [];
    while ((m = re.exec(latin)) !== null) streams.push(m[1]);

    for (var s = 0; s < streams.length; s++) {
      var raw = streams[s];
      var text = null;
      if (/\bFlateDecode\b/.test(latin.slice(Math.max(0, latin.indexOf(raw) - 400), latin.indexOf(raw)))) {
        text = await inflate(latinToBytes(raw));
      }
      if (text === null && !/^x/.test(raw)) text = raw;   /* already uncompressed */
      if (!text) continue;
      out.push(extractTextOps(text));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  function latinToBytes(str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xFF;
    return b;
  }
  async function inflate(bytes) {
    try {
      if (typeof DecompressionStream === 'undefined') return null;
      var ds = new DecompressionStream('deflate');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      var buf = await new Response(stream).arrayBuffer();
      var arr = new Uint8Array(buf), s = '';
      for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
      return s;
    } catch (e) {
      try {
        var ds2 = new DecompressionStream('deflate-raw');
        var st2 = new Blob([bytes]).stream().pipeThrough(ds2);
        var b2 = await new Response(st2).arrayBuffer();
        var a2 = new Uint8Array(b2), s2 = '';
        for (var j = 0; j < a2.length; j++) s2 += String.fromCharCode(a2[j]);
        return s2;
      } catch (e2) { return null; }
    }
  }
  /* Read (string) Tj / [..] TJ operators into plain text with spacing hints */
  function extractTextOps(content) {
    var out = '';
    var re = /\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:[^\[\]]|\\.)*)\]\s*TJ|(T\*|Td|TD|Tm|ET)/g;
    var m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] !== undefined) out += unescapePdfString(m[1]);
      else if (m[2] !== undefined) {
        var parts = m[2].match(/\(((?:\\.|[^\\()])*)\)|(-?\d+(?:\.\d+)?)/g) || [];
        parts.forEach(function (p) {
          if (p[0] === '(') out += unescapePdfString(p.slice(1, -1));
          else if (parseFloat(p) < -120) out += ' ';
        });
      } else if (m[3]) out += '\n';
    }
    return out;
  }
  function unescapePdfString(s) {
    return s.replace(/\\(\d{1,3}|.)/g, function (_, g) {
      if (/^\d+$/.test(g)) return String.fromCharCode(parseInt(g, 8));
      if (g === 'n') return '\n';
      if (g === 'r') return '\r';
      if (g === 't') return '\t';
      return g;
    });
  }

  /* Demo OCR corpus: what a phone photo of each notice "reads as".
     Skew, page count and confidence are simulated deterministically. */
  /* The demo OCR corpus lives in data/samples.js (loaded by a <script> tag or
     lazily injected by the page controller), so resolve it on every access. */
  var SAMPLES = null;
  function corpus() {
    if (!SAMPLES || !Object.keys(SAMPLES).length) SAMPLES = W.NOTICE_SAMPLES || {};
    return SAMPLES;
  }
  Decode.samples = function () { return corpus(); };

  /**
   * @param {Object} input {file?:File, text?:string, sampleCode?:string}
   * @param {Function} onStep (key, pct) progress callback
   */
  Decode.ingest = async function (input, onStep) {
    onStep = onStep || function () {};
    var res = { text: '', pages: 1, kind: 'pasted', ocrConfidence: 0.98, notes: [] };

    if (input.text && input.text.trim().length > 0) {
      onStep('scan', 20);
      res.text = input.text.replace(/\r/g, '').trim();
      res.kind = 'pasted';
      /* crude quality signal: longer, digit-rich text OCRs better */
      var digits = (res.text.match(/\d/g) || []).length;
      res.ocrConfidence = clamp(0.86 + Math.min(digits, 40) * 0.003 + Math.min(res.text.length, 1200) / 9000, 0.86, 0.99);
      res.notes.push('text-pasted');
      onStep('ocr', 70);
      await App.sleep(320);
      return res;
    }

    if (input.sampleCode && corpus()[input.sampleCode]) {
      onStep('scan', 20);
      var s = corpus()[input.sampleCode];
      res.text = s.text;
      res.pages = s.pages || 1;
      res.kind = 'sample';
      res.ocrConfidence = s.ocrConfidence || 0.93;
      res.sampleCode = input.sampleCode;
      res.notes.push('sample');
      onStep('ocr', 70);
      await App.sleep(380);
      return res;
    }

    if (!input.file) throw new Error('no-input');
    onStep('scan', 15);
    await App.sleep(260);

    var sniff = await App.sniffFile(input.file);
    res.kind = sniff.kind;
    res.name = input.file.name;
    res.size = input.file.size;
    res.sizeLabel = App.formatBytes(input.file.size);
    if (sniff.kind !== 'unknown') res.notes.push('magic-bytes:' + sniff.kind);

    onStep('ocr', 45);
    var buf = await input.file.arrayBuffer();
    var text = '';
    if (sniff.kind === 'pdf') {
      text = await Decode.pdfText(buf);
      res.pages = Math.max(1, (new TextDecoder('latin1').decode(new Uint8Array(buf)).match(/\/Type\s*\/Page[^s]/g) || []).length);
      res.notes.push('pdf-text-layer:' + (text.length > 40 ? 'extracted' : 'none'));
    }

    /* No embedded text (scanned photo / image PDF) → production would call
       the OCR service here. The demo falls back to a representative corpus
       and says so explicitly in the UI. */
    if (!text || text.trim().length < 40) {
      var guess = input.fallbackSample || guessSampleFromName(input.file.name) || 'CP2000';
      var smp = corpus()[guess] || corpus().CP2000;
      text = smp.text;
      res.pages = smp.pages || 1;
      res.ocrConfidence = 0.78 + Math.random() * 0.12;
      res.notes.push('demo-ocr');
      res.notes.push('deskew:applied');
      if (res.kind === 'jpeg' || res.kind === 'png') res.notes.push('image-photo');
    } else {
      res.ocrConfidence = clamp(0.9 + text.length / 20000, 0.9, 0.985);
    }

    res.text = text.trim();
    onStep('ocr', 95);
    await App.sleep(300);
    return res;
  };

  function guessSampleFromName(name) {
    var n = String(name || '').toUpperCase();
    var found = Object.keys(corpus()).filter(function (k) { return n.indexOf(k.toUpperCase().replace('LTR', 'LETTER')) >= 0 || n.indexOf(k.toUpperCase()) >= 0; });
    return found[0] || null;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------------------------------------------------
     2. REDACTION — mask SSN/ITIN, bank accounts, EIN, phone
     --------------------------------------------------------- */
  var REDACTORS = [
    { key: 'ssn', labelKey: 'decoder.redactSsn', mask: 'XXX-XX-####',
      re: /\b(\d{3})[- ]?(\d{2})[- ]?(\d{4})\b/g },
    { key: 'itin', labelKey: 'decoder.redactSsn', mask: '9XX-XX-####',
      re: /\b(9\d{2})[- ]?(?:7\d|8\d|5\d|4\d|3\d|2\d|1\d|0\d)[- ]?(\d{4})\b/g },
    { key: 'bank', labelKey: 'decoder.redactBank', mask: 'XXXX####',
      re: /(?:account(?:\s*#|\s*no\.?|\s*number)?|acct\.?|routing(?:\s*#|\s*no\.?)?)\s*[:#]?\s*([0-9][0-9\- ]{6,20}[0-9])/gi },
    { key: 'longacct', labelKey: 'decoder.redactBank', mask: 'XXXX####',
      re: /\b(\d{9,17})\b/g },
    { key: 'ein', labelKey: 'decoder.redactEin', mask: 'XX-XXXXXXX',
      re: /\b(\d{2})-(\d{7})\b/g },
    { key: 'phone', labelKey: 'decoder.redactPhone', mask: '(XXX) XXX-####',
      re: /(\(\d{3}\)\s?\d{3}[-.]?\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b)/g }
  ];

  /**
   * Returns {clean, findings:[{key,labelKey,original,masked,line}], count}
   * The cleaned text is what would be sent to the LLM.
   */
  Decode.redact = function (text) {
    var findings = [];
    var clean = String(text || '');

    /* keep IRS phone numbers visible — they are public information */
    var protectedPhones = (clean.match(/(?:call|phone|telephone|toll[- ]free)[^\n]{0,40}?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/gi) || []);
    var placeholders = [];
    protectedPhones.forEach(function (p, i) {
      var ph = '\u0000PHONE' + i + '\u0000';
      clean = clean.replace(p, ph);
      placeholders.push([ph, p]);
    });

    REDACTORS.forEach(function (r) {
      clean = clean.replace(r.re, function () {
        var args = Array.prototype.slice.call(arguments);
        var full = args[0];
        var digits = full.replace(/\D/g, '');
        /* avoid masking dates, amounts, notice numbers, tax years */
        if (r.key === 'longacct') {
          if (digits.length < 9 || digits.length > 17) return full;
          if (/^(19|20)\d{2}$/.test(digits)) return full;
        }
        if (r.key === 'ssn' || r.key === 'itin') {
          /* skip things that look like dates or amounts */
          if (/^\d{2}[-\/]\d{2}[-\/]\d{2,4}$/.test(full.trim())) return full;
        }
        if (r.key === 'ein') {
          if (/^\d{2}-\d{2}-\d{2,4}$/.test(full.trim())) return full;
        }
        var masked = maskDigits(full, r.mask);
        findings.push({
          key: r.key, labelKey: r.labelKey, original: full, masked: masked,
          preview: previewDigits(full)
        });
        return masked;
      });
    });

    placeholders.forEach(function (p) { clean = clean.replace(p[0], p[1]); });

    /* de-duplicate identical findings */
    var seen = {}, uniq = [];
    findings.forEach(function (f) {
      var k = f.key + '|' + f.original;
      if (!seen[k]) { seen[k] = 1; uniq.push(f); }
    });
    return { clean: clean, findings: uniq, count: uniq.length };
  };

  function maskDigits(str, mask) {
    /* keep the last 4 digits visible, replace the rest with the mask shape */
    var digits = str.replace(/\D/g, '');
    var tail = digits.slice(-4);
    var body = mask.replace(/[#]+$/, '').replace(/X+$/, '');
    return (body || 'XXXX') + tail;
  }
  function previewDigits(str) {
    var d = str.replace(/\D/g, '');
    return '•'.repeat(Math.max(0, d.length - 4)) + d.slice(-4);
  }

  /* ---------------------------------------------------------
     3. FIELD EXTRACTION — every value carries its source quote
     --------------------------------------------------------- */
  /** "cp 014" / "CP014" / "cp14" -> "CP14"; "letter 3219c" -> "LTR3219C" */
  function normaliseCode(raw) {
    var c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!c) return null;
    var m;
    if ((m = c.match(/^CP0*(\d{1,4}[A-Z]?)$/))) return 'CP' + parseInt(m[1], 10) + (m[1].match(/[A-Z]$/) || [''])[0];
    if ((m = c.match(/^LTR0*(\d{1,4}[A-Z]?)$/))) return 'LTR' + parseInt(m[1], 10) + (m[1].match(/[A-Z]$/) || [''])[0];
    if ((m = c.match(/^(\d{3,4})C$/))) return 'LTR' + m[1] + 'C';
    return c;
  }
  /** Catalog lookup that understands aliases (LT11 -> LTR3219C, 5071C -> LTR5071C). */
  function catalogEntry(cat, code) {
    if (!code) return null;
    var norm = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (var i = 0; i < cat.length; i++) {
      var n = cat[i];
      if (String(n.code).toUpperCase().replace(/[^A-Z0-9]/g, '') === norm) return n;
      var al = n.aliases || [];
      for (var j = 0; j < al.length; j++) {
        if (String(al[j]).toUpperCase().replace(/[^A-Z0-9]/g, '') === norm) return n;
      }
    }
    return null;
  }

  function firstMatch(text, res, normalize) {
    for (var i = 0; i < res.length; i++) {
      var m = text.match(res[i]);
      if (m) {
        var raw = (m[1] || m[0]).trim();
        var val = normalize ? normalize(raw, m) : raw;
        if (val !== null && val !== undefined && val !== '') {
          return { value: val, quote: quoteAround(text, m.index, m[0].length) };
        }
      }
    }
    return null;
  }
  function quoteAround(text, idx, len) {
    var start = Math.max(0, text.lastIndexOf('\n', idx) + 1);
    var end = text.indexOf('\n', idx + len);
    if (end < 0) end = text.length;
    return text.slice(start, end).trim().slice(0, 180);
  }
  function money(raw) {
    var n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  }
  function parseDate(raw) {
    var s = String(raw).trim();
    var m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      var mo = parseInt(m[1], 10), d = parseInt(m[2], 10), y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) { var t = mo; mo = d; d = t; }   /* tolerate DD/MM */
      var iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      return { iso: iso, display: s, y: y, m: mo, d: d };
    }
    var m2 = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m2) {
      var months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
      var mm = months[m2[1].slice(0, 3).toLowerCase()];
      if (mm) return { iso: m2[3] + '-' + String(mm).padStart(2, '0') + '-' + String(m2[2]).padStart(2, '0'), display: s, y: +m2[3], m: mm, d: +m2[2] };
    }
    return null;
  }

  Decode.extract = function (text, ocrConfidence) {
    text = String(text || '');
    var F = [];

    /* --- notice code ---------------------------------------------------
       A notice often mentions OTHER codes in its body ("if you received
       Notice CP501…"), so every candidate is scored instead of taking the
       first textual hit: labelled header hits and hits near the top of the
       document win. */
    var CODE_RE = /\b(?:Notice\s+|Letter\s+|LTR\.?\s*)?(CP\s?-?\s?\d{2,4}[A-Z]?|LTR\s?-?\s?\d{3,4}[A-Z]?|\d{3,4}\s?-?\s?C)\b/gi;
    var cat = Decode.catalog();
    var cands = [];
    var cm;
    while ((cm = CODE_RE.exec(text)) !== null) {
      var rawCode = normaliseCode(cm[1]);
      if (!rawCode) continue;
      var labelled = /^(notice|letter|ltr)/i.test(cm[0]) &&
                     cm[0].toUpperCase().replace(/\s+/g, '') !== rawCode;
      cands.push({ code: rawCode, index: cm.index, len: cm[0].length, labelled: labelled });
    }
    var byCode = {};
    cands.forEach(function (c) {
      var e = byCode[c.code] || (byCode[c.code] = {
        code: c.code, score: 0, count: 0, first: c.index, firstLen: c.len, labelled: false
      });
      e.count++;
      e.score += 1;
      if (c.labelled) { e.score += 4; e.labelled = true; }
      if (c.index < 160) e.score += 3;          /* letterhead / title block */
      else if (c.index < 600) e.score += 1;
      if (c.index < e.first) { e.first = c.index; e.firstLen = c.len; }
    });
    Object.keys(byCode).forEach(function (k) {
      var e = byCode[k];
      var hit = catalogEntry(cat, e.code);
      if (hit) { e.score += 3; e.canonical = hit.code; }
    });
    var ranked = Object.keys(byCode).map(function (k) { return byCode[k]; })
      .sort(function (a, b) { return (b.score - a.score) || (a.first - b.first); });
    var best = ranked[0] || null;
    var code = best ? (best.canonical || best.code) : null;
    var matched = code ? catalogEntry(cat, code) : null;
    var codeQuote = best ? quoteAround(text, best.first, best.firstLen) : '';
    var codeConf = best ? (best.labelled ? 0.97 : 0.9) - (best.count > 1 ? 0 : 0.05) : 0;

    if (!code) {
      /* keyword-based classification: score every rule, take the strongest */
      var kw = [
        { re: /underreported|does not match what you\s+reported|information returns|proposed change to your return/i, code: 'CP2000', w: 3 },
        { re: /intent to levy|notice of levy|we intend to levy/i, code: 'CP504', w: 3 },
        { re: /final notice|right to a hearing|collection due process|notice of intent to seize/i, code: 'LTR3219C', w: 3 },
        { re: /identity verification|verify your identity|potentially fraudulent|5071/i, code: 'LTR5071C', w: 3 },
        { re: /examination of your (?:tax )?return|correspondence examination|we are examining/i, code: 'LTR569C', w: 3 },
        { re: /balance due|amount you owe|you owe/i, code: 'CP14', w: 2 },
        { re: /we changed your return|we made (?:a )?change[s]? to your return|refund adjustment/i, code: 'CP11', w: 2 },
        { re: /reminder|balance from an earlier notice|previous notice/i, code: 'CP501', w: 1 }
      ];
      var bestKw = null;
      kw.forEach(function (rule) {
        var m = text.match(rule.re);
        if (!m) return;
        var score = rule.w + (m.index < 900 ? 2 : 0) + (m.index < 300 ? 1 : 0);
        if (!bestKw || score > bestKw.score) {
          bestKw = { code: rule.code, score: score, quote: quoteAround(text, m.index, m[0].length) };
        }
      });
      if (bestKw) {
        var hit2 = catalogEntry(cat, bestKw.code);
        code = hit2 ? hit2.code : bestKw.code;
        matched = hit2;
        codeQuote = bestKw.quote;
        codeConf = 0.62;
        F.push(makeField('type', code + (hit2 && hit2.title ? ' — ' + hit2.title : ''), codeQuote, codeConf, 'keyword'));
      }
    }

    if (code && !F.some(function (f) { return f.key === 'type'; })) {
      /* A code we could read but that is not in the knowledge base is still
         reported — we never silently drop what the document says. */
      F.push(makeField('type', code + (matched && matched.title ? ' — ' + matched.title : ''), codeQuote, codeConf, 'pattern'));
    }
    if (!F.some(function (f) { return f.key === 'type'; })) F.push(makeField('type', null, '', 0, 'none'));

    /* --- tax year --- */
    var ym = firstMatch(text, [
      /tax\s*(?:year|period)\s*(?:is\s*)?[:#]?\s*(20\d{2})/i,
      /(?:for\s+(?:the\s+)?(?:tax\s+)?year|calendar\s+year|form\s+1040[-–]\s*)(20\d{2})/i,
      /\b(20\d{2})\s+(?:tax\s+year|form\s+1040|schedule)/i,
      /\b(20[12]\d)\b(?=[\s\S]{0,60}(?:form 1040|tax return))/i
    ]);
    F.push(makeField('year', ym ? ym.value : null, ym ? ym.quote : '', ym ? 0.9 : 0, 'pattern'));

    /* --- notice date --- */
    var nd = firstMatch(text, [
      /notice\s+date\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /date\s+(?:of\s+)?(?:this\s+)?(?:notice|letter)\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /^\s*date\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/im
    ]);
    var ndParsed = nd ? parseDate(nd.value) : null;
    F.push(makeField('date', ndParsed ? ndParsed.display : null, nd ? nd.quote : '', ndParsed ? 0.92 : 0, 'pattern', ndParsed ? ndParsed.iso : null));

    /* --- amounts --- */
    var owed = firstMatch(text, [
      /(?:total\s+)?amount\s+(?:you\s+)?owe\s*[:#]?\s*\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i,
      /balance\s+due\s*[:#]?\s*\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i,
      /you\s+owe\s+\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i,
      /total\s+amount\s+due\s*[:#]?\s*\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i,
      /additional\s+tax\s+(?:proposed|owed)?\s*[:#]?\s*\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i
    ]);
    F.push(makeField('owed', owed ? money(owed.value) : null, owed ? owed.quote : '', owed ? 0.93 : 0, 'pattern'));

    var refund = firstMatch(text, [
      /refund\s+(?:amount|of|issued)?\s*[:#]?\s*\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i,
      /(?:we|irs)\s+(?:will\s+)?(?:issue|send)\s+(?:you\s+)?(?:a\s+)?refund\s+of\s+\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i,
      /overpayment\s*[:#]?\s*\$?\s*([\d,]+\.\d{2}|\d[\d,]*)/i
    ]);
    F.push(makeField('refund', refund ? money(refund.value) : null, refund ? refund.quote : '', refund ? 0.9 : 0, 'pattern'));

    /* --- deadline --- */
    var dl = firstMatch(text, [
      /(?:respond|reply|response)\s+(?:by|before|no later than)\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(?:pay|payment)\s+(?:in full\s+)?(?:by|before)\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(?:response|reply|due)\s+date\s*[:#]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /within\s+(\d{1,3})\s+days/i,
      /by\s+([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
    ]);
    var dlParsed = null, dlDisplay = null;
    if (dl) {
      if (/^\d{1,3}$/.test(dl.value.trim()) && ndParsed) {
        var base = new Date(ndParsed.iso + 'T00:00:00Z');
        base.setUTCDate(base.getUTCDate() + parseInt(dl.value, 10));
        dlParsed = base.toISOString().slice(0, 10);
        dlDisplay = dlParsed + ' (' + dl.value.trim() + ' days from ' + ndParsed.display + ')';
      } else {
        dlParsed = (parseDate(dl.value) || {}).iso || null;
        dlDisplay = dl.value;
      }
    }
    F.push(makeField('deadline', dlDisplay, dl ? dl.quote : '', dlParsed ? 0.88 : 0, 'pattern', dlParsed));

    /* --- what changed / requested actions / contact --- */
    var changed = sentenceSearch(text, [
      /because[\s\S]{0,220}?(?:\.|\n\n)/i,
      /(?:does not match|doesn't match|discrepan|we (?:changed|adjusted|disallowed)|we did not receive|we have no record)[\s\S]{0,200}?(?:\.|\n\n)/i
    ]);
    F.push(makeField('changed', changed ? changed.value.trim() : null, changed ? changed.quote : '', changed ? 0.75 : 0, 'heuristic'));

    var actions = listSearch(text, [
      /what you need to do/i, /what you must do/i, /your (?:required )?action/i,
      /how to respond/i, /next steps/i, /please (?:do|complete|send|call)/i
    ]);
    var actItems = (actions && actions.value && actions.value.length) ? actions.value : null;
    F.push(makeField('actions', actItems, actions && actions.quote ? actions.quote : '', actItems ? 0.8 : 0, 'heuristic'));

    var phoneM = text.match(/(?:call|phone|telephone|toll[- ]free)[^\n]{0,60}?(\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4})/i) ||
                 text.match(/(\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4})/);
    var contactBits = [];
    if (phoneM) contactBits.push(phoneM[1]);
    var hoursM = text.match(/(?:monday[^\n]{0,60}|8:00[^\n]{0,40}|7:00[^\n]{0,40}(?:a\.?m\.?|local))/i);
    if (hoursM) contactBits.push(hoursM[0].trim());
    var webM = text.match(/(?:irs\.gov\/[a-z0-9\-\/]+)/i);
    if (webM) contactBits.push(webM[0]);
    F.push(makeField('contact', contactBits.length ? contactBits.join(' · ') : null, phoneM ? quoteAround(text, phoneM.index, phoneM[0].length) : '', contactBits.length ? 0.85 : 0, 'pattern'));

    /* --- risk --- */
    var risks = [];
    var riskTests = [
      { tag: 'audit', re: /\b(examination|audit|audited|we will (?:review|examine))\b/i },
      { tag: 'levy', re: /\b(levy|levies|seize|garnish|intent to levy)\b/i },
      { tag: 'lien', re: /\b(lien|notice of federal tax lien)\b/i },
      { tag: 'fraud', re: /\b(identity theft|identity verification|fraud|5071C|CP01B|form 14039)\b/i },
      { tag: 'criminal', re: /\b(criminal investigation|CID|summons)\b/i },
      { tag: 'collection', re: /\b(final notice|collection due process|3219C|LT11)\b/i }
    ];
    riskTests.forEach(function (r) {
      var m = text.match(r.re);
      if (m) risks.push({ tag: r.tag, quote: quoteAround(text, m.index, m[0].length) });
    });

    /* --- confidence --- */
    var typeField = F.filter(function (f) { return f.key === 'type'; })[0];
    var classConf = typeField ? typeField.confidence : 0.2;
    var filled = F.filter(function (f) { return f.value !== null && f.value !== '' && f.key !== 'type'; }).length;
    var coverage = filled / Math.max(1, F.length - 1);
    var ocrConf = clamp(typeof ocrConfidence === 'number' ? ocrConfidence : 0.9, 0.3, 1);
    var overall = clamp(ocrConf * 0.45 + classConf * 0.4 + coverage * 0.15, 0.1, 0.99);

    return {
      fields: F,
      noticeCode: typeField && typeField.value ? String(typeField.value).split(' ')[0] : null,
      matched: matched,
      risks: risks,
      confidence: { ocr: round2(ocrConf), classification: round2(classConf), overall: round2(overall), coverage: round2(coverage) },
      level: overall >= 0.85 ? 'high' : (overall >= 0.6 ? 'medium' : 'low')
    };
  };

  function round2(n) { return Math.round(n * 100) / 100; }

  function makeField(key, value, quote, confidence, method, normalized) {
    return { key: key, value: value === undefined ? null : value, quote: quote || '', confidence: confidence || 0, method: method || '', normalized: normalized || null };
  }
  function sentenceSearch(text, res) {
    for (var i = 0; i < res.length; i++) {
      var m = text.match(res[i]);
      if (m) return { value: m[0].replace(/\s+/g, ' ').trim(), quote: quoteAround(text, m.index, m[0].length) };
    }
    return null;
  }
  function listSearch(text, headers) {
    var lower = text.toLowerCase();
    for (var i = 0; i < headers.length; i++) {
      var m = text.match(headers[i]);
      if (!m) continue;
      var start = m.index + m[0].length;
      var chunk = text.slice(start, start + 900);
      var items = chunk.split(/\n+/).map(function (s) { return s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim(); })
        .filter(function (s) { return s.length > 12 && !/^(sincerely|department of the treasury|internal revenue)/i.test(s); });
      if (items.length) return { items: items.slice(0, 6), length: items.length, value: items.slice(0, 6), quote: quoteAround(text, m.index, m[0].length) };
    }
    return null;
  }

  /* ---------------------------------------------------------
     4. CATALOGUE + EXPLANATION
     --------------------------------------------------------- */
  var CATALOG = null;
  Decode.setCatalog = function (data) { CATALOG = (data && data.notices) || data || []; };
  Decode.catalog = function () { return CATALOG || []; };
  Decode.byCode = function (code) {
    if (!code) return null;
    var c = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return (CATALOG || []).filter(function (n) {
      return n.code.toUpperCase().replace(/[^A-Z0-9]/g, '') === c ||
        (n.aliases || []).some(function (a) { return a.toUpperCase().replace(/[^A-Z0-9]/g, '') === c; });
    })[0] || null;
  };

  var SECTION_KEYS = ['sec1', 'sec2', 'sec3', 'sec4', 'sec5', 'sec6', 'sec7'];

  /** Build the bilingual explanation object. */
  Decode.explain = function (analysis, locale) {
    var matched = analysis.matched || Decode.byCode(analysis.noticeCode);
    var en = buildLanguage(matched, 'en', analysis);
    var loc = locale && locale !== 'en' ? buildLanguage(matched, locale, analysis) : null;
    return {
      code: matched ? matched.code : (analysis.noticeCode || 'UNKNOWN'),
      title: matched ? matched.title : tIn(locale, 'decoder.unknownTitle', 'Unrecognised notice type'),
      risk: matched ? matched.risk : (analysis.risks.length ? 'high' : 'unknown'),
      en: en,
      locale: locale || 'en',
      localized: loc,
      translated: !!(loc && loc.translated),
      fallback: !!(loc && !loc.translated)
    };
  };

  function buildLanguage(notice, lang, analysis) {
    var fields = fieldMap(analysis);
    var out = { sections: {}, translated: false, source: notice ? notice.code : null };
    if (!notice) {
      /* Unrecognised document: general guidance, in the visitor's language,
         with an explicit warning that it is not notice-specific. */
      var note = tIn(lang, 'decoder.genericNote',
        'We could not match this document to a known IRS notice type. Everything below is general guidance: compare each value with your original notice and never act on this alone.');
      SECTION_KEYS.forEach(function (k, i) {
        out.sections[k] = { p: i === 0 ? [note, genericSection(i, fields, lang)] : [genericSection(i, fields, lang)], b: [] };
      });
      return out;
    }
    var src = (notice.sections && (notice.sections[lang] || notice.sections.en)) || notice.sections.en;
    out.translated = !!(notice.sections && notice.sections[lang]);
    SECTION_KEYS.forEach(function (k) {
      var s = src[k] || (notice.sections.en && notice.sections.en[k]) || { p: [], b: [] };
      out.sections[k] = {
        p: (s.p || []).map(function (x) { return fill(x, fields); }),
        b: (s.b || []).map(function (x) { return fill(x, fields); })
      };
    });
    return out;
  }

  function fieldMap(analysis) {
    var m = {};
    (analysis.fields || []).forEach(function (f) {
      m[f.key] = f.value === null || f.value === '' || f.value === undefined ? null : f.value;
    });
    m.notFound = W.t ? W.t('decoder.notFound') : 'Not found, please check the original notice.';
    m.amount = m.owed !== null && m.owed !== undefined ? (W.I18N ? W.I18N.money(m.owed) : ('$' + m.owed)) : (m.refund !== null ? (W.I18N ? W.I18N.money(m.refund) : ('$' + m.refund)) : null);
    return m;
  }
  function fill(str, fields) {
    return String(str).replace(/\{(\w+)\}/g, function (_, k) {
      var v = fields[k];
      if (v === null || v === undefined || v === '') return fields.notFound;
      return v;
    });
  }
  /** Generic seven-section explanation, localized, for documents we cannot
      match to data/notices.json. Never invents values: the deadline sentence
      switches depending on whether a deadline was actually read. */
  /** Translate a key in a SPECIFIC language (the localized pane may differ
      from the language the page is currently rendered in). Falls back to
      English, then to the running dictionary, then to a literal. */
  function tIn(lang, key, fallback) {
    var dicts = W.I18N || {};
    var d = dicts[lang] || dicts[String(lang || '').split('-')[0]];
    if (d && d[key]) return d[key];
    if (dicts.en && dicts.en[key]) return dicts.en[key];
    if (W.t) { var v = W.t(key); if (v && v !== key) return v; }
    return fallback;
  }

  function genericSection(i, fields, lang) {
    var T = function (k, fallback) { return tIn(lang, k, fallback); };
    var keys = ['decoder.gen1', 'decoder.gen2', fields.deadline ? 'decoder.gen3' : 'decoder.gen3none',
      'decoder.gen4', 'decoder.gen5', 'decoder.gen6', 'decoder.gen7'];
    var fallbacks = [
      'We could not match this document to a known IRS notice type, so this is a general explanation. Please compare every value below with the original notice.',
      'The notice asks you to do something. Look for a section titled "What you need to do", and for a response date. If a phone number is printed on the notice, that is the safest number to call.',
      fields.deadline
        ? 'A response date appears to be printed on the document. Missing it can lead to additional penalty, interest or enforcement action.'
        : 'No response deadline was found in the text we received. Check the original notice — missing a deadline can lead to additional penalty, interest or enforcement action.',
      'Your options usually include: agree and pay, disagree with evidence, request more time, or ask for a payment arrangement. Never ignore it.',
      'Have your filed return, any payment confirmations, and the documents the notice refers to ready before you respond.',
      'Take a photo of the whole notice, keep the envelope, and act before the deadline. If the amount is large or the wording mentions levy, lien, audit or identity theft, get licensed help first.',
      'Ask a professional: what exactly does the IRS want, what evidence do I have, what are the deadlines, and what are the consequences of each option?'
    ];
    return T(keys[i], fallbacks[i]);
  }

  /* ---------------------------------------------------------
     5. DRAFT RESPONSE LETTER (paid add-on, never auto-sent)
     --------------------------------------------------------- */
  Decode.draftLetter = function (analysis, explanation, opts) {
    opts = opts || {};
    var f = fieldMap(analysis);
    var who = opts.name || '[Your full name]';
    var ssn = opts.ssnMasked || '[XXX-XX-' + '####]';
    var lines = [
      '[Your full name]', '[Your street address]', '[City, State ZIP]', '[Your phone number] · [Your email]',
      '',
      new Date().toISOString().slice(0, 10),
      '',
      'Internal Revenue Service', f.contact ? '[' + f.contact + ']' : '[Address shown on the notice]',
      '',
      'Re: Response to IRS notice ' + (analysis.noticeCode || '[notice number]') +
        (f.year ? ' — Tax year ' + f.year : '') +
        (f.date ? ' — Notice date ' + f.date : ''),
      'Taxpayer: ' + who + '   SSN/ITIN: ' + ssn,
      '',
      'To whom it may concern:',
      '',
      'I received the above notice on ' + (f.date || '[date you received it]') + '. This letter responds within the response period shown on the notice' +
        (f.deadline ? ' (' + f.deadline + ')' : '') + '.',
      '',
      opts.position === 'disagree'
        ? 'I do not agree with the proposed change. The records enclosed support the amount I originally reported, and I request that the proposed adjustment be reversed.'
        : (opts.position === 'plan'
          ? 'I agree that an amount is due, but I am unable to pay it in full at this time. I am requesting an instalment agreement and enclose Form 9465 / a financial statement.'
          : 'I agree with the notice and enclose payment / authorise the payment arrangement described below.'),
      '',
      'Enclosed:',
      '  • Copy of the notice (page 1)',
      '  • ' + (f.year ? 'Filed Form 1040 for tax year ' + f.year : 'Copy of my filed return'),
      '  • Supporting documents listed in the explanation',
      '',
      'Please send written confirmation of the action taken on my account to the address above.',
      '',
      'Sincerely,',
      '',
      '_______________________________',
      who
    ];
    return {
      text: lines.join('\n'),
      disclaimer: 'Draft for review by a licensed professional. GoTax.SI never sends anything to the IRS on your behalf.'
    };
  };

  /* ---------------------------------------------------------
     6. PDF EXPORT (both languages)
     --------------------------------------------------------- */
  Decode.exportPdf = function (analysis, explanation) {
    var d = new PDF.Doc({
      title: 'GoTax.SI — Notice explanation ' + (analysis.noticeCode || ''),
      author: 'GoTax.SI',
      subject: 'AI-assisted explanation of an IRS notice. Not legal or tax advice.'
    });
    d.setHeader('GoTax.SI', 'Notice explanation' + (analysis.noticeCode ? ' — ' + analysis.noticeCode : ''));

    d.heading('Notice Decoder result', { size: 17 });
    d.paragraph(W.t('legal.disclaimer'), { size: 8.5, color: [0.35, 0.44, 0.5] });
    d.rule();

    d.heading(W.t('decoder.fieldsTitle'), { size: 13 });
    var labels = {
      type: W.t('decoder.fType'), year: W.t('decoder.fYear'), date: W.t('decoder.fDate'),
      owed: W.t('decoder.fOwed'), refund: W.t('decoder.fRefund'), deadline: W.t('decoder.fDeadline'),
      changed: W.t('decoder.fChanged'), actions: W.t('decoder.fActions'), contact: W.t('decoder.fContact')
    };
    analysis.fields.forEach(function (f) {
      var v = f.value;
      if (v === null || v === '' || v === undefined) v = W.t('decoder.notFound');
      if (f.key === 'owed' || f.key === 'refund') v = (typeof v === 'number') ? W.I18N.money(v) : v;
      if (Array.isArray(v)) v = v.join('; ');
      d.kv(labels[f.key] || f.key, v);
    });
    d.kv(W.t('decoder.confOverall'), Math.round(analysis.confidence.overall * 100) + '% (' + W.t('decoder.conf' + cap(analysis.level)) + ')');
    d.rule();

    renderLanguage(d, explanation.en, W.t('decoder.englishPane'), 'en');
    if (explanation.localized) {
      var sample = SECTION_KEYS.map(function (k) {
        var s2 = (explanation.localized.sections[k] || { p: [], b: [] });
        return (s2.p || []).concat(s2.b || []).join(' ');
      }).join(' ');
      if (PDF.isLatinSafe(sample)) {
        renderLanguage(d, explanation.localized, W.I18N.name(explanation.locale), explanation.locale);
      } else {
        d.heading(W.I18N.name(explanation.locale) + '  (' + explanation.locale + ')', { size: 13, before: 10 });
        d.paragraph('This translation uses a script that the built-in PDF fonts cannot embed (' + explanation.locale + '). ' +
          'Use "Print / Save as PDF" on this page to get a fully rendered bilingual PDF, or open the on-screen version.',
          { size: 10 });
      }
    }

    d.rule();
    d.paragraph(W.t('lang.mtNote'), { size: 9, color: [0.35, 0.44, 0.5] });
    d.paragraph(W.t('legal.notAdvice'), { size: 9, color: [0.35, 0.44, 0.5] });
    return d;
  };
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function renderLanguage(d, block, label, lang) {
    d.heading(label + (lang === 'en' ? '' : '  (' + lang + ')'), { size: 13, before: 10 });
    SECTION_KEYS.forEach(function (k, i) {
      var s = (block.sections && block.sections[k]) || { p: [], b: [] };
      d.heading((i + 1) + '. ' + W.t('decoder.' + k), { size: 11, before: 4, after: 3 });
      (s.p || []).forEach(function (p) { d.paragraph(p, { size: 10 }); });
      (s.b || []).forEach(function (b) { d.bullet(b, { size: 10 }); });
    });
  }
})();
