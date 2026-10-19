/* ============================================================
   GoTax.SI — minimal PDF writer (no dependencies)
   ------------------------------------------------------------
   Produces a valid PDF 1.4 with the standard base-14 fonts
   (Helvetica / Helvetica-Bold / Courier, WinAnsiEncoding) and a
   tiny layout engine: headings, wrapped paragraphs, bullets,
   key/value rows, rules, boxes and two-column panes.

   NOTE on scripts: base-14 fonts cannot render Devanagari,
   Bangla, Arabic, Korean or CJK. For those locales callers should
   use the browser "Print / Save as PDF" path (App.printView),
   which renders every script correctly. PDF.isLatinSafe(text)
   tells you which path will preserve the text.
   ============================================================ */
(function () {
  'use strict';

  /* ---- metrics (units/1000) ---- */
  var HELV = {
    ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,
    'A':667,'B':667,'C':722,'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':500,'K':667,'L':556,'M':833,'N':722,'O':778,'P':667,'Q':778,
    'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':278,'\\':278,']':278,'^':469,'_':556,'`':333,
    'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,'p':556,'q':556,
    'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,'x':500,'y':500,'z':500,'{':334,'|':260,'}':334,'~':584
  };
  var HELV_B = {
    ' ':278,'!':333,'"':474,'#':556,'$':556,'%':889,'&':722,"'":238,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,'8':556,'9':556,':':333,';':333,'<':584,'=':584,'>':584,'?':611,'@':975,
    'A':722,'B':722,'C':722,'D':722,'E':667,'F':611,'G':778,'H':722,'I':278,'J':556,'K':722,'L':611,'M':833,'N':722,'O':778,'P':667,'Q':778,
    'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,'X':667,'Y':667,'Z':611,'[':333,'\\':278,']':333,'^':584,'_':556,'`':333,
    'a':556,'b':611,'c':556,'d':611,'e':556,'f':333,'g':611,'h':611,'i':278,'j':278,'k':556,'l':278,'m':889,'n':611,'o':611,'p':611,'q':611,
    'r':389,'s':556,'t':333,'u':611,'v':556,'w':778,'x':556,'y':556,'z':500,'{':389,'|':280,'}':389,'~':584
  };

  /* WinAnsi byte values for the punctuation we actually use */
  var WINANSI = {
    '\u20AC':128,'\u201A':130,'\u0192':131,'\u201E':132,'\u2026':133,'\u2020':134,'\u2021':135,'\u02C6':136,
    '\u2030':137,'\u0160':138,'\u2039':139,'\u0152':140,'\u017D':142,'\u2018':145,'\u2019':146,'\u201C':147,
    '\u201D':148,'\u2022':149,'\u2013':150,'\u2014':151,'\u02DC':152,'\u2122':153,'\u0161':154,'\u203A':155,
    '\u0153':156,'\u017E':158,'\u0178':159,'\u00A0':160,'\u00A1':161,'\u00A2':162,'\u00A3':163,'\u00A4':164,
    '\u00A5':165,'\u00A6':166,'\u00A7':167,'\u00A8':168,'\u00A9':169,'\u00AA':170,'\u00AB':171,'\u00AC':172,
    '\u00AD':173,'\u00AE':174,'\u00AF':175,'\u00B0':176,'\u00B1':177,'\u00B2':178,'\u00B3':179,'\u00B4':180,
    '\u00B5':181,'\u00B6':182,'\u00B7':183,'\u00B8':184,'\u00B9':185,'\u00BA':186,'\u00BB':187,'\u00BC':188,
    '\u00BD':189,'\u00BE':190,'\u00BF':191,'\u00D7':215,'\u00F7':247
  };

  function charWidth(ch, bold) {
    var t = bold ? HELV_B : HELV;
    if (t[ch] !== undefined) return t[ch];
    var cp = ch.charCodeAt(0);
    if (cp >= 160 && cp <= 255) return t[String.fromCharCode(cp)] !== undefined ? t[String.fromCharCode(cp)] : 556;
    return 556;
  }
  function textWidth(str, size, bold) {
    var w = 0;
    for (var i = 0; i < str.length; i++) w += charWidth(str[i], bold);
    return (w * size) / 1000;
  }
  /* Characters that WinAnsi fonts can actually draw */
  function isLatinSafe(str) {
    for (var i = 0; i < str.length; i++) {
      var cp = str.charCodeAt(i);
      if (cp < 128) continue;
      if (WINANSI[str[i]] !== undefined) continue;
      if (cp >= 160 && cp <= 255) continue;
      return false;
    }
    return true;
  }
  function sanitise(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], cp = ch.charCodeAt(0);
      if (cp < 128 || WINANSI[ch] !== undefined || (cp >= 160 && cp <= 255)) out += ch;
      else if (ch === '\u0964' || ch === '\u3002') out += '.';
      else out += '?';
    }
    return out;
  }
  function toWinAnsiBytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var ch = str[i], cp = ch.charCodeAt(0);
      if (cp < 128) bytes.push(cp);
      else if (WINANSI[ch] !== undefined) bytes.push(WINANSI[ch]);
      else if (cp >= 160 && cp <= 255) bytes.push(cp);
      else bytes.push(63);
    }
    return bytes;
  }
  function escapePdf(str) {
    var bytes = toWinAnsiBytes(str), out = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b === 40) out += '\\(';
      else if (b === 41) out += '\\)';
      else if (b === 92) out += '\\\\';
      else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
      else out += String.fromCharCode(b);
    }
    return out;
  }

  /* ---- layout constants (A4 portrait, points) ---- */
  var PAGE = { w: 595.28, h: 841.89, ml: 48, mr: 48, mt: 52, mb: 56 };

  function Doc(opts) {
    opts = opts || {};
    this.title = opts.title || 'GoTax.SI document';
    this.author = opts.author || 'GoTax.SI';
    this.subject = opts.subject || '';
    this.pages = [];
    this._newPage();
  }
  Doc.prototype._newPage = function () {
    this.cur = { ops: [], y: PAGE.h - PAGE.mt };
    this.pages.push(this.cur);
    return this.cur;
  };
  Doc.prototype._ensure = function (needed) {
    if (this.cur.y - needed < PAGE.mb) this._newPage();
  };
  Doc.prototype._raw = function (s) { this.cur.ops.push(s); };

  Doc.prototype.space = function (pt) { this.cur.y -= pt; return this; };

  Doc.prototype.rule = function (color, width) {
    this._ensure(6);
    var c = color || [0.84, 0.886, 0.91];
    this._raw(c[0] + ' ' + c[1] + ' ' + c[2] + ' RG ' + (width || 0.8) + ' w ' +
      PAGE.ml + ' ' + this.cur.y.toFixed(2) + ' m ' + (PAGE.w - PAGE.mr) + ' ' + this.cur.y.toFixed(2) + ' l S');
    this.cur.y -= 8;
    return this;
  };

  Doc.prototype.rect = function (x, y, w, h, fill, stroke) {
    var ops = '';
    if (fill) ops += fill[0] + ' ' + fill[1] + ' ' + fill[2] + ' rg ';
    else ops += '1 1 1 rg ';
    if (stroke) ops += stroke[0] + ' ' + stroke[1] + ' ' + stroke[2] + ' RG 0.8 w ';
    ops += x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re ';
    ops += (fill && stroke) ? 'B' : (fill ? 'f' : 'S');
    this._raw(ops);
    return this;
  };

  /* text at an absolute position (used for headers/boxes) */
  Doc.prototype.textAt = function (x, y, str, size, bold, color, maxWidth) {
    var s = sanitise(String(str === undefined || str === null ? '' : str));
    if (maxWidth) s = this.fit(s, size, bold, maxWidth);
    var c = color || [0.05, 0.13, 0.16];
    this._raw('BT ' + c[0] + ' ' + c[1] + ' ' + c[2] + ' rg /' + (bold ? 'F2' : 'F1') + ' ' + size +
      ' Tf ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + escapePdf(s) + ') Tj ET');
    return this;
  };

  Doc.prototype.fit = function (str, size, bold, maxWidth) {
    if (textWidth(str, size, bold) <= maxWidth) return str;
    var out = str;
    while (out.length > 1 && textWidth(out + '\u2026', size, bold) > maxWidth) out = out.slice(0, -1);
    return out + '\u2026';
  };

  Doc.prototype.wrap = function (str, size, bold, maxWidth) {
    var words = String(str).split(/\s+/).filter(Boolean), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (textWidth(test, size, bold) <= maxWidth || !line) {
        /* a single very long token: hard-break it */
        while (textWidth(test, size, bold) > maxWidth && test.length > 1) {
          var cut = test.length;
          while (cut > 1 && textWidth(test.slice(0, cut), size, bold) > maxWidth) cut--;
          lines.push(test.slice(0, cut));
          test = test.slice(cut);
        }
        line = test;
      } else { lines.push(line); line = words[i]; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  /* flowing block text */
  Doc.prototype.paragraph = function (str, opts) {
    opts = opts || {};
    var size = opts.size || 10.5, bold = !!opts.bold, lead = opts.leading || size * 1.45;
    var maxW = (opts.width || (PAGE.w - PAGE.ml - PAGE.mr)) - (opts.indent || 0);
    var x = PAGE.ml + (opts.indent || 0);
    var lines = this.wrap(str, size, bold, maxW);
    for (var i = 0; i < lines.length; i++) {
      this._ensure(lead);
      this.textAt(x, this.cur.y - size, lines[i], size, bold, opts.color);
      this.cur.y -= lead;
    }
    this.cur.y -= (opts.after === undefined ? 6 : opts.after);
    return this;
  };

  Doc.prototype.heading = function (str, opts) {
    opts = opts || {};
    var size = opts.size || 14;
    this._ensure(size * 2.2);
    this.cur.y -= (opts.before === undefined ? 6 : opts.before);
    this.paragraph(str, { size: size, bold: true, leading: size * 1.3, after: opts.after === undefined ? 5 : opts.after, color: opts.color || [0.02, 0.14, 0.19] });
    return this;
  };

  Doc.prototype.bullet = function (str, opts) {
    opts = opts || {};
    var size = opts.size || 10.5, lead = size * 1.45;
    var indent = opts.indent === undefined ? 14 : opts.indent;
    var maxW = PAGE.w - PAGE.ml - PAGE.mr - indent - 4;
    var lines = this.wrap(str, size, false, maxW);
    for (var i = 0; i < lines.length; i++) {
      this._ensure(lead);
      if (i === 0) this.textAt(PAGE.ml + 2, this.cur.y - size, '\u2022', size, false, [0.07, 0.47, 0.55]);
      this.textAt(PAGE.ml + indent, this.cur.y - size, lines[i], size, false, opts.color);
      this.cur.y -= lead;
    }
    this.cur.y -= (opts.after === undefined ? 3 : opts.after);
    return this;
  };

  Doc.prototype.kv = function (key, val, opts) {
    opts = opts || {};
    var size = opts.size || 10, lead = size * 1.4;
    var total = PAGE.w - PAGE.ml - PAGE.mr;
    var kw = opts.keyWidth || total * 0.42;
    var kLines = this.wrap(key, size, true, kw - 6);
    var vLines = this.wrap(String(val === undefined || val === null ? '' : val), size, false, total - kw - 6);
    var n = Math.max(kLines.length, vLines.length);
    this._ensure(lead * n + 2);
    for (var i = 0; i < n; i++) {
      if (i < kLines.length) this.textAt(PAGE.ml, this.cur.y - size, kLines[i], size, true, [0.35, 0.44, 0.5]);
      if (i < vLines.length) this.textAt(PAGE.ml + kw, this.cur.y - size, vLines[i], size, false, [0.05, 0.13, 0.16]);
      this.cur.y -= lead;
    }
    return this;
  };

  /* simple header/footer drawn on every page at save time */
  Doc.prototype.setHeader = function (left, right) { this._header = { left: left, right: right }; return this; };
  Doc.prototype.setFooter = function (text) { this._footer = text; return this; };

  Doc.prototype._decorate = function () {
    var self = this;
    this.pages.forEach(function (p, idx) {
      var ops = [];
      if (self._header) {
        ops.push('BT 0.02 0.14 0.19 rg /F2 13 Tf ' + PAGE.ml + ' ' + (PAGE.h - 34) + ' Td (' + escapePdf(self._header.left) + ') Tj ET');
        if (self._header.right) {
          var w = textWidth(self._header.right, 9, false);
          ops.push('BT 0.35 0.44 0.5 rg /F1 9 Tf ' + (PAGE.w - PAGE.mr - w).toFixed(2) + ' ' + (PAGE.h - 33) + ' Td (' + escapePdf(self._header.right) + ') Tj ET');
        }
        ops.push('0.84 0.886 0.91 RG 0.8 w ' + PAGE.ml + ' ' + (PAGE.h - 42) + ' m ' + (PAGE.w - PAGE.mr) + ' ' + (PAGE.h - 42) + ' l S');
      }
      var foot = self._footer || 'GoTax.SI — AI-assisted explanations. Not legal or tax advice.';
      ops.push('0.84 0.886 0.91 RG 0.8 w ' + PAGE.ml + ' ' + (PAGE.mb - 14) + ' m ' + (PAGE.w - PAGE.mr) + ' ' + (PAGE.mb - 14) + ' l S');
      ops.push('BT 0.35 0.44 0.5 rg /F1 8 Tf ' + PAGE.ml + ' ' + (PAGE.mb - 26) + ' Td (' + escapePdf(sanitise(foot)) + ') Tj ET');
      var pg = 'Page ' + (idx + 1) + ' of ' + self.pages.length;
      var pw = textWidth(pg, 8, false);
      ops.push('BT 0.35 0.44 0.5 rg /F1 8 Tf ' + (PAGE.w - PAGE.mr - pw).toFixed(2) + ' ' + (PAGE.mb - 26) + ' Td (' + escapePdf(pg) + ') Tj ET');
      p.ops = ops.concat(p.ops);
    });
  };

  /* ---- serialise ---- */
  Doc.prototype.build = function () {
    this._decorate();
    var objs = [];           /* 1-based object bodies */
    var push = function (body) { objs.push(body); return objs.length; };

    var fontRegular = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var fontBold = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var fontMono = push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

    var pageIds = [], contentIds = [];
    var self = this;
    this.pages.forEach(function (p) {
      var stream = p.ops.join('\n');
      var cid = push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
      contentIds.push(cid);
    });
    this.pages.forEach(function (p, i) {
      pageIds.push(push('<< /Type /Page /Parent PAGES_PLACEHOLDER /MediaBox [0 0 ' +
        PAGE.w.toFixed(2) + ' ' + PAGE.h.toFixed(2) + '] /Resources << /Font << /F1 ' + fontRegular +
        ' 0 R /F2 ' + fontBold + ' 0 R /F3 ' + fontMono + ' 0 R >> >> /Contents ' + contentIds[i] + ' 0 R >>'));
    });
    var pagesId = push('<< /Type /Pages /Kids [' + pageIds.map(function (i) { return i + ' 0 R'; }).join(' ') +
      '] /Count ' + pageIds.length + ' >>');
    var catalogId = push('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
    var infoId = push('<< /Title (' + escapePdf(asciiFold(this.title)) + ') /Author (' + escapePdf(asciiFold(this.author)) +
      ') /Subject (' + escapePdf(asciiFold(this.subject)) + ') /Producer (GoTax.SI PDF writer) /CreationDate (D:' +
      pdfDate() + ') >>');

    /* patch parent references */
    objs = objs.map(function (body) { return body.replace('PAGES_PLACEHOLDER', pagesId + ' 0 R'); });

    /* assemble with a correct xref table */
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    var offsets = [];
    for (var i = 0; i < objs.length; i++) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n';
    }
    var xrefPos = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += String(o).padStart(10, '0') + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogId + ' 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' +
      xrefPos + '\n%%EOF\n';

    var bytes = new Uint8Array(out.length);
    for (var k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xFF;
    return bytes;
  };

  /* Metadata strings use PDFDocEncoding, where 0x80-0x9F differ from WinAnsi.
     Fold those to ASCII so viewers show clean titles. */
  function asciiFold(str) {
    var map = { '\u2013':'-','\u2014':'-','\u2018':"'",'\u2019':"'",'\u201C':'"','\u201D':'"',
      '\u2022':'-','\u2026':'...','\u20AC':'EUR','\u2122':'(TM)','\u00A0':' ' };
    return sanitise(String(str || '')).replace(/[\u0080-\u009F\u2000-\u206F]/g, function (c) {
      return map[c] !== undefined ? map[c] : '-';
    });
  }

  function pdfDate() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) +
      p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  }

  Doc.prototype.blob = function () {
    var b = this.build();
    return new Blob([b], { type: 'application/pdf' });
  };
  Doc.prototype.saveAs = function (filename) {
    var url = URL.createObjectURL(this.blob());
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'gotax.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  window.PDF = {
    Doc: Doc, PAGE: PAGE, textWidth: textWidth, isLatinSafe: isLatinSafe, sanitise: sanitise
  };
})();
