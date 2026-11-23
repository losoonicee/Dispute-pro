
/* Dispute Desk 2: the on-phone picture reader.
   It finds the lines of text in a screenshot or a flat photo, then reads each line with the small English
   text-recognition network from Tesseract (tessdata_fast, Apache License 2.0). Everything runs here, in this page:
   the picture is never sent anywhere and nothing needs a signal. It reads screenshots very well. It is weaker on
   photos of paper with shadows, tilt or glare. It only guesses at the words; the person checks what it filled in.
   The network is stored as small whole numbers plus a scale for each row (model.bin); the sums run in ordinary
   floating point here. */
(function (root) {
  'use strict';

  var NET_H = 36;                    // the network reads lines that are 36 pixels tall
  var MODEL = null;
  var OPT = { conv: 1, gates: [0, 1, 2, 3], order: 0, ydir: 0, pad: 'noise' };

  /* ---------- the model ---------- */
  function b64bytes(s) {
    var bin = atob(s), n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function loadModel(meta, bytes) {
    var by = {};
    meta.mats.forEach(function (m) {
      var q = new Int8Array(bytes.buffer, bytes.byteOffset + m.off, m.rows * m.cols);
      var dv = new DataView(bytes.buffer, bytes.byteOffset + m.off + m.rows * m.cols, m.rows * 4);
      var sc = new Float32Array(m.rows);
      for (var r = 0; r < m.rows; r++) sc[r] = dv.getFloat32(r * 4, true);
      by[m.name] = { rows: m.rows, cols: m.cols, q: q, sc: sc };
    });
    function lstm(prefix, ni, ns) {
      var win = new Float32Array(4 * ns * ni), wrec = new Float32Array(4 * ns * ns), b = new Float32Array(4 * ns);
      for (var g = 0; g < 4; g++) {
        var m = by[prefix + '.g' + g];
        if (m.rows !== ns || m.cols !== ni + ns + 1) throw new Error('bad network shape ' + prefix);
        for (var j = 0; j < ns; j++) {
          var row = g * ns + j, base = j * m.cols, s = m.sc[j];
          if (OPT.order === 0) {
            for (var k = 0; k < ni; k++) win[row * ni + k] = m.q[base + k] * s;
            for (k = 0; k < ns; k++) wrec[row * ns + k] = m.q[base + ni + k] * s;
          } else {
            for (var k = 0; k < ns; k++) wrec[row * ns + k] = m.q[base + k] * s;
            for (k = 0; k < ni; k++) win[row * ni + k] = m.q[base + ns + k] * s;
          }
          b[row] = m.q[base + ni + ns] * s;
        }
      }
      return { ni: ni, ns: ns, win: win, wrec: wrec, b: b };
    }
    var cv = by.conv, cw = new Float32Array(16 * 9), cb = new Float32Array(16);
    for (var c = 0; c < 16; c++) {
      for (var k = 0; k < 9; k++) cw[c * 9 + k] = cv.q[c * 10 + k] * cv.sc[c];
      cb[c] = cv.q[c * 10 + 9] * cv.sc[c];
    }
    var o = by.out, nout = o.rows, ow = new Float32Array(nout * 192), ob = new Float32Array(nout);
    for (var r2 = 0; r2 < nout; r2++) {
      for (var k2 = 0; k2 < 192; k2++) ow[r2 * 192 + k2] = o.q[r2 * o.cols + k2] * o.sc[r2];
      ob[r2] = o.q[r2 * o.cols + 192] * o.sc[r2];
    }
    MODEL = {
      charset: meta.charset, nul: meta.null, nout: nout,
      convW: cw, convB: cb,
      y: lstm('y48', 16, 48), x1: lstm('x96', 48, 96), r: lstm('r96', 96, 96), x2: lstm('x192', 96, 192),
      outW: ow, outB: ob
    };
    return MODEL;
  }

  /* ---------- the network ---------- */
  function sig(x) { return 1 / (1 + Math.exp(-x)); }

  // Runs one LSTM layer over T steps. X is T rows of ni numbers. Fills out (T rows of ns) when given, and returns the last output.
  function lstmRun(L, X, T, reverse, out) {
    var ni = L.ni, ns = L.ns, G = 4 * ns, win = L.win, wrec = L.wrec;
    var P = new Float32Array(T * G);
    var t, r, k, s, wo, xo;
    for (t = 0; t < T; t++) {
      xo = t * ni;
      for (r = 0; r < G; r++) {
        s = L.b[r]; wo = r * ni;
        for (k = 0; k < ni; k++) s += win[wo + k] * X[xo + k];
        P[t * G + r] = s;
      }
    }
    var h = new Float32Array(ns), c = new Float32Array(ns), pre = new Float32Array(G);
    for (var step = 0; step < T; step++) {
      t = reverse ? T - 1 - step : step;
      var po = t * G;
      for (r = 0; r < G; r++) {
        s = P[po + r]; wo = r * ns;
        for (k = 0; k < ns; k++) s += wrec[wo + k] * h[k];
        pre[r] = s;
      }
      for (var j = 0; j < ns; j++) {
        var G0 = OPT.gates;
        var cv = sig(pre[G0[1] * ns + j]) * Math.tanh(pre[G0[0] * ns + j]) + sig(pre[G0[2] * ns + j]) * c[j];
        if (cv > 100) cv = 100; else if (cv < -100) cv = -100;
        c[j] = cv;
        h[j] = Math.tanh(cv) * sig(pre[G0[3] * ns + j]);
      }
      if (out) out.set(h, t * ns);
    }
    return h;
  }

  // img: Float32Array(36 * W), row by row, ink near -1 and paper near +1. Returns per step the best class, its probability and all probabilities.
  function forward(img, W) {
    var M = MODEL, nout = M.nout;
    // 3x3 neighbourhood with a border of zeros
    var PW = W + 2, pad = new Float32Array((NET_H + 2) * PW);
    var y, x, c, k;
    for (y = 0; y < NET_H; y++) {
      var so = y * W, dstart = (y + 1) * PW + 1;
      for (x = 0; x < W; x++) pad[dstart + x] = img[so + x];
    }
    if (OPT.pad === 'noise') {
      // outside the picture the network was trained to see random noise, so give it the same, always the same noise
      var seed = 12345;
      var rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
      for (x = 0; x < PW; x++) { pad[x] = rnd(); pad[(NET_H + 1) * PW + x] = rnd(); }
      for (y = 1; y <= NET_H; y++) { pad[y * PW] = rnd(); pad[y * PW + W + 1] = rnd(); }
    }
    var W3 = Math.ceil(W / 3), H3 = NET_H / 3;
    var feat = new Float32Array(H3 * W3 * 16);
    var best = new Float32Array(16), n = new Float32Array(9), cw = M.convW, cb = M.convB;
    for (var y3 = 0; y3 < H3; y3++) {
      for (var x3 = 0; x3 < W3; x3++) {
        for (c = 0; c < 16; c++) best[c] = -1e9;
        for (var dy = 0; dy < 3; dy++) {
          for (var dx = 0; dx < 3; dx++) {
            x = x3 * 3 + dx; if (x >= W) continue;
            y = y3 * 3 + dy;
            var p = y * PW + x;                          // top-left of the 3x3 window in the padded image
            if (OPT.conv === 0) {
              n[0] = pad[p]; n[1] = pad[p + 1]; n[2] = pad[p + 2];
              n[3] = pad[p + PW]; n[4] = pad[p + PW + 1]; n[5] = pad[p + PW + 2];
              n[6] = pad[p + 2 * PW]; n[7] = pad[p + 2 * PW + 1]; n[8] = pad[p + 2 * PW + 2];
            } else {
              n[0] = pad[p]; n[1] = pad[p + PW]; n[2] = pad[p + 2 * PW];
              n[3] = pad[p + 1]; n[4] = pad[p + PW + 1]; n[5] = pad[p + 2 * PW + 1];
              n[6] = pad[p + 2]; n[7] = pad[p + PW + 2]; n[8] = pad[p + 2 * PW + 2];
            }
            for (c = 0; c < 16; c++) {
              var s = cb[c], wo = c * 9;
              for (k = 0; k < 9; k++) s += cw[wo + k] * n[k];
              if (s > best[c]) best[c] = s;
            }
          }
        }
        var fo = (y3 * W3 + x3) * 16;
        for (c = 0; c < 16; c++) feat[fo + c] = Math.tanh(best[c]);
      }
    }
    // up-down LSTM over each column, keeping the last output
    var F2 = new Float32Array(W3 * 48), col = new Float32Array(H3 * 16);
    for (x = 0; x < W3; x++) {
      for (y = 0; y < H3; y++) for (c = 0; c < 16; c++) col[y * 16 + c] = feat[(y * W3 + x) * 16 + c];
      F2.set(lstmRun(M.y, col, H3, OPT.ydir === 1, null), x * 48);
    }
    var H1 = new Float32Array(W3 * 96), H2 = new Float32Array(W3 * 96), H3o = new Float32Array(W3 * 192);
    lstmRun(M.x1, F2, W3, false, H1);
    lstmRun(M.r, H1, W3, true, H2);
    lstmRun(M.x2, H2, W3, false, H3o);
    var probs = new Float32Array(W3 * nout), cls = new Uint8Array(W3), conf = new Float32Array(W3), lg = new Float32Array(nout);
    for (var t = 0; t < W3; t++) {
      var mx = -1e30, bi = 0, ho = t * 192;
      for (var o = 0; o < nout; o++) {
        var v = M.outB[o], wb = o * 192;
        for (k = 0; k < 192; k++) v += M.outW[wb + k] * H3o[ho + k];
        lg[o] = v; if (v > mx) { mx = v; bi = o; }
      }
      var sum = 0;
      for (o = 0; o < nout; o++) { var e = Math.exp(lg[o] - mx); lg[o] = e; sum += e; }
      for (o = 0; o < nout; o++) probs[t * nout + o] = lg[o] / sum;
      cls[t] = bi; conf[t] = 1 / sum;
    }
    return { T: W3, cls: cls, conf: conf, probs: probs };
  }

  // Best path through the steps: drop the "nothing" class, merge repeats. Returns the text and how sure the network was (0 to 1).
  function decode(res) {
    var M = MODEL, prev = -1, chars = [];
    for (var t = 0; t < res.T; t++) {
      var k = res.cls[t];
      if (k !== M.nul && k !== prev) chars.push({ ch: M.charset[k], conf: res.conf[t], t: t });
      else if (k !== M.nul && chars.length && res.conf[t] > chars[chars.length - 1].conf) chars[chars.length - 1].conf = res.conf[t];
      prev = k;
    }
    return finish(chars, res.T);
  }

  // The network often "sees" something in the empty paper at the very start or end of a line and writes a stray dot, dash or
  // bracket with low confidence. Real punctuation at the ends is read with high confidence, so only the unsure ones go.
  function trimEdges(chars) {
    function junk(c) { return c.conf < 0.85 && !/[A-Za-z0-9]/.test(c.ch); }
    while (chars.length && junk(chars[0])) chars.shift();
    while (chars.length && junk(chars[chars.length - 1])) chars.pop();
    return chars;
  }

  function finish(chars, T) {
    trimEdges(chars);
    var sum = 0, minc = 1, i;
    for (i = 0; i < chars.length; i++) { sum += chars[i].conf; if (chars[i].conf < minc) minc = chars[i].conf; }
    var text = '';
    for (i = 0; i < chars.length; i++) text += chars[i].ch;
    return { text: text, conf: chars.length ? sum / chars.length : 0, min: chars.length ? minc : 0, chars: chars.length, list: chars, T: T };
  }

  /* ---------- pictures to lines ---------- */
  function lumaFromRGBA(d, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0, n = w * h; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return g;
  }

  // Shrink or stretch a grey crop to dw x dh. Shrinking averages the covered area, so thin strokes stay visible.
  function resample(src, sw, sh, dw, dh) {
    function weights(sn, dn) {
      var out = new Array(dn), sc = sn / dn;
      for (var i = 0; i < dn; i++) {
        var a, b, idx = [], wt = [];
        if (sc >= 1) {
          a = i * sc; b = (i + 1) * sc;
          for (var k = Math.floor(a); k < Math.min(sn, Math.ceil(b)); k++) {
            var ov = Math.min(b, k + 1) - Math.max(a, k);
            if (ov > 0) { idx.push(k); wt.push(ov / sc); }
          }
        } else {
          var c = (i + 0.5) * sc - 0.5, k0 = Math.floor(c), f = c - k0;
          var i0 = Math.max(0, Math.min(sn - 1, k0)), i1 = Math.max(0, Math.min(sn - 1, k0 + 1));
          idx.push(i0); wt.push(1 - f); idx.push(i1); wt.push(f);
        }
        out[i] = { idx: idx, wt: wt };
      }
      return out;
    }
    var wx = weights(sw, dw), wy = weights(sh, dh), tmp = new Float32Array(dw * sh), out = new Float32Array(dw * dh);
    var x, y, k;
    for (y = 0; y < sh; y++) {
      for (x = 0; x < dw; x++) {
        var e = wx[x], s = 0;
        for (k = 0; k < e.idx.length; k++) s += src[y * sw + e.idx[k]] * e.wt[k];
        tmp[y * dw + x] = s;
      }
    }
    for (y = 0; y < dh; y++) {
      var ey = wy[y];
      for (x = 0; x < dw; x++) {
        var s2 = 0;
        for (k = 0; k < ey.idx.length; k++) s2 += tmp[ey.idx[k] * dw + x] * ey.wt[k];
        out[y * dw + x] = s2;
      }
    }
    return out;
  }

  // Makes ink dark and paper light, whatever the picture looks like, and stretches the contrast to -1 .. +1.
  // Returns null when the crop has too little contrast to be writing.
  function normalise(v) {
    var n = v.length, hist = new Uint32Array(64), i, b;
    for (i = 0; i < n; i++) { b = (v[i] * 63 / 255) | 0; if (b < 0) b = 0; else if (b > 63) b = 63; hist[b]++; }
    var mode = 0; for (b = 1; b < 64; b++) if (hist[b] > hist[mode]) mode = b;
    var bg = (mode + 0.5) * 255 / 63;
    var acc = 0, p1 = 0, p99 = 255, lo = n * 0.01, hi = n * 0.99;
    for (b = 0; b < 64; b++) { acc += hist[b]; if (acc >= lo) { p1 = b * 255 / 63; break; } }
    acc = 0;
    for (b = 0; b < 64; b++) { acc += hist[b]; if (acc >= hi) { p99 = (b + 1) * 255 / 63; break; } }
    var invert = (p99 - bg) > (bg - p1) * 1.15;
    var black, white;
    if (invert) { black = 255 - p99; white = 255 - bg; } else { black = p1; white = bg; }
    if (white - black < 30) return null;
    var out = new Float32Array(n), scale = 2 / (white - black);
    for (i = 0; i < n; i++) {
      var g = invert ? 255 - v[i] : v[i];
      var x = (g - black) * scale - 1;
      out[i] = x < -1 ? -1 : (x > 1 ? 1 : x);
    }
    return out;
  }

  // Reads one crop of a grey picture (ink bounding box plus a little paper).
  function recogniseCrop(gray, gw, x0, y0, x1, y1) {
    var cw = x1 - x0, ch = y1 - y0;
    if (cw < 4 || ch < 6) return null;
    var crop = new Uint8Array(cw * ch);
    for (var y = 0; y < ch; y++) crop.set(gray.subarray((y0 + y) * gw + x0, (y0 + y) * gw + x1), y * cw);
    var dw = Math.max(12, Math.round(cw * NET_H / ch));
    var sm = resample(crop, cw, ch, dw, NET_H);
    var nm = normalise(sm);
    if (!nm) return null;
    var res = forward(nm, dw), d = decode(res);
    d.steps = res.T; d.width = dw;
    return d;
  }

  /* ----- finding the lines ----- */
  var EDGE = 28;

  // 1 where a pixel sits on a strong left-right edge, 2 where it sits on a strong up-down edge only
  function edgeMap(g, w, h) {
    var m = new Uint8Array(w * h), x, y, i, d;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        d = g[i + 1] - g[i - 1];
        if (d > EDGE || d < -EDGE) { m[i] = 1; continue; }
        d = g[i + w] - g[i - w];
        if (d > EDGE || d < -EDGE) m[i] = 2;
      }
    }
    return m;
  }

  // Row by row: how many separate left-right edges are in the stretch x0..x1
  function rowRuns(m, w, x0, x1, y0, y1) {
    var out = new Int32Array(y1 - y0);
    for (var y = y0; y < y1; y++) {
      var runs = 0, inRun = false, base = y * w;
      for (var x = x0; x < x1; x++) {
        var on = m[base + x] === 1;
        if (on && !inRun) runs++;
        inRun = on;
      }
      out[y - y0] = runs;
    }
    return out;
  }

  // Splits a list of counts into stretches that are "on" (count >= min), joining stretches closer than join apart.
  function stretches(cnt, min, join) {
    var out = [], start = -1, i;
    for (i = 0; i < cnt.length; i++) {
      if (cnt[i] >= min) { if (start < 0) start = i; }
      else if (start >= 0) { out.push([start, i]); start = -1; }
    }
    if (start >= 0) out.push([start, cnt.length]);
    var merged = [];
    for (i = 0; i < out.length; i++) {
      var last = merged[merged.length - 1];
      if (last && out[i][0] - last[1] <= join) last[1] = out[i][1]; else merged.push([out[i][0], out[i][1]]);
    }
    return merged;
  }

  // Cuts a region into lines by alternately cutting along the empty rows and the wide empty gaps between columns.
  function cutRegion(m, w, r, depth, out, opts) {
    if (depth > 6) { out.push(r); return; }
    var x0 = r.x0, x1 = r.x1, y0 = r.y0, y1 = r.y1;
    var runs = rowRuns(m, w, x0, x1, y0, y1);
    var bands = stretches(runs, opts.minRuns, 1);
    // a small band right next to a bigger one is a dot or an accent: join it
    var changed = true;
    while (changed && bands.length > 1) {
      changed = false;
      for (var i = 0; i < bands.length - 1; i++) {
        var a = bands[i], b = bands[i + 1], ha = a[1] - a[0], hb = b[1] - b[0], gap = b[0] - a[1];
        var small = Math.min(ha, hb), big = Math.max(ha, hb);
        if (gap <= Math.max(2, 0.4 * big) && small < 0.45 * big) { bands.splice(i, 2, [a[0], b[1]]); changed = true; break; }
      }
    }
    if (!bands.length) return;
    if (bands.length > 1) {
      for (var j = 0; j < bands.length; j++) cutRegion(m, w, { x0: x0, x1: x1, y0: y0 + bands[j][0], y1: y0 + bands[j][1] }, depth + 1, out, opts);
      return;
    }
    // one band: cut at wide empty gaps between columns
    var by0 = y0 + bands[0][0], by1 = y0 + bands[0][1], bh = by1 - by0;
    var cols = new Int32Array(x1 - x0), x, y;
    for (x = x0; x < x1; x++) {
      var c = 0;
      for (y = by0; y < by1; y++) if (m[y * w + x]) c++;
      cols[x - x0] = c;
    }
    var gapMin = Math.max(opts.minGap, Math.round(opts.gapFactor * bh));
    var segs = [], start = -1, lastInk = -1;
    for (x = 0; x < cols.length; x++) {
      if (cols[x] > 0) {
        if (start < 0) start = x;
        else if (x - lastInk - 1 >= gapMin) { segs.push([start, lastInk + 1]); start = x; }
        lastInk = x;
      }
    }
    if (start >= 0) segs.push([start, lastInk + 1]);
    if (!segs.length) return;
    if (segs.length === 1) {
      out.push({ x0: x0 + segs[0][0], x1: x0 + segs[0][1], y0: by0, y1: by1 });
      return;
    }
    for (var s = 0; s < segs.length; s++) {
      cutRegion(m, w, { x0: x0 + segs[s][0], x1: x0 + segs[s][1], y0: by0, y1: by1 }, depth + 1, out, opts);
    }
  }

  // Card borders, dividers and underlines are long thin lines. Take them out so they are not read as part of the writing.
  function eraseRules(m, w, h, minV, minH) {
    var x, y, y0, x0;
    for (x = 0; x < w; x++) {
      y = 0;
      while (y < h) {
        if (m[y * w + x]) {
          y0 = y; while (y < h && m[y * w + x]) y++;
          if (y - y0 >= minV) for (var yy = y0; yy < y; yy++) m[yy * w + x] = 0;
        } else y++;
      }
    }
    for (y = 0; y < h; y++) {
      x = 0;
      while (x < w) {
        if (m[y * w + x]) {
          x0 = x; while (x < w && m[y * w + x]) x++;
          if (x - x0 >= minH) for (var xx = x0; xx < x; xx++) m[y * w + xx] = 0;
        } else x++;
      }
    }
  }

  // A band is found from the rows with plenty of edges, which are the x-height rows. Give each line back its tall letters and tails.
  function expandRegions(m, w, h, regs) {
    function rowHasInk(y, x0, x1) { for (var x = x0; x < x1; x++) if (m[y * w + x]) return true; return false; }
    regs.forEach(function (r) {
      var hgt = r.y1 - r.y0, room = Math.max(3, Math.round(0.8 * hgt)), limUp = 0, limDn = h;
      regs.forEach(function (o) {
        if (o === r) return;
        var ov = Math.min(o.x1, r.x1) - Math.max(o.x0, r.x0);
        if (ov <= 0.3 * Math.min(o.x1 - o.x0, r.x1 - r.x0)) return;
        if (o.y1 <= r.y0) limUp = Math.max(limUp, Math.ceil((o.y1 + r.y0) / 2));
        else if (o.y0 >= r.y1) limDn = Math.min(limDn, Math.floor((o.y0 + r.y1) / 2));
      });
      r.ey0 = r.y0; r.ey1 = r.y1;
      var up = 0;
      while (up < room && r.ey0 - 1 >= limUp && rowHasInk(r.ey0 - 1, r.x0, r.x1)) { r.ey0--; up++; }
      var dn = 0;
      while (dn < room && r.ey1 < limDn && rowHasInk(r.ey1, r.x0, r.x1)) { r.ey1++; dn++; }
    });
    regs.forEach(function (r) { r.y0 = r.ey0; r.y1 = r.ey1; });
  }

  function findLines(gray, w, h, o) {
    o = o || {};
    var opts = { minRuns: o.minRuns || 5, minGap: o.minGap || 14, gapFactor: o.gapFactor || 1.25 };
    var m = edgeMap(gray, w, h), out = [];
    eraseRules(m, w, h, o.minV || 80, o.minH || 120);
    cutRegion(m, w, { x0: 0, x1: w, y0: 0, y1: h }, 0, out, opts);
    expandRegions(m, w, h, out);
    return { lines: out, edges: m };
  }

  // Tightens a line region to its own ink and adds a little paper around it.
  function boxFor(m, w, h, r) {
    var x0 = r.x1, x1 = r.x0, y0 = r.y1, y1 = r.y0, x, y;
    for (y = r.y0; y < r.y1; y++) for (x = r.x0; x < r.x1; x++) if (m[y * w + x]) {
      if (x < x0) x0 = x; if (x >= x1) x1 = x + 1; if (y < y0) y0 = y; if (y >= y1) y1 = y + 1;
    }
    if (x1 <= x0 || y1 <= y0) return null;
    var ih = y1 - y0, padY = Math.max(3, Math.round(0.2 * ih)), padX = Math.max(4, Math.round(0.4 * ih));
    return { x0: Math.max(0, x0 - padX), x1: Math.min(w, x1 + padX), y0: Math.max(0, y0 - padY), y1: Math.min(h, y1 + padY), ink: { x0: x0, x1: x1, y0: y0, y1: y1 } };
  }

  function sameRow(a, b) {
    var top = Math.max(a.y0, b.y0), bot = Math.min(a.y1, b.y1), ov = bot - top;
    return ov > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0);
  }

  var nextTick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  // Mistakes the network makes in numbers that the context settles. Money has two decimals, so $2.779 is $2,779.
  function fixText(t) {
    t = t.replace(/§(?=\d)/g, '$');                                        // a section sign in front of digits is a dollar sign
    t = t.replace(/(\$\s?\d{1,3})\.(\d{3})(?!\d)/g, '$1,$2');                   // $2.779 -> $2,779
    t = t.replace(/(\$\s?\d{1,3}(?:,\d{3})*),(\d{2})(?!\d)/g, '$1.$2');         // $12,50 -> $12.50
    t = t.replace(/(\d)[Oo](?=\d)/g, '$10').replace(/(\d)[Oo](?=\d)/g, '$10');  // 2O26 -> 2026
    t = t.replace(/(\d)[lI|](?=\d)/g, '$11').replace(/(\d)[lI|](?=\d)/g, '$11'); // 2l26 -> 2126
    t = t.replace(/\bNow\.?(?=\s+\d{1,2},?\s*\d{4})/g, 'Nov');                    // "Now. 05, 2026" is a date, so it is Nov.
    return t;
  }
  // short words that are real words in a credit report; any other short word at the very edge of a picture is usually an icon
  var SHORT_OK = {};
  ('co nd ok no yes open paid late none due auto card loan home na id aka pif ach acct fico name date type bank cash debt note good fair poor high low days day mos yrs new old pay and the for was are not any all you our can may has now see how who why per via tax key one two six ten ago off out buy fee tab app add use set get').split(' ').forEach(function (w) { SHORT_OK[w] = 1; });

  // Reads a whole grey picture. opts.onProgress(fraction), opts.shouldStop() -> true to give up, opts.minConf
  async function readGray(gray, w, h, opts) {
    opts = opts || {};
    if (!MODEL) throw new Error('model not loaded');
    opts.width = w;
    var found = findLines(gray, w, h, opts), regs = found.lines, m = found.edges;
    var items = [], lastYield = Date.now();
    for (var i = 0; i < regs.length; i++) {
      if (opts.shouldStop && opts.shouldStop()) { var e = new Error('stopped'); e.code = 'stopped'; throw e; }
      if (Date.now() - lastYield > 30) { if (opts.onProgress) opts.onProgress(i / Math.max(1, regs.length)); await nextTick(); lastYield = Date.now(); }
      var b = boxFor(m, w, h, regs[i]);
      if (!b) continue;
      var ih = b.ink.y1 - b.ink.y0, iw = b.ink.x1 - b.ink.x0;
      if (ih < 7 || iw < 5 || ih > 400) continue;
      var d = recogniseCrop(gray, w, b.x0, b.y0, b.x1, b.y1);
      if (!d) continue;
      items.push({ text: fixText(d.text), conf: d.conf, min: d.min, chars: d.chars, x0: b.ink.x0, x1: b.ink.x1, y0: b.ink.y0, y1: b.ink.y1 });
    }
    if (opts.onProgress) opts.onProgress(1);
    return assemble(items, opts);
  }

  // Bureau apps lay a label and its value out three ways: side by side, the label over the value, or the value over a small label
  // (the big number tiles). The form-filler wants "Label: value", so pair them by where they sit and write them that way.
  var LABEL_RE = /^[A-Za-z][A-Za-z '\u2019.\/&()+-]{1,38}$/;
  function isLabelish(t) { return LABEL_RE.test(t) && !/\.$/.test(t) && t.split(' ').length <= 5 && !/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i.test(t); }
  function isValueish(t) {
    if (t.length > 32 || !/[0-9$]/.test(t)) return false;
    var letters = (t.match(/[A-Za-z]/g) || []).length;
    return letters <= 0.55 * t.replace(/\s/g, '').length;
  }
  // words that are what a field says, never the name of a field
  var STATUS_WORD = {};
  ('closed open paid current late derogatory individual joint none unknown unpaid pending active inactive transferred sold settled satisfied disputed negative positive good fair poor excellent').split(' ').forEach(function (w) { STATUS_WORD[w] = 1; });
  function pairLabels(items) {
    var labs = [], vals = [];
    items.forEach(function (it, i) {
      it._i = i;
      it._rowN = items.filter(function (o) { return sameRow(o, it); }).length;
      if (isLabelish(it.text)) labs.push(it); else if (isValueish(it.text)) vals.push(it);
    });
    var edges = [];
    vals.forEach(function (v) {
      if (v._rowN >= 5) return;                                   // a grid of cells, not a field
      var vh = v.y1 - v.y0;
      // something readable to the left on the same row is this value's own label, even if it is not a plain label
      var rowLeft = items.some(function (o) { return o !== v && sameRow(o, v) && o.x1 <= v.x0 + 2 && (o.text.match(/[A-Za-z]/g) || []).length >= 3; });
      labs.forEach(function (l) {
        if (l._rowN >= 5) return;
        var lh = l.y1 - l.y0, H = Math.max(lh, vh);
        var ov = Math.min(l.x1, v.x1) - Math.max(l.x0, v.x0), narrow = Math.min(l.x1 - l.x0, v.x1 - v.x0);
        if (sameRow(l, v)) {
          if (l.x1 <= v.x0 + 2) {
            var between = items.some(function (o) { return o !== l && o !== v && sameRow(o, l) && o.x0 >= l.x1 - 2 && o.x1 <= v.x0 + 2; });
            if (!between) edges.push({ l: l, v: v, cost: 0.2 + (v.x0 - l.x1) / (40 * H), kind: 'row' });
          }
          return;
        }
        if (rowLeft) return;
        if (ov < 0.4 * narrow && Math.abs(l.x0 - v.x0) > Math.max(16, 0.6 * H)) return;
        var up = v.y0 - l.y1, down = l.y0 - v.y1;
        if (up >= -4 && up <= 1.9 * H && l.y0 < v.y0) edges.push({ l: l, v: v, cost: Math.max(0, up) / H, kind: 'above' });
        else if (down >= -4 && down <= 1.9 * H && l.y0 > v.y0 && !STATUS_WORD[l.text.toLowerCase()]) edges.push({ l: l, v: v, cost: 0.15 + Math.max(0, down) / H, kind: 'below' });
      });
    });
    edges.sort(function (a, b) { return a.cost - b.cost; });
    var usedL = {}, usedV = {}, made = [], gone = {};
    edges.forEach(function (e) {
      if (usedL[e.l._i] || usedV[e.v._i]) return;
      usedL[e.l._i] = usedV[e.v._i] = 1;
      gone[e.l._i] = gone[e.v._i] = 1;
      made.push({ text: e.l.text + ': ' + e.v.text, conf: Math.min(e.l.conf, e.v.conf), min: Math.min(e.l.min, e.v.min), chars: e.l.chars + e.v.chars,
        x0: Math.min(e.l.x0, e.v.x0), x1: Math.max(e.l.x1, e.v.x1), y0: e.l.y0, y1: e.l.y1 });
    });
    return items.filter(function (it) { return !gone[it._i]; }).concat(made);
  }

  // Puts the pieces back in reading order. Pieces side by side on one row are joined with three spaces, like columns in a PDF.
  function assemble(items, opts) {
    var minConf = opts && opts.minConf != null ? opts.minConf : 0.6, W = opts && opts.width || 0;
    var keep = items.filter(function (it) {
      var t = it.text.replace(/\s+/g, ' ').trim();
      it.text = t;
      if (!t) return false;
      var alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
      if (alnum < 1) return false;
      if (it.conf < minConf) return false;
      if (alnum < 2 && !/[0-9]/.test(t)) return false;
      // a round icon read as two or three letters is nearly square; real short words are wider than tall
      var aspect = (it.x1 - it.x0) / Math.max(1, it.y1 - it.y0);
      if (t.length <= 3 && aspect < 1.25 && !/^[\d$%.,]+$/.test(t)) return false;
      // a lone short made-up word at the far right or far left edge is an icon (the little "i" in a circle, a chevron)
      if (W && /^[A-Za-z]{1,4}$/.test(t) && !SHORT_OK[t.toLowerCase()] && (it.x0 > 0.7 * W || it.x1 < 0.15 * W)) return false;
      return true;
    });
    if (!opts || opts.pair !== false) keep = pairLabels(keep);
    keep.sort(function (a, b) { return (a.y0 + a.y1) - (b.y0 + b.y1); });
    var rows = [];
    keep.forEach(function (it) {
      var row = null;
      for (var i = rows.length - 1; i >= 0 && i >= rows.length - 3; i--) if (sameRow(rows[i].box, it)) { row = rows[i]; break; }
      if (!row) { row = { box: { y0: it.y0, y1: it.y1 }, items: [] }; rows.push(row); }
      row.items.push(it);
      row.box.y0 = Math.min(row.box.y0, it.y0); row.box.y1 = Math.max(row.box.y1, it.y1);
    });
    rows.sort(function (a, b) { return (a.box.y0 + a.box.y1) - (b.box.y0 + b.box.y1); });
    var lines = rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x0 - b.x0; });
      return r.items.map(function (i) { return i.text; }).join('   ');
    });
    return { text: lines.join('\n'), lines: lines, items: keep, all: items };
  }

  var api = {
    version: 1,
    loadModel: loadModel, b64bytes: b64bytes,
    hasModel: function () { return !!MODEL; },
    readGray: readGray, lumaFromRGBA: lumaFromRGBA,
    findLines: findLines, boxFor: boxFor, recogniseCrop: recogniseCrop,
    _forward: forward, _opt: OPT, _decode: decode, _resample: resample, _normalise: normalise
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DD2Ocr = api;
})(typeof window !== 'undefined' ? window : globalThis);

