/* Dispute Desk 2: the built-in reader.
   It reads text on this phone and fills in the same boxes Claude would. There is no network, no key and no account in here.
   It trusts only labels it knows (Account Number, Balance, Date Opened and so on). Anything it is not sure of stays blank, and a number that
   differs from bureau to bureau is left for the person to choose. It never decides whether an item is theirs or what is wrong with it:
   isMine, notMineKind, inqKind, accurate, facts and details come only from the person, so they are never set here.
   It keeps only the last four digits of an account number and removes anything that looks like a Social Security number. */
(function (root) {
  'use strict';
  var MAX_TEXT = 400000, MAX_LINE = 600, MAX_LINES = 15000, MAX_BLOCKS = 200, MAX_ENTRIES = 40;
  var MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  var NEG = { collection: 1, chargeoff: 1, repo: 1, late: 1, medical: 1, public: 1 };

  /* ---------- small readers: a date, an amount, an account number, a company name ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d, now) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1980) return '';
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
    if (dt.getTime() > now.getTime() + 400 * 86400000) return '';
    return y + '-' + pad(m) + '-' + pad(d);
  }
  function yr2(y, now) { return y <= (now.getFullYear() % 100) + 1 ? 2000 + y : 1900 + y; }
  /* A date as YYYY-MM-DD, or ''. A month and year alone becomes the first of that month. M/D/YY is read as month, day, year. */
  function dateOf(s, now) {
    s = String(s == null ? '' : s).trim();
    now = now || new Date();
    var m;
    if ((m = /\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/.exec(s))) return ymd(+m[1], +m[2], +m[3], now);
    if ((m = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/.exec(s))) return ymd(+m[3], +m[1], +m[2], now);
    if ((m = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2})\b/.exec(s))) return ymd(yr2(+m[3], now), +m[1], +m[2], now);
    if ((m = /\b(\d{1,2})[\/\-](\d{4})\b/.exec(s))) return ymd(+m[2], +m[1], 1, now);
    if ((m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s)) && MONTHS[m[1].toLowerCase()]) return ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2], now);
    if ((m = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(s)) && MONTHS[m[2].toLowerCase()]) return ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1], now);
    if ((m = /\b([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(s)) && MONTHS[m[1].toLowerCase()]) return ymd(+m[2], MONTHS[m[1].toLowerCase()], 1, now);
    return '';
  }
  /* An amount as a number, or null. A dollar sign makes it certain. Without one, the whole text must be the number. */
  function moneyOf(s) {
    s = String(s == null ? '' : s).trim();
    var m = /(?:^|[^\w.\-])\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/.exec(s) || /^(?:USD\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*USD)?$/.exec(s);
    if (!m) return null;
    var n = Number(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
    return isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
  }
  /* An account number as XXXX plus its last four digits, or ''. Only the digits at the very end count: a number that ends in hidden
     characters (4017XXXXXXXX) or has digits on both sides of the hidden part (8541XXXX90) says nothing sure about its last four. */
  function acctOf(s) {
    s = String(s == null ? '' : s).trim();
    if (!s || /^\d{3}[- ]\d{2}[- ]\d{4}$/.test(s)) return '';
    var t = '';
    if (/^[0-9xX*\u2022#.\s\-]+$/.test(s)) t = s.replace(/[\s\-]+/g, '');
    else {
      var parts = s.split(/\s+/);
      for (var i = 0; i < parts.length; i++) if (/^[0-9xX*\u2022#.\-]{4,}$/.test(parts[i]) && /\d/.test(parts[i])) { t = parts[i].replace(/-/g, ''); break; }
    }
    var m = /(\d{4,})$/.exec(t);
    return m ? 'XXXX' + m[1].slice(-4) : '';
  }
  var KEEP_UP = { llc: 1, lp: 1, llp: 1, na: 1, usa: 1, us: 1, usaa: 1, irs: 1, fnb: 1, nyc: 1, ii: 1, iii: 1, iv: 1, nco: 1, pnc: 1, hsbc: 1, td: 1, bmo: 1, gm: 1, ge: 1, iq: 1, lvnv: 1, cbe: 1, erc: 1, ncb: 1, ccs: 1, mcm: 1, pra: 1, bk: 1, dba: 1, ar: 1 };
  var SMALL = { of: 1, and: 1, the: 1, for: 1, at: 1, on: 1, in: 1 };
  /* Reports print company names in capitals. Make them read like a name, and leave anything already mixed-case alone. */
  function tidyName(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!s || /[a-z]/.test(s)) return s;
    var first = true;
    return s.toLowerCase().replace(/[a-z0-9']+/g, function (w) {
      var lead = first; first = false;
      if (KEEP_UP[w]) return w.toUpperCase();
      if (/^[a-z]{2,3}$/.test(w) && !/[aeiouy]/.test(w)) return w.toUpperCase();
      if (!lead && SMALL[w]) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  }
  function norm(s) { return ' ' + String(s == null ? '' : s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }
  function uniqueList(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* ---------- the labels it knows ---------- */
  var LAB = {
    furnisher: ['account name', 'creditor', 'creditor name', 'company', 'company name', 'furnisher', 'reported by', 'collection agency', 'collector', 'collecting agency', 'agency', 'agency name', 'current creditor', 'current creditor name', 'current owner', 'lender', 'lender name', 'subscriber', 'subscriber name', 'name of creditor', 'reporting company', 'data furnisher', 'credit grantor', 'grantor', 'creditor/collector', 'creditor / collector'],
    originalCreditor: ['original creditor', 'original creditor name', 'orig creditor', 'orig. creditor', 'original lender', 'original owner', 'original account owner', 'original company', 'previous creditor', 'prior creditor', 'originally owed to'],
    acct: ['account number', 'account no', 'account num', 'account #', 'account number (last 4)', 'account number last 4', 'acct number', 'acct no', 'acct #', 'acct', 'account ending', 'account number ending', 'number ending', 'card number', 'loan number', 'account id', 'account identifier'],
    acct2: ['original account number', 'collection account number'],
    openedDate: ['date opened', 'opened', 'open date', 'opened date', 'account opened', 'date account opened', 'account open date', 'opened on'],
    dofd: ['date of first delinquency', 'first delinquency', 'first delinquency date', 'date of 1st delinquency', 'dofd', 'delinquency date', 'date of delinquency', 'original delinquency date', 'date delinquent', 'date of first missed payment', 'first missed payment', 'date first delinquent', 'date of original delinquency', 'date major delinquency first reported', 'major delinquency first reported', 'delinquent since'],
    lastPayment: ['date of last payment', 'last payment date', 'last payment', 'date last paid', 'last paid', 'last payment made', 'date of last pmt', 'last pay date'],
    reportedDate: ['date first reported', 'first reported', 'date added', 'date added to file', 'date added to credit file', 'added to file', 'reported since', 'first reported on'],
    reportDate: ['date of report', 'report date', 'report generated', 'date generated', 'report as of', 'date of this report', 'report created', 'report run date'],
    statusDate: ['status date', 'date of status', 'charge off date', 'date of charge off', 'charged off date', 'date charged off', 'charge-off date', 'date of charge-off', 'collection date', 'date placed for collection', 'placed for collection date', 'date of collection', 'date placed'],
    inquiryDate: ['inquiry date', 'date of inquiry', 'inquired on', 'date inquired'],
    repoDate: ['repossession date', 'date of repossession', 'repo date', 'date repossessed', 'repossessed on'],
    saleDate: ['sale date', 'date of sale', 'date sold', 'sold on'],
    reportedBalance: ['balance', 'current balance', 'balance owed', 'amount owed', 'total balance', 'balance due', 'amount due', 'total due', 'outstanding balance', 'total amount due', 'amount of the debt', 'amount of debt', 'debt amount', 'current amount', 'balance amount', 'total owed', 'present balance', 'reported balance', 'total amount of the debt now', 'total amount of the debt'],
    originalBalance: ['original balance', 'original amount', 'original amount owed', 'original debt', 'original debt amount', 'amount placed for collection', 'amount placed', 'placed amount'],
    writtenOff: ['amount charged off', 'charge off amount', 'charged off amount', 'charge-off amount', 'amount written off', 'written off amount', 'write off amount', 'write-off amount', 'charge off', 'charge-off', 'charged off balance', 'amount of charge off', 'amount of charge-off'],
    repoOwed: ['amount owed at repossession', 'balance at repossession', 'balance when repossessed', 'payoff at repossession'],
    salePrice: ['sale price', 'sold for', 'sales price', 'sale proceeds', 'proceeds', 'net proceeds', 'amount received from sale'],
    saleFees: ['repossession fees', 'repossession costs', 'repo fees', 'repo costs', 'costs and fees', 'fees and costs', 'sale expenses', 'repossession and sale costs', 'repossession and sale expenses'],
    vehicle: ['vehicle', 'vehicle description', 'collateral', 'year make model', 'year, make and model', 'year make and model'],
    statusPay: ['payment status', 'pay status', 'current payment status'],
    status: ['account status', 'status', 'current status', 'status of account', 'account condition'],
    acctType: ['account type', 'type', 'loan type', 'type of account', 'portfolio type', 'account kind', 'account type description'],
    remarks: ['remarks', 'comments', 'comment', 'account remarks', 'narrative', 'notes', 'additional information', 'account notes'],
    cName: ['consumer name', 'full name', 'name on file', 'prepared for', 'report for', 'report prepared for', 'name of consumer'],
    cNameP: ['name'],
    cAddr: ['current address', 'current mailing address', 'mailing address', 'street address', 'address on file'],
    cAddrP: ['address'],
    oldAddr: ['previous address', 'former address', 'prior address', 'previous addresses', 'other address', 'address history']
  };
  /* these words are also what a value can say ("Account Type  Collection Agency"), so they count as labels only with a colon after them */
  var COLON_ONLY = { 'collection agency': 1, collector: 1, 'collecting agency': 1, agency: 1, company: 1, 'charge off': 1, 'charge-off': 1, opened: 1, proceeds: 1, comment: 1, notes: 1, narrative: 1, grantor: 1, lender: 1 };
  var KIND = { furnisher: 'name', originalCreditor: 'name', acct: 'acct', acct2: 'acct', openedDate: 'date', dofd: 'date', lastPayment: 'date', reportedDate: 'date', reportDate: 'date', statusDate: 'date', inquiryDate: 'date', repoDate: 'date', saleDate: 'date',
    reportedBalance: 'money', originalBalance: 'money', writtenOff: 'money', repoOwed: 'money', salePrice: 'money', saleFees: 'money', vehicle: 'text', statusPay: 'text', status: 'text', acctType: 'text', remarks: 'text', cName: 'name', cNameP: 'name', cAddr: 'addr', cAddrP: 'addr', oldAddr: 'addr' };
  function normLabel(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\u2022*>]+/g, ' ').replace(/[:.]+\s*$/, '').replace(/\s+/g, ' ').trim(); }
  var MAP = {}, PREFIX = [];
  Object.keys(LAB).forEach(function (f) {
    LAB[f].forEach(function (l, i) {
      var k = normLabel(l);
      if (!Object.prototype.hasOwnProperty.call(MAP, k)) MAP[k] = { f: f, p: i };
      if ((KIND[f] === 'date' || KIND[f] === 'money' || KIND[f] === 'acct') && !COLON_ONLY[k]) PREFIX.push({ k: k, f: f, p: i });
    });
  });
  PREFIX.sort(function (a, b) { return b.k.length - a.k.length; });
  var PREFIX_BY = {};
  PREFIX.forEach(function (p) { var w = p.k.split(' ')[0]; (PREFIX_BY[w] = PREFIX_BY[w] || []).push(p); });
  /* colon: true when the text was followed by a colon, which lets the plain-word labels through */
  function labelOf(txt, colon) {
    var k = normLabel(txt);
    if (!Object.prototype.hasOwnProperty.call(MAP, k)) return null;
    if (!colon && COLON_ONLY[k]) return null;
    return MAP[k];
  }
  function prefixLabel(cell) {
    var c = normLabel(cell.replace(/[:]/g, ' '));
    var list = PREFIX_BY[c.split(' ')[0]];
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (c.indexOf(p.k + ' ') === 0) {
        var rest = cell.slice(cell.toLowerCase().indexOf(p.k.split(' ')[0]) + p.k.length).replace(/^[\s:.\-]+/, '');
        if (/^[$\d(xX*\u2022#]/.test(rest)) return { lab: { f: p.f, p: p.p }, rest: rest };
      }
    }
    return null;
  }
  var LABELED = /^[A-Za-z][A-Za-z0-9 .#\/&'()\-]{1,40}:(?:\s|$)/;
  function isLabelCell(cell) { var m = /^([^:]{2,50}?)\s*:/.exec(cell); return !!(labelOf(cell) || (m && labelOf(m[1], true)) || LABELED.test(cell)); }
  function lineHasLabel(line) { return line.split(/ {2,}/).some(isLabelCell); }

  var HEADINGS = [
    ['personal', /^(?:your )?(?:personal|consumer|identification)(?: identifying)?(?: information| info| profile| details| data)?$/i],
    ['accounts', /^(?:accounts?|collections?(?: accounts?)?|tradelines?|credit accounts?|negative (?:accounts?|items?)|account information|accounts? in (?:good standing|collections?)|open accounts?|closed accounts?|accounts? (?:with|showing) .{3,30}|potentially negative(?: items?)?|collection items?|adverse accounts?|satisfactory accounts?)$/i],
    ['inquiries', /^(?:hard |soft |regular |account review |promotional )?inquir(?:y|ies)(?: .{0,30})?$/i],
    ['public', /^public records?(?: .{0,30})?$/i]
  ];
  function headingOf(line) {
    var l = String(line || '').replace(/[:\s]+$/, '');
    if (!l || l.length > 60) return '';
    for (var i = 0; i < HEADINGS.length; i++) if (HEADINGS[i][1].test(l)) return HEADINGS[i][0];
    return '';
  }
  var FOOTER = /^(?:end of (?:the )?(?:credit )?report|page \d+(?: of \d+)?$|copyright|\u00a9|terms of (?:use|service)|privacy (?:policy|notice)|how to dispute|important information|disclaimer)/i;

  /* ---------- text to lines ---------- */
  var SSN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;
  function prep(text) {
    var t = String(text == null ? '' : text);
    if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT);
    try { t = t.normalize('NFKC'); } catch (e) { /* an old engine keeps the text as it is */ }
    t = t.replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/\r\n?|\u2028|\u2029|\f|\v/g, '\n')
      .replace(SSN, '[removed]');
    var all = t.split('\n');
    if (all.length > MAX_LINES) all = all.slice(0, MAX_LINES);
    return all.map(function (l) {
      /* long runs of spaces and tabs become one column gap first, so nothing below has a long run to work through */
      l = l.replace(/[ \t]{3,}/g, '   ');
      if (l.length > MAX_LINE) l = l.slice(0, MAX_LINE);
      l = l.replace(/ ?\| ?/g, '   ').replace(/[ \t]+$/, '').replace(/^[ \t\u2022\u25cf\u25aa*]+(?=\S)/, '');
      return l.replace(/^ +/, '');
    });
  }

  /* ---------- find every "label, then value" in the text ---------- */
  function nextLine(lines, i) {
    var k = i + 1;
    if (k < lines.length && !lines[k]) k++;
    return k < lines.length && lines[k] && !headingOf(lines[k]) && !FOOTER.test(lines[k]) && !lineHasLabel(lines[k]) ? lines[k] : '';
  }
  var HIST_COL = /^(?:date|month|period|year|as of|payment date)$/i;
  function scan(lines) {
    var out = [], sec = '', secText = '', secs = [], secTexts = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], h = headingOf(line);
      if (h) { sec = h; secText = line.replace(/[:\s]+$/, ''); }
      secs[i] = sec; secTexts[i] = secText;
      if (!line || h) continue;
      var cells = line.split(/ {2,}/), j = 0;
      var labCount = cells.filter(function (c) { return !!labelOf(c); }).length;
      /* the header of a month-by-month history table is not an account's own fields */
      if (labCount >= 2 && cells.some(function (c) { return HIST_COL.test(normLabel(c)); })) continue;
      var nlHead = labCount >= 2 ? nextLine(lines, i) : '';
      var ncHead = nlHead ? nlHead.split(/ {2,}/) : null;
      while (j < cells.length) {
        var c = cells[j], j0 = j, m, lab = null, vtxt = '';
        if ((m = /^([^:]{2,50}?)\s*:\s*(.*)$/.exec(c)) && (lab = labelOf(m[1], true))) { vtxt = m[2]; j++; }
        else if ((lab = labelOf(c))) { j++; }
        else if (ncHead && ncHead.length === cells.length && /^(?:account|creditor\/account|account\/creditor)$/i.test(normLabel(c))) { lab = { f: 'furnisher', p: 40 }; j++; }
        else if ((m = prefixLabel(c))) { lab = m.lab; vtxt = m.rest; j++; }
        else { j++; continue; }
        var vals = [];
        if (vtxt) vals.push(vtxt);
        while (j < cells.length && !isLabelCell(cells[j])) { vals.push(cells[j]); j++; }
        if (!vals.length) {
          var nl = nextLine(lines, i);
          if (nl) {
            var nc = nl.split(/ {2,}/);
            /* a row of labels over a row of values: take the value in the same column */
            vals = (labCount >= 2 && nc.length === cells.length) ? [nc[j0]] : nc;
          }
        }
        out.push({ f: lab.f, p: lab.p, i: i, vals: vals, sec: sec });
      }
    }
    return { pairs: out, secs: secs, secTexts: secTexts };
  }

  /* ---------- value readers for each kind of field ---------- */
  var JUNK = /^(?:n\/a|na|none|unknown|not reported|not available|not provided|--+|-|\.+|no data|null)$/i;
  var LONGNUM = /\d{9,}/;
  function nameOf(s) {
    s = String(s == null ? '' : s).replace(/^[\s>*:\-]+|[\s<*:\-]+$/g, '').replace(/\s+/g, ' ');
    if (!s || s.length < 2 || s.length > 80 || JUNK.test(s) || !/[A-Za-z]{2}/.test(s) || LONGNUM.test(s)) return '';
    if (labelOf(s, true) || /:\s*$/.test(s) || dateOf(s) || moneyOf(s) != null) return '';
    if (/^\d/.test(s) && !/[A-Za-z]{3}/.test(s)) return '';
    return s;
  }
  function textOf(s, max) {
    s = String(s == null ? '' : s).replace(/^[\s>*:\-]+|[\s<*:\-]+$/g, '').replace(/\s+/g, ' ');
    if (!s || JUNK.test(s) || labelOf(s, true) || LONGNUM.test(s)) return '';
    return s.length > (max || 80) ? s.slice(0, max || 80) : s;
  }
  /* The best reading of one field. The label that ranks highest and has a readable value wins. Every value under that label must agree;
     if two lines or two columns disagree, the field comes back as ambiguous so the caller leaves it blank. With first=true (names and text),
     the first value in a row is taken, because bureaus often spell one name three ways, but two different lines still disagree. */
  function pick(cands, parse, first) {
    var ranks = uniqueList(cands.map(function (c) { return c.p; })).sort(function (a, b) { return a - b; });
    for (var n = 0; n < ranks.length; n++) {
      var group = cands.filter(function (c) { return c.p === ranks[n]; }).sort(function (a, b) { return a.i - b.i; }), vals = [];
      for (var g = 0; g < group.length; g++) {
        var row = [];
        for (var k = 0; k < group[g].vals.length; k++) { var v = parse(group[g].vals[k]); if (v !== '' && v != null) row.push(v); }
        if (!row.length) continue;
        if (first) vals.push(row[0]); else vals = vals.concat(row);
      }
      if (!vals.length) continue;
      var u = first ? uniqueList(vals.map(function (x) { return norm(x); })).length > 1 ? uniqueList(vals) : [vals[0]] : uniqueList(vals);
      if (u.length > 1) return { amb: u };
      return { v: u[0] };
    }
    return null;
  }

  /* ---------- a mailing address ---------- */
  var ST = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR|GU|VI|AS|MP';
  var CSZ = new RegExp('^([A-Za-z][A-Za-z .\'\\-]{1,40}?),?\\s+(' + ST + ')\\.?\\s+(\\d{5})(?:-\\d{4})?$', 'i');
  var STREETISH = /^(?:\d{1,6}[A-Za-z]?\s+\S|p\.?\s?o\.?\s*box\s+\d|post office box\s+\d)/i;
  function cszOf(s) { var m = CSZ.exec(String(s).trim()); return m ? { city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] } : null; }
  function addrOf(v, next) {
    v = String(v == null ? '' : v).trim();
    if (!v) return null;
    var parts = v.split(/\s*,\s*/), m;
    if (parts.length >= 3) {
      var tail = cszOf(parts.slice(-2).join(', '));
      if (tail && STREETISH.test(parts[0])) return { street: parts.slice(0, -2).join(', '), city: tail.city, state: tail.state, zip: tail.zip };
    }
    if (STREETISH.test(v) && next && (m = cszOf(next))) return { street: v, city: m.city, state: m.state, zip: m.zip };
    return null;
  }
  var COMPANY_WORDS = /\b(?:inc|llc|l\.l\.c|lp|llp|ltd|corp|corporation|company|co\.|bank|financial|funding|recovery|collections?|credit|capital|services?|associates|management|holdings|group|agency|finance|national|federal|university|hospital|medical|health|systems|solutions|partners|usa|n\.a\.|interstate|outsourcing|receivables|portfolio|acceptance|billing|spv|trust|union|insurance|lending|mortgage|auto|card|department|dept|office|center|centre)\b/i;
  function personName(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 60 || /\d/.test(s) || COMPANY_WORDS.test(s) || /[:@\/]/.test(s)) return '';
    var w = s.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
    if (w.length < 2 || w.length > 4) return '';
    return w.every(function (x) { return /^[A-Za-z][A-Za-z'\-]*$/.test(x) || /^[A-Z]$/.test(x); }) ? s : '';
  }
  var SENDERISH = /\b(?:from|remit|return|send payments?|make checks|payable|mail payments?|payments? to|sincerely|regards)\b/i;

  /* ---------- who the report belongs to: only from labels, or from one clear address block ---------- */
  function consumerOf(lines, scanned, D) {
    var out = { name: '', street: '', city: '', state: '', zip: '' };
    var P = scanned.pairs, n = null, i;
    var names = P.filter(function (p) { return p.f === 'cName' || (p.f === 'cNameP' && p.sec === 'personal'); });
    var nm = pick(names, function (v) { var x = nameOf(v); return x && personName(x) ? x : ''; }, true);
    if (nm && nm.v) out.name = nm.v;
    var cur = P.filter(function (p) { return p.f === 'cAddr' || (p.f === 'cAddrP' && p.sec === 'personal'); });
    var addrs = [];
    cur.forEach(function (p) {
      var nxt = lines[p.i + 1] || '';
      var a = addrOf(p.vals[0] || '', p.vals.length && lines[p.i].indexOf(p.vals[0]) >= 0 ? nxt : (lines[p.i + 2] || ''));
      if (a) addrs.push({ a: a, strong: p.f === 'cAddr' });
    });
    var strong = addrs.filter(function (x) { return x.strong; });
    var use = strong.length ? strong : addrs;
    var keys = uniqueList(use.map(function (x) { return [x.a.street, x.a.city, x.a.state, x.a.zip].join('|').toLowerCase(); }));
    if (use.length && keys.length === 1) n = use[0].a;
    if (!n && !addrs.length) {
      /* a letter's address block: a person's name, a street line and a city line in a row. It counts only when it is the one such block,
         is not a company, and either sits under a salutation that uses the same name, follows a date, or is not at the very top. */
      var found = [];
      var dear = null;
      lines.forEach(function (l) { var d = /^Dear\s+(.{3,60}?)\s*[,:]?$/.exec(l); if (d && !dear) dear = d[1]; });
      for (i = 0; i + 2 < lines.length; i++) {
        var pn = personName(lines[i]);
        if (!pn || !STREETISH.test(lines[i + 1]) || !cszOf(lines[i + 2])) continue;
        if (SENDERISH.test(lines[i - 1] || '') || SENDERISH.test(lines[i])) continue;
        if (D && (D.creditorFor(pn) || dirScan(pn, D).length)) continue;
        var c = cszOf(lines[i + 2]);
        var prevLine = '', k = i - 1;
        while (k >= 0 && !lines[k]) k--;
        if (k >= 0) prevLine = lines[k];
        var dearMatch = !!dear && norm(dear).trim().split(' ').pop() === norm(pn).trim().split(' ').pop();
        var afterDate = !!prevLine && !!dateOf(prevLine) && prevLine.length < 40;
        if (dearMatch || afterDate || i >= 4) found.push({ name: pn, street: lines[i + 1], city: c.city, state: c.state, zip: c.zip });
        else found.push({ name: pn, street: lines[i + 1], city: c.city, state: c.state, zip: c.zip, weak: true });
      }
      var fk = uniqueList(found.map(function (x) { return [x.name, x.street, x.zip].join('|').toLowerCase(); }));
      if (fk.length === 1 && !found[0].weak) { n = found[0]; if (!out.name) out.name = n.name; }
    }
    if (!out.name) {
      var dm = /^Dear\s+([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,3})\s*[,:]?$/.exec(lines.filter(function (l) { return /^Dear\s/.test(l); })[0] || '');
      if (dm && personName(dm[1])) out.name = dm[1];
    }
    if (n) { out.street = n.street; out.city = n.city; out.state = n.state; out.zip = n.zip; }
    return (out.name || out.street) ? out : null;
  }

  /* ---------- the words that say what kind of item it is ---------- */
  var MED = /\b(?:medical|hospital|health ?care|physicians?|clinic|urgent care|dental|dentist|ambulance|radiology|laborator(?:y|ies)|pathology|anesthesi\w*|emergency (?:room|physicians?)|surgical|pharmacy|ortho\w*|dermatolog\w*|pediatric\w*)\b/i;
  var COLLECTOR_NAME = /\b(?:recovery|collections?|collection agency|credit management|portfolio|asset acceptance|midland|lvnv|resurgent|cavalry|jefferson capital|encore capital|convergent|transworld|nco financial|iq data|allied interstate|diversified consultants|national credit|account control|asset recovery|debt (?:buyer|recovery|solutions)|receivables|credit adjustment|financial recovery|revenue (?:group|cycle)|professional (?:credit|finance)|unifund|sherman|aargon|credit bureau|enhanced recovery|erc)\b/i;
  /* "no late payments", "never delinquent", "Late payments: 0" and "Past due amount: $0" say the opposite of what the bare words do */
  function stripNeg(t) {
    return t
      .replace(/\b(?:late payments?|delinquenc\w+|charge[- ]?offs?|collections?|repossessions?|past due)\s*[:=]\s*(?:0|none|no|n\/a)\b/g, ' ')
      .replace(/\b(?:30|60|90|120)[- ]?(?:days?[- ]?)?(?:past due|late)\s*[:=]?\s*0\b/g, ' ')
      .replace(/\bpast due(?: amount)?\s*[:=]\s*\$?0(?:\.00)?\b/g, ' ')
      .replace(/\b(?:no|never|not|zero|without|0)\s+(?:\w+\s+){0,2}(?:late|delinquen\w*|past due|charge[ds]?[- ]?offs?|charged off|collections?|repossessions?|bankruptc\w*)\b/g, ' ');
  }
  function classify(c) {
    var all = stripNeg(String(c.all || '').toLowerCase()), lim = stripNeg(String(c.lim || '').toLowerCase()), at = String(c.acctType || '').toLowerCase();
    if (/repossess|voluntary surrender|vehicle (?:was )?(?:sold|recovered)/.test(all)) return 'repo';
    if (/\b(?:bankruptcy|chapter (?:7|11|13)|civil judgment|tax lien|judgment (?:entered|filed|amount|date))\b/.test(all)) return 'public';
    if (/\b(?:inquiry date|date of inquiry|type of inquiry|hard inquiry|inquired on)\b/.test(all) || (c.sec === 'inquiries' && !c.hasAcct)) return 'inquiry';
    var coll = /\bcollection(?:s)?\b|debt collector|debt buyer|collecting a debt|collect a debt|attempt(?:ing)? to collect|trying to collect|placed for collection/.test(lim) || /collection/.test(at) || c.dirKind === 'collector' || /collection/.test(String(c.secText || '').toLowerCase());
    var co = /charge[ds]?[- ]?off|charged off|written off|bad debt|profit and loss/.test(lim);
    if (coll && co && !/collection/.test(at) && c.dirKind !== 'collector' && !COLLECTOR_NAME.test(c.furn || '') && !/\b(?:collection agency|debt collector|debt buyer|placed for collection)\b/.test(lim) && !/collection/.test(String(c.secText || '').toLowerCase())) coll = false;
    if (coll) return MED.test((c.furn || '') + ' ' + at + ' ' + (c.orig || '') + ' ' + (c.remarks || '')) ? 'medical' : 'collection';
    if (co) return 'chargeoff';
    if (/\b(?:30|60|90|120|150|180)[- ]?(?:days?[- ]?)?(?:past due|late)\b|late payments?|days late|\bdelinquent\b/.test(lim)) return 'late';
    return '';
  }

  /* ---------- the creditor list that is already in the app ---------- */
  var dirCache = null;
  function dirIndex(D) {
    if (dirCache && dirCache.src === D.CREDITORS) return dirCache.list;
    var list = [];
    (D.CREDITORS || []).forEach(function (c) {
      [c.name].concat(c.also || []).forEach(function (a) {
        var k = norm(String(a).replace(/\*$/, ''));
        if (k.trim().length >= 5) list.push({ k: k, c: c });
      });
    });
    list.sort(function (a, b) { return b.k.length - a.k.length; });
    dirCache = { src: D.CREDITORS, list: list };
    return list;
  }
  function dirScan(text, D) {
    var t = norm(text), hits = [], seen = {}, list = dirIndex(D);
    for (var i = 0; i < list.length; i++) {
      var p = t.indexOf(list[i].k);
      if (p >= 0 && !seen[list[i].c.id]) { seen[list[i].c.id] = 1; hits.push({ c: list[i].c, pos: p, len: list[i].k.length }); }
    }
    hits.sort(function (a, b) { return a.pos - b.pos; });
    return hits;
  }

  /* ---------- sentences in a collector's letter (the wording of the federal model validation notice, and plain variants) ---------- */
  var NAME_CH = "[A-Z][A-Za-z0-9&.,'\\/\\- ]";
  function cleanSender(s) {
    s = String(s || '');
    var di = s.search(/Dear\s+[^,:]{2,50}[,:]\s*(?!.*Dear\s)/i);
    if (di >= 0) s = s.slice(di).replace(/^Dear\s+[^,:]{2,50}[,:]\s*/i, '');
    var cells = s.split(/ {2,}/);
    s = cells[cells.length - 1];
    /* keep what comes after the last sentence end, unless that period closes an abbreviation like Inc. or Co. */
    var re = /([.!?])\s+(?=[A-Z])/g, m, cut = 0;
    while ((m = re.exec(s))) {
      var before = s.slice(0, m.index).split(/\s+/).pop().toLowerCase();
      if (!/^(?:inc|co|corp|ltd|llc|l\.l\.c|n\.a|na|mgmt|assn|assoc|dept|svcs)$/.test(before)) cut = m.index + m[0].length;
    }
    return s.slice(cut).replace(/[,\s]+$/, '').trim();
  }
  function narrative(lines) {
    var out = {}, m, i, t = lines.join('\n'), flat = t.replace(/\s+/g, ' ');
    for (i = 0; i < lines.length && !out.furnisher; i++) {
      if ((m = /^(.{3,140}?)\s+(?:is|are)\s+(?:a\s+debt\s+collector|attempting\s+to\s+collect|trying\s+to\s+collect|collecting\s+a\s+debt)/i.exec(lines[i]))) {
        var nmv = cleanSender(m[1]);
        if (nmv && nmv.length >= 3 && nmv.length <= 80 && /^[A-Z]/.test(nmv) && !/^(?:we|you|this|that|it|the)\b/i.test(nmv)) out.furnisher = nmv;
      }
    }
    if ((m = new RegExp('original\\s+creditor\\s+(?:is|was)\\s+(' + NAME_CH + '{2,60}?)(?=\\s*[.;]|\\s{2,}| account| with | and |$)').exec(flat))) out.originalCreditor = m[1].trim();
    if ((m = new RegExp('You\\s+had\\s+an?\\s+[A-Za-z .\\-]{3,40}?\\s+from\\s+(' + NAME_CH + '{2,60}?)\\s+with\\s+(?:account|acct)\\s*(?:number|no\\.?|#)?\\s*[:#]?\\s*([0-9xX*\\u2022#\\-]{4,30})').exec(flat))) { out.originalCreditor = out.originalCreditor || m[1].trim(); out.acct = m[2]; }
    if (!out.originalCreditor && (m = new RegExp('(?:debt|account)\\s+that\\s+you\\s+owe\\s+to\\s+(' + NAME_CH + '{2,60}?)(?=\\s*[.;]|\\s{2,}| account| with | and |$)').exec(flat))) out.owedTo = m[1].trim();
    if ((m = /(?:account|acct|card|loan)\s*(?:number\s*)?(?:ending|ends)\s*(?:in|with)?\s*[:#]?\s*(\d{4})\b/i.exec(flat))) out.acct = out.acct || ('XXXX' + m[1]);
    if ((m = /(?:total\s+amount\s+of\s+the\s+debt\s+now|you\s+owe|balance\s+(?:due|owed)|amount\s+of\s+(?:the\s+)?debt|total\s+(?:amount\s+)?due|current\s+balance)[^$\d]{0,40}(\$\s?\d[\d,]*(?:\.\d{1,2})?)/i.exec(flat))) out.balance = m[1];
    if ((m = /(\$\s?\d[\d,]*(?:\.\d{1,2})?)\s+(?:was\s+|were\s+|has been\s+|have been\s+)?(?:written off|charged off)/i.exec(flat))) out.writtenOff = m[1];
    if ((m = /charge[- ]?off\s+date[,:]?\s*(?:of|was|is)?\s*([A-Za-z0-9,\/.\- ]{6,22})/i.exec(flat)) || (m = /charged[- ]off\s+on\s+([A-Za-z0-9,\/.\- ]{6,22})/i.exec(flat))) out.chargeOffDate = m[1];
    return out;
  }
  function bureausOf(text) {
    var t = String(text || ''), out = [];
    if (/\bexperian\b/i.test(t)) out.push('experian');
    if (/\bequifax\b/i.test(t)) out.push('equifax');
    if (/\btrans\s?union\b/i.test(t)) out.push('transunion');
    return out;
  }

  /* ---------- split a long report into its accounts ---------- */
  function headerish(line) {
    if (!line || line.length > 70 || headingOf(line) || FOOTER.test(line)) return false;
    if (isLabelCell(line) || lineHasLabel(line) || /:/.test(line) || /^\d/.test(line)) return false;
    if (dateOf(line) || moneyOf(line) != null || !/[A-Za-z]{3}/.test(line)) return false;
    return line.split(/ {2,}/).length === 1;
  }
  var REPORT_TITLE = /\b(?:credit report|credit file|credit summary|report summary|equifax|experian|transunion|trans union|annualcreditreport)\b/i;
  function isTitle(lines, i) {
    if (!headerish(lines[i]) || REPORT_TITLE.test(lines[i])) return false;
    for (var k = i + 1; k < lines.length && k <= i + 2; k++) { if (!lines[k]) continue; return lineHasLabel(lines[k]); }
    return false;
  }
  function segment(lines, scanned) {
    var anchors = [], k;
    scanned.pairs.forEach(function (p) { if (p.f === 'acct' && p.sec !== 'personal') anchors.push(p.i); });
    anchors = uniqueList(anchors).sort(function (a, b) { return a - b; });
    var whole = { from: 0, to: lines.length };
    var firstInq = -1;
    for (k = 0; k < lines.length; k++) if (scanned.secs[k] === 'inquiries' && headingOf(lines[k]) === 'inquiries') { firstInq = k; break; }
    if (anchors.length < 2) {
      var wh = { from: 0, to: firstInq >= 0 ? firstInq : lines.length };
      return [wh];
    }
    var blankDense = (function () {
      var lab = 0, gap = 0;
      lines.forEach(function (l, i) { if (l && lineHasLabel(l)) { lab++; if (i + 1 < lines.length && !lines[i + 1] && lines[i + 2]) gap++; } });
      return lab > 4 && gap / lab > 0.25;
    })();
    var starts = [];
    for (k = 0; k < anchors.length; k++) {
      var lo = k ? anchors[k - 1] + 1 : 0, a = anchors[k], start = -1, i, blanks = 0;
      for (i = a - 1; i >= lo; i--) {
        var l = lines[i];
        if (headingOf(l)) { start = i + 1; break; }
        if (!l) { blanks++; if (!blankDense || blanks >= 2) { var nx = i + 1; while (nx < a && !lines[nx]) nx++; start = nx; break; } continue; }
        blanks = 0;
        if (isTitle(lines, i)) { start = i; break; }
      }
      if (start < 0) start = k ? -1 : lo;
      starts.push(start);
    }
    var blocks = [];
    for (k = 0; k < anchors.length; k++) {
      if (starts[k] < 0) { if (blocks.length) continue; starts[k] = 0; }
      blocks.push({ from: starts[k], anchor: anchors[k] });
    }
    for (k = 0; k < blocks.length; k++) {
      var end = k + 1 < blocks.length ? blocks[k + 1].from : lines.length;
      for (var j = blocks[k].anchor + 1; j < end; j++) if (headingOf(lines[j]) || FOOTER.test(lines[j])) { end = j; break; }
      blocks[k].to = end;
    }
    return blocks.length >= 2 ? blocks : [whole.to > 0 ? { from: 0, to: firstInq >= 0 ? firstInq : lines.length } : whole];
  }

  /* ---------- one account, from the lines that belong to it ---------- */
  var ORDER = ['furnisher', 'originalCreditor', 'accountRef', 'openedDate', 'dofd', 'lastPayment', 'reportedDate', 'statusDate', 'reportedBalance', 'originalBalance', 'writtenOff', 'statusText', 'inquiryDate', 'repoDate', 'vehicle', 'repoOwed', 'saleDate', 'salePrice', 'saleFees'];
  var SAYS = { furnisher: 'company', originalCreditor: 'original creditor', accountRef: 'account number', openedDate: 'date opened', dofd: 'date of first delinquency', lastPayment: 'last payment', reportedDate: 'date first reported', reportDate: 'report date', statusDate: 'status date', reportedBalance: 'balance', originalBalance: 'original balance', writtenOff: 'amount charged off', statusText: 'status', inquiryDate: 'inquiry date', repoDate: 'repossession date', vehicle: 'vehicle', repoOwed: 'amount owed at repossession', saleDate: 'sale date', salePrice: 'sale price', saleFees: 'sale costs' };
  function emptyR() {
    return { itemType: null, furnisher: null, originalCreditor: null, accountRef: null, bureaus: [], reportDate: null, reportedDate: null, openedDate: null, dofd: null, inquiryDate: null,
      reportedBalance: null, originalBalance: null, writtenOff: null, lastPayment: null, statusDate: null, firstLate: null, priorCount: null, repoDate: null, vehicle: null, repoOwed: null,
      saleDate: null, salePrice: null, saleFees: null, statusText: null, consumer: { name: null, street: null, city: null, state: null, zip: null },
      isMine: null, notMineKind: null, inqKind: null, accurate: false, facts: [], details: {}, readBack: '', questions: [] };
  }
  function moneyText(D, n) { return D && D.money ? D.money(n) : '$' + n; }
  function entryOf(ctx, from, to) {
    var lines = ctx.lines, scanned = ctx.scanned, D = ctx.D, now = ctx.now, consumer = ctx.consumer, single = ctx.single;
    var blkLines = lines.slice(from, to), text = blkLines.join('\n');
    var pairs = scanned.pairs.filter(function (p) { return p.i >= from && p.i < to; });
    var by = {};
    pairs.forEach(function (p) { (by[p.f] = by[p.f] || []).push(p); });
    var r = emptyR(), found = [], skipped = [], checks = [], nar = narrative(blkLines);
    function put(key, v) { if (v == null || v === '') return; r[key] = v; if (found.indexOf(key) < 0) found.push(key); }
    function drop(key) { if (r[key] != null) { r[key] = null; var x = found.indexOf(key); if (x >= 0) found.splice(x, 1); } }
    function skip(key, vals) { skipped.push({ k: key, vals: vals }); }

    function date(field, key, extra) {
      var cands = (by[field] || []).slice();
      if (extra) cands.push({ f: field, p: 90, i: 0, vals: [extra] });
      var c = pick(cands, function (v) { return dateOf(v, now); });
      if (!c) return;
      if (c.amb) skip(key, c.amb); else put(key, c.v);
    }
    function money(field, key, extra) {
      var cands = (by[field] || []).slice();
      if (extra != null) cands.push({ f: field, p: 90, i: 0, vals: [extra] });
      var c = pick(cands, moneyOf);
      if (!c) return;
      if (c.amb) skip(key, c.amb.map(function (n) { return moneyText(D, n); })); else put(key, c.v);
    }
    date('openedDate', 'openedDate'); date('dofd', 'dofd'); date('lastPayment', 'lastPayment'); date('reportedDate', 'reportedDate'); date('reportDate', 'reportDate');
    date('statusDate', 'statusDate', single ? nar.chargeOffDate : ''); date('inquiryDate', 'inquiryDate'); date('repoDate', 'repoDate'); date('saleDate', 'saleDate');
    money('reportedBalance', 'reportedBalance', nar.balance); money('originalBalance', 'originalBalance'); money('writtenOff', 'writtenOff', nar.writtenOff);
    money('repoOwed', 'repoOwed'); money('salePrice', 'salePrice'); money('saleFees', 'saleFees');
    if (r.reportDate == null && ctx.docReportDate) put('reportDate', ctx.docReportDate);

    var ac = pick((by.acct || []).concat(by.acct2 || []), acctOf);
    if (ac && !ac.amb) put('accountRef', ac.v);
    else if (ac && ac.amb) skip('accountRef', ac.amb);
    else if (nar.acct && acctOf(nar.acct)) put('accountRef', acctOf(nar.acct));

    var orig = pick(by.originalCreditor || [], nameOf, true);
    var origName = orig && !orig.amb ? tidyName(orig.v) : (nar.originalCreditor ? tidyName(nameOf(nar.originalCreditor)) : '');
    var fl = pick(by.furnisher || [], nameOf, true), furn = fl && !fl.amb ? tidyName(fl.v) : '';
    var via = furn ? 'label' : '';
    var hits = dirScan(text, D);
    if (!furn && nar.furnisher) { furn = tidyName(nameOf(nar.furnisher)); via = 'letter'; }
    function companyish(hn) { return !!hn && !REPORT_TITLE.test(hn) && !/^(?:dear|re|date|page|to|from|attn)\b/i.test(hn) && !personName(hn) && !!(D.creditorFor(hn) || COMPANY_WORDS.test(hn) || (hn === hn.toUpperCase() && /\s/.test(hn))); }
    if (!furn && !(fl && fl.amb)) {
      /* a company name standing alone right above the details */
      for (var i = from; i < Math.min(to, from + 8); i++) {
        if (!isTitle(lines, i)) continue;
        var hn = nameOf(lines[i]);
        if (companyish(hn)) { furn = tidyName(hn); via = 'heading'; break; }
      }
    }
    if (!furn && !(fl && fl.amb) && single) {
      /* the first line of a letter, when an address follows it */
      var f0 = from; while (f0 < to && !lines[f0]) f0++;
      var hn0 = f0 < to ? nameOf(lines[f0]) : '';
      if (companyish(hn0) && STREETISH.test(lines[f0 + 1] || '')) { furn = tidyName(hn0); via = 'letterhead'; }
    }
    var collHit = null, lendHit = null;
    hits.forEach(function (h) { if (h.c.kind === 'collector') { if (!collHit) collHit = h; } else if (!lendHit) lendHit = h; });
    if (!furn && !(fl && fl.amb)) {
      var pickHit = collHit || lendHit;
      if (pickHit) { furn = pickHit.c.name; via = 'list'; checks.push('furnisher'); }
    }
    if (!origName && nar.owedTo && furn && norm(nar.owedTo) !== norm(furn)) { origName = tidyName(nameOf(nar.owedTo)); checks.push('originalCreditor'); }
    if (!origName && furn && collHit && lendHit && via !== 'list' && D.creditorFor(furn) && D.creditorFor(furn).kind === 'collector') { origName = lendHit.c.name; checks.push('originalCreditor'); }
    if (origName && furn && norm(origName) === norm(furn)) origName = '';
    if (fl && fl.amb) skip('furnisher', fl.amb);
    put('furnisher', furn); put('originalCreditor', origName);

    var sp = pick(by.statusPay || [], textOf, true);
    var st = pick(by.status || [], textOf, true);
    var spv = (sp && !sp.amb ? sp.v : '') || (st && !st.amb ? st.v : '');
    if (spv) put('statusText', spv.replace(/^[><\s]+|[><\s]+$/g, ''));
    var vh = pick(by.vehicle || [], textOf, true);
    if (vh && !vh.amb && /\b(?:19|20)\d{2}\b/.test(vh.v)) put('vehicle', tidyName(vh.v));

    var typeLabel = pick(by.acctType || [], textOf, true), rem = pick(by.remarks || [], function (v) { return textOf(v, 300); }, true);
    var kind = (D.creditorFor(furn) || {}).kind || (collHit && furn === collHit.c.name ? 'collector' : '');
    var sec = pairs.length ? pairs[0].sec : (scanned.secs[from] || '');
    var limText = [furn, origName, typeLabel && !typeLabel.amb ? typeLabel.v : '', st && !st.amb ? st.v : '', sp && !sp.amb ? sp.v : '', rem && !rem.amb ? rem.v : ''].join('  ');
    var type = classify({
      all: text, lim: single ? text : limText, furn: furn, orig: origName, acctType: typeLabel && !typeLabel.amb ? typeLabel.v : '', remarks: rem && !rem.amb ? rem.v : '',
      dirKind: kind, hasAcct: !!r.accountRef || !!(by.acct && by.acct.length), sec: sec, secText: scanned.secTexts[from] || ''
    });
    if (type) { r.itemType = type; found.push('itemType'); }
    if (type !== 'repo') ['repoDate', 'vehicle', 'repoOwed', 'saleDate', 'salePrice', 'saleFees'].forEach(drop);
    if (type === 'inquiry') ['reportedBalance', 'originalBalance', 'writtenOff'].forEach(drop);

    var bu = bureausOf(text);
    if (!bu.length && ctx.docBureaus.length === 1) bu = ctx.docBureaus;
    if (single && ctx.docBureaus.length) bu = ctx.docBureaus;
    if (bu.length) { r.bureaus = bu; found.push('bureaus'); }
    if (consumer) {
      Object.keys(consumer).forEach(function (k) { if (consumer[k]) r.consumer[k] = consumer[k]; });
      found.push('consumer');
    }
    var entry = { r: r, found: found, skipped: skipped, checks: checks, via: via, from: from, to: to, section: scanned.secTexts[from] || '' };
    entry.title = r.furnisher || 'An account';
    var bits = [];
    if (r.itemType && D.TYPES && D.TYPES[r.itemType]) bits.push(D.TYPES[r.itemType].label);
    if (r.accountRef) bits.push('ending ' + r.accountRef.slice(-4));
    if (r.reportedBalance != null) bits.push(moneyText(D, r.reportedBalance));
    if (r.inquiryDate) bits.push(r.inquiryDate);
    entry.sub = bits.join(' \u00b7 ');
    entry.negative = !!NEG[r.itemType];
    r.readBack = readBack(entry, D);
    return entry;
  }
  function readBack(e, D) {
    var r = e.r, parts = [];
    if (r.furnisher) parts.push(r.furnisher + (r.originalCreditor ? ' (original creditor ' + r.originalCreditor + ')' : ''));
    if (r.itemType && D.TYPES && D.TYPES[r.itemType]) parts.push(D.TYPES[r.itemType].label.toLowerCase());
    if (r.accountRef) parts.push('account ending ' + r.accountRef.slice(-4));
    if (r.reportedBalance != null) parts.push('balance ' + moneyText(D, r.reportedBalance));
    var s = parts.length ? 'The text shows ' + parts.join(', ') + '.' : 'The text had few details it could be sure of.';
    var miss = [];
    ['furnisher', 'accountRef', 'reportedBalance', 'openedDate', 'dofd'].forEach(function (key) {
      if (r.itemType === 'inquiry' && key !== 'furnisher') return;
      if (r[key] == null && !e.skipped.some(function (x) { return x.k === key; })) miss.push(SAYS[key]);
    });
    if (miss.length) s += ' Not found: ' + miss.join(', ') + '.';
    if (e.skipped.length) s += ' Left blank because the text gives different answers: ' + e.skipped.map(function (x) { return SAYS[x.k] + ' (' + x.vals.join(' or ') + ')'; }).join('; ') + '.';
    if (e.checks && e.checks.length) s += ' Check: ' + e.checks.map(function (k) { return SAYS[k]; }).join(', ') + ' (taken from a name in the creditor list, not from a label).';
    return s;
  }

  /* ---------- an inquiries list: one company and one date per line ---------- */
  function inquiryEntries(ctx) {
    var lines = ctx.lines, scanned = ctx.scanned, D = ctx.D, now = ctx.now, out = [];
    for (var i = 0; i < lines.length; i++) {
      if (scanned.secs[i] !== 'inquiries' || !lines[i] || headingOf(lines[i])) continue;
      if (lineHasLabel(lines[i]) || FOOTER.test(lines[i])) continue;
      var cells = lines[i].split(/ {2,}/), name = '', dt = '';
      cells.forEach(function (c) { var d = dateOf(c, now); if (d && !dt) dt = d; else if (!name) { var n = nameOf(c); if (n && !/^(?:hard|soft|inquiry|inquiries|date|type)\b/i.test(n)) name = n; } });
      if (name && dt) {
        var r = emptyR(), soft = /\bsoft\b/i.test(scanned.secTexts[i] || '');
        r.itemType = 'inquiry'; r.furnisher = tidyName(name); r.inquiryDate = dt;
        if (ctx.consumer) Object.keys(ctx.consumer).forEach(function (k) { if (ctx.consumer[k]) r.consumer[k] = ctx.consumer[k]; });
        if (ctx.docBureaus.length === 1) r.bureaus = ctx.docBureaus;
        var e = { r: r, found: ['itemType', 'furnisher', 'inquiryDate'], skipped: [], checks: [], via: 'line', from: i, to: i + 1, title: r.furnisher, sub: (soft ? 'Soft inquiry' : 'Inquiry') + ' \u00b7 ' + dt, negative: false, soft: soft };
        r.readBack = readBack(e, D);
        out.push(e);
      }
    }
    return out;
  }

  /* ---------- the front door ---------- */
  function read(text, D, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var lines = prep(text), scanned = scan(lines);
    var nonEmpty = lines.filter(function (l) { return l; }).length;
    var res = { entries: [], consumer: null, lines: nonEmpty, more: 0 };
    if (!nonEmpty) return res;
    var consumer = consumerOf(lines, scanned, D);
    res.consumer = consumer;
    var blocks = segment(lines, scanned), single = blocks.length === 1;
    var rd = [];
    scanned.pairs.forEach(function (p) { if (p.f === 'reportDate') p.vals.forEach(function (v) { var d = dateOf(v, now); if (d) rd.push(d); }); });
    rd = uniqueList(rd);
    var ctx = { lines: lines, scanned: scanned, D: D, now: now, consumer: consumer, single: single, docBureaus: bureausOf(lines.join('\n')), docReportDate: rd.length === 1 ? rd[0] : '' };
    var entries = [];
    blocks.slice(0, MAX_BLOCKS).forEach(function (b) {
      var e = entryOf(ctx, b.from, b.to);
      var real = ORDER.some(function (key) { return key !== 'furnisher' && key !== 'originalCreditor' && key !== 'statusText' && e.r[key] != null; });
      if (real || e.r.itemType || (e.r.furnisher && (e.via === 'label' || e.via === 'letter'))) entries.push(e);
    });
    var inq = inquiryEntries(ctx);
    if (single && entries.length === 1 && inq.length && !entries[0].r.furnisher && !entries[0].r.accountRef) entries = [];
    entries = entries.concat(inq);
    if (blocks.length > MAX_BLOCKS) res.more = blocks.length - MAX_BLOCKS;
    var idx = entries.map(function (e, i) { return { e: e, i: i }; });
    idx.sort(function (a, b) { return (b.e.negative ? 1 : 0) - (a.e.negative ? 1 : 0) || a.i - b.i; });
    if (idx.length > MAX_ENTRIES) { res.more += idx.length - MAX_ENTRIES; idx = idx.slice(0, MAX_ENTRIES); }
    res.entries = idx.map(function (x, n) { x.e.id = 'e' + n; return x.e; });
    return res;
  }

  root.DD2Read = { read: read, version: 1, _dateOf: dateOf, _moneyOf: moneyOf, _acctOf: acctOf, _tidyName: tidyName, _prep: prep, _scan: scan };
})(typeof window !== 'undefined' ? window : globalThis);

