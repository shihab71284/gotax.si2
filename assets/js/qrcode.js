/* ============================================================
   GoTax.SI — minimal QR code encoder (byte mode, EC level M)
   ------------------------------------------------------------
   Self-contained: no external library, no network request.
   Supports versions 1–10 (up to 213 bytes), which covers
   bitcoin: URIs and BOLT11 invoices used at checkout.
   API:  QR.matrix(text) -> {size, modules:boolean[][]}
         QR.toCanvas(canvas, text, opts)
   ============================================================ */
(function () {
  'use strict';

  /* ---- GF(256) arithmetic, primitive polynomial 0x11D ---- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
  function rsGenerator(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly; /* length n+1, leading 1 */
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
      }
    }
    return res;
  }

  /* ---- version table for EC level M: [ [blocks, dataCodewords], ... ] ---- */
  /* each entry: {total, data, groups:[[count,dataPerBlock],...], ecPerBlock} */
  var VERSIONS_M = {
    1:  { total: 26,  data: 10,  groups: [[1, 10]], ec: 16 },
    2:  { total: 44,  data: 16,  groups: [[1, 16]], ec: 28 },
    3:  { total: 70,  data: 26,  groups: [[1, 26]], ec: 44 },
    4:  { total: 100, data: 64,  groups: [[2, 32]], ec: 18 },
    5:  { total: 134, data: 86,  groups: [[2, 43]], ec: 24 },
    6:  { total: 172, data: 108, groups: [[4, 27]], ec: 16 },
    7:  { total: 196, data: 124, groups: [[4, 31]], ec: 18 },
    8:  { total: 242, data: 154, groups: [[2, 38], [2, 39]], ec: 22 },
    9:  { total: 292, data: 182, groups: [[3, 36], [2, 37]], ec: 22 },
    10: { total: 346, data: 216, groups: [[4, 43], [1, 44]], ec: 26 }
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xD800 && c < 0xDC00 && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      var ccBits = v <= 9 ? 8 : 16;
      var needed = 4 + ccBits + byteLen * 8;
      if (needed <= VERSIONS_M[v].data * 8) return v;
    }
    return -1;
  }

  function buildCodewords(bytes, version) {
    var spec = VERSIONS_M[version];
    var ccBits = version <= 9 ? 8 : 16;
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(4, 4);                 /* byte mode */
    push(bytes.length, ccBits); /* character count */
    bytes.forEach(function (b) { push(b, 8); });
    var capacity = spec.data * 8;
    push(0, Math.min(4, capacity - bits.length));  /* terminator */
    while (bits.length % 8 !== 0) bits.push(0);
    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }
    var pad = [0xEC, 0x11], k = 0;
    while (codewords.length < spec.data) codewords.push(pad[(k++) % 2]);
    return codewords;
  }

  function interleave(codewords, version) {
    var spec = VERSIONS_M[version];
    var blocks = [], ecs = [], idx = 0;
    spec.groups.forEach(function (g) {
      for (var i = 0; i < g[0]; i++) {
        var blk = codewords.slice(idx, idx + g[1]);
        idx += g[1];
        blocks.push(blk);
        ecs.push(rsEncode(blk, spec.ec));
      }
    });
    var out = [], maxData = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (var c = 0; c < maxData; c++) blocks.forEach(function (b) { if (c < b.length) out.push(b[c]); });
    for (var e = 0; e < spec.ec; e++) ecs.forEach(function (b) { if (e < b.length) out.push(b[e]); });
    return out;
  }

  /* ---- BCH helpers for format / version information ---- */
  function bchFormat(data5) {
    var d = data5 << 10;
    while (bitLength(d) - 11 >= 0) d ^= 0x537 << (bitLength(d) - 11);
    return ((data5 << 10) | d) ^ 0x5412;
  }
  function bchVersion(v) {
    var d = v << 12;
    while (bitLength(d) - 13 >= 0) d ^= 0x1F25 << (bitLength(d) - 13);
    return (v << 12) | d;
  }
  function bitLength(n) { var l = 0; while (n) { n >>= 1; l++; } return l; }

  /* ---- matrix construction ---- */
  function createMatrix(version) {
    var size = version * 4 + 17;
    var m = [], r = [];
    for (var i = 0; i < size; i++) {
      m.push(new Array(size).fill(null));
      r.push(new Array(size).fill(false)); /* reserved / function pattern */
    }
    return { size: size, m: m, reserved: r };
  }
  function setFn(M, x, y, v) {
    if (x < 0 || y < 0 || x >= M.size || y >= M.size) return;
    M.m[y][x] = v ? 1 : 0; M.reserved[y][x] = true;
  }
  function drawPatterns(M, version) {
    var size = M.size, i, j;
    /* finder patterns + separators */
    [[0, 0], [size - 7, 0], [0, size - 7]].forEach(function (p) {
      var ox = p[0], oy = p[1];
      for (var y = -1; y <= 7; y++) for (var x = -1; x <= 7; x++) {
        var inRing = (x >= 0 && x <= 6 && y >= 0 && y <= 6) &&
          (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setFn(M, ox + x, oy + y, inRing);
      }
    });
    /* timing patterns */
    for (i = 8; i < size - 8; i++) {
      setFn(M, i, 6, i % 2 === 0);
      setFn(M, 6, i, i % 2 === 0);
    }
    /* alignment patterns */
    var pos = ALIGN[version] || [];
    for (i = 0; i < pos.length; i++) for (j = 0; j < pos.length; j++) {
      var ax = pos[j], ay = pos[i];
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === pos[pos.length - 1]) || (ax === pos[pos.length - 1] && ay === 6)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        setFn(M, ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    /* dark module + reserved format areas */
    setFn(M, 8, size - 8, true);
    for (i = 0; i < 9; i++) { if (!M.reserved[8][i]) setFn(M, i, 8, false); if (!M.reserved[i][8]) setFn(M, 8, i, false); }
    for (i = 0; i < 8; i++) { setFn(M, size - 1 - i, 8, false); setFn(M, 8, size - 1 - i, false); }
    /* version information (v >= 7) */
    if (version >= 7) {
      var vi = bchVersion(version);
      for (i = 0; i < 18; i++) {
        var bit = (vi >> i) & 1;
        setFn(M, Math.floor(i / 3), size - 11 + (i % 3), bit);
        setFn(M, size - 11 + (i % 3), Math.floor(i / 3), bit);
      }
    }
  }

  function placeData(M, codewords) {
    var size = M.size;
    var bitIdx = 0, totalBits = codewords.length * 8;
    var upward = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5; /* skip timing column */
      for (var i = 0; i < size; i++) {
        var y = upward ? (size - 1 - i) : i;
        for (var c = 0; c < 2; c++) {
          var x = col - c;
          if (M.reserved[y][x]) continue;
          var bit = 0;
          if (bitIdx < totalBits) bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
          M.m[y][x] = bit;
        }
      }
      upward = !upward;
    }
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
  ];

  function applyMask(M, maskIdx) {
    var f = MASKS[maskIdx];
    for (var y = 0; y < M.size; y++) for (var x = 0; x < M.size; x++) {
      if (M.reserved[y][x]) continue;
      if (f(x, y)) M.m[y][x] ^= 1;
    }
  }
  /* Format information is written as M.m[y][x]. Positions follow the spec:
     copy 1 runs down column x=8 then along row y=8; copy 2 runs along row
     y=8 (right side) then down column x=8 (bottom side). */
  function drawFormat(M, maskIdx) {
    var ecBits = 0; /* EC level M = 00 */
    var fmt = bchFormat((ecBits << 3) | maskIdx);
    var size = M.size, i;
    function bit(k) { return (fmt >> k) & 1; }
    /* copy 1 — around the top-left finder pattern */
    for (i = 0; i <= 5; i++) M.m[i][8] = bit(i);
    M.m[7][8] = bit(6);
    M.m[8][8] = bit(7);
    M.m[8][7] = bit(8);
    for (i = 9; i < 15; i++) M.m[8][14 - i] = bit(i);
    /* copy 2 — beside the other two finder patterns */
    for (i = 0; i < 8; i++) M.m[8][size - 1 - i] = bit(i);
    for (i = 8; i < 15; i++) M.m[size - 15 + i][8] = bit(i);
    M.m[size - 8][8] = 1; /* always-dark module */
  }

  function penalty(M) {
    var size = M.size, m = M.m, score = 0, x, y, i;
    /* rule 1: runs of 5+ same-colour modules */
    for (y = 0; y < size; y++) {
      var run = 1;
      for (x = 1; x < size; x++) {
        if (m[y][x] === m[y][x - 1]) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
    for (x = 0; x < size; x++) {
      var run2 = 1;
      for (y = 1; y < size; y++) {
        if (m[y][x] === m[y - 1][x]) run2++;
        else { if (run2 >= 5) score += run2 - 2; run2 = 1; }
      }
      if (run2 >= 5) score += run2 - 2;
    }
    /* rule 2: 2x2 blocks */
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
    /* rule 3: finder-like patterns */
    var p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(arr, pat) { for (var k = 0; k < pat.length; k++) if (arr[k] !== pat[k]) return false; return true; }
    for (y = 0; y < size; y++) for (x = 0; x <= size - 11; x++) {
      var row = m[y].slice(x, x + 11);
      if (match(row, p1) || match(row, p2)) score += 40;
    }
    for (x = 0; x < size; x++) for (y = 0; y <= size - 11; y++) {
      var colArr = []; for (i = 0; i < 11; i++) colArr.push(m[y + i][x]);
      if (match(colArr, p1) || match(colArr, p2)) score += 40;
    }
    /* rule 4: balance */
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (m[y][x]) dark++;
    var pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function matrix(text) {
    var bytes = utf8Bytes(String(text || ''));
    var version = pickVersion(bytes.length);
    if (version < 0) throw new Error('QR: text too long for versions 1-10 (max 213 bytes at EC M)');
    var codewords = interleave(buildCodewords(bytes, version), version);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var M = createMatrix(version);
      drawPatterns(M, version);
      placeData(M, codewords);
      applyMask(M, mask);
      drawFormat(M, mask);
      var s = penalty(M);
      if (s < bestScore) { bestScore = s; best = M; }
    }
    return { size: best.size, version: version, modules: best.m };
  }

  function toCanvas(canvas, text, opts) {
    opts = opts || {};
    var q = matrix(text);
    var scale = opts.scale || 6;
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var px = (q.size + quiet * 2) * scale;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = px * dpr; canvas.height = px * dpr;
    canvas.style.width = px + 'px'; canvas.style.height = px + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = opts.background || '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.foreground || '#05242f';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
      if (q.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
    return q;
  }

  /* data-URI version (used in generated PDFs / emails) */
  function toDataUrl(text, opts) {
    var q = matrix(text);
    opts = opts || {};
    var scale = opts.scale || 4, quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var px = (q.size + quiet * 2) * scale;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + px + ' ' + px + '">' +
      '<rect width="' + px + '" height="' + px + '" fill="#fff"/>';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
      if (q.modules[y][x]) svg += '<rect x="' + ((x + quiet) * scale) + '" y="' + ((y + quiet) * scale) + '" width="' + scale + '" height="' + scale + '"/>';
    }
    svg += '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  window.QR = { matrix: matrix, toCanvas: toCanvas, toDataUrl: toDataUrl, pickVersion: pickVersion };
})();
