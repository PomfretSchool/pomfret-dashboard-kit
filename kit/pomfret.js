/* Pomfret dashboard kit — small, dependency-free helpers for one-file dashboards.
   Pattern every dashboard follows:
     async function loadData()  -> rows (array of arrays of strings, header first)
     function render(rows)      -> draws the page
     PD.start(CONFIG, loadData, render)   // = loadData().then(render) + theme, resize, file drop
*/
(function () {
  "use strict";
  const PD = (window.PD = {});
  PD.ui = {};            // UI state that survives re-renders (toggles, selections)
  PD.geo = {};           // cached map outlines

  // ------------------------------------------------------------------ data
  PD.parseCSV = function (text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
  };
  // rows (arrays) -> objects keyed by the header row
  PD.objects = function (rows) {
    const h = rows[0].map((s) => String(s).trim());
    return rows.slice(1).map((r) => {
      const o = {};
      h.forEach((k, i) => (o[k] = r[i] == null ? "" : String(r[i]).trim()));
      return o;
    });
  };
  // "$1,250.00" "(300)" "45%" "1250" -> number (45% -> 45)
  PD.num = function (v) {
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/[$,%\s()\-]/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? NaN : neg ? -n : n;
  };
  PD.n0 = (v) => { const n = PD.num(v); return isNaN(n) ? 0 : n; };
  // ISO "2026-11-16", "2026-11-16 14:05", "2023-07", "11/16/2026", "11/16/2026 2:05:00 PM"
  PD.date = function (v) {
    const s = String(v || "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    m = s.match(/^(\d{4})-(\d{1,2})$/);
    if (m) return new Date(+m[1], m[2] - 1, 1);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      let h = +(m[4] || 0);
      if (m[6]) { if (/pm/i.test(m[6]) && h < 12) h += 12; if (/am/i.test(m[6]) && h === 12) h = 0; }
      return new Date(y, m[1] - 1, +m[2], h, +(m[5] || 0));
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };
  PD.day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  PD.addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  PD.days = (a, b) => Math.round((PD.day(b) - PD.day(a)) / 864e5);
  PD.iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  PD.weekStart = (d) => PD.addDays(PD.day(d), -((d.getDay() + 6) % 7)); // Monday
  PD.asOf = (cfg) => (cfg && cfg.asOf ? PD.date(cfg.asOf) : PD.day(new Date()));

  PD.group = function (arr, key) {
    const m = new Map();
    for (const x of arr) { const k = typeof key === "function" ? key(x) : x[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  };
  PD.sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  PD.uniq = (arr) => [...new Set(arr)];
  PD.median = function (a) {
    const s = a.filter((x) => !isNaN(x)).sort((x, y) => x - y);
    if (!s.length) return NaN;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  PD.esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ------------------------------------------------------------------ formatting
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  PD.fmt = {
    int: (n) => (isNaN(n) ? "–" : Math.round(n).toLocaleString("en-US")),
    dec: (n, d = 1) => (isNaN(n) ? "–" : n.toFixed(d)),
    pct: (n, d = 0) => (isNaN(n) || !isFinite(n) ? "–" : (n * 100).toFixed(d) + "%"),
    pts: (n, d = 1) => (isNaN(n) ? "–" : (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(d) + " pts"),
    signed: (n, d = 0) => (isNaN(n) ? "–" : (n >= 0 ? "+" : "−") + Math.abs(n * 100).toFixed(d) + "%"),
    money: function (n) {
      if (isNaN(n)) return "–";
      const a = Math.abs(n), s = n < 0 ? "−$" : "$";
      if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
      if (a >= 1e4) return s + Math.round(a / 1e3) + "k";
      if (a >= 1e3) return s + (a / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
      return s + Math.round(a);
    },
    dollars: (n) => (isNaN(n) ? "–" : (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US")),
    date: (d) => (d ? `${MON[d.getMonth()]} ${d.getDate()}` : "–"),
    dateY: (d) => (d ? `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : "–"),
    month: (d) => MON[d.getMonth()],
    monthY: (d) => `${MON[d.getMonth()]} ’${String(d.getFullYear()).slice(2)}`,
  };

  // privacy: names hidden unless the viewer turns them on (internal use)
  PD.ui.showNames = false;
  PD.initials = (name) => String(name || "").split(/\s+/).filter(Boolean).map((p) => p[0].toUpperCase() + ".").join("");
  PD.who = (name, id) => (PD.ui.showNames ? name : PD.initials(name) + (id ? ` <small class="muted">${PD.esc(id)}</small>` : ""));
  PD.whoText = (name, id) => (PD.ui.showNames ? name : PD.initials(name) + (id ? " " + id : ""));

  // ------------------------------------------------------------------ DOM + layout
  PD.el = function (tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (k === "class") e.className = attrs[k]; else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  };
  PD.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  PD.page = function (cfg) {
    const app = document.getElementById("app");
    app.innerHTML = "";
    app.appendChild(PD.el("div", { class: "pd-bar" }));
    const wrap = app.appendChild(PD.el("div", { class: "pd-wrap" }));
    const head = wrap.appendChild(PD.el("header", { class: "pd-head" }));
    head.appendChild(PD.el("div", null,
      `<div class="pd-kicker">${PD.esc(cfg.kicker || "Pomfret School")}</div><h1 class="pd-title">${PD.esc(cfg.title)}</h1>` +
      (cfg.subtitle ? `<p class="pd-sub">${cfg.subtitle}</p>` : "")));
    const tools = head.appendChild(PD.el("div", { class: "pd-tools" }));
    const asOf = PD.asOf(cfg);
    tools.appendChild(PD.el("span", { class: "pd-meta" }, "As of " + PD.fmt.dateY(asOf)));
    if (cfg.hasNames) {
      tools.appendChild(PD.el("button", { class: "pd-btn", "aria-pressed": PD.ui.showNames, title: "Names are hidden by default. Show them only on a screen no one else can see.",
        onclick: () => { PD.ui.showNames = !PD.ui.showNames; PD.rerender(); } }, PD.ui.showNames ? "Hide names" : "Show names"));
    }
    if (cfg.fileLoad !== false)   // the Apps Script build sets fileLoad: false (data comes from the Sheet)
      tools.appendChild(PD.el("button", { class: "pd-btn", title: "Load a CSV or XLSX with the same columns (or drag one onto the page)", onclick: PD.pickFile }, "Load your file"));
    tools.appendChild(PD.el("button", { class: "pd-btn", onclick: PD.toggleTheme, title: "Light / dark" }, "◐"));
    const kpis = wrap.appendChild(PD.el("section", { class: "pd-kpis" }));
    const grid = wrap.appendChild(PD.el("main", { class: "pd-grid" }));
    const foot = wrap.appendChild(PD.el("footer", { class: "pd-foot" }));
    foot.innerHTML =
      `<span>Source: <b>${PD.esc(PD.sourceName || cfg.source || "embedded data")}</b> · ${PD.fmt.int((PD.rows || [1]).length - 1)} rows</span>` +
      (cfg.footnote ? `<span>${cfg.footnote}</span>` : "") +
      (cfg.hasNames ? `<span>Names hidden by default (initials + ID). Share summaries, not rows.</span>` : "") +
      `<span>Pomfret dashboard kit</span>`;
    document.title = (cfg.title || "Dashboard") + " · Pomfret";
    return { wrap, kpis, grid, foot };
  };

  PD.kpis = function (el, items) {
    el.innerHTML = items.map((k) => {
      const cls = k.delta == null ? "" : (k.delta >= 0 ? (k.goodWhenUp === false ? "up-bad" : "up-good") : (k.goodWhenUp === false ? "down-good" : "down-bad"));
      return `<div class="pd-kpi${k.hot ? " hot" : ""}"${k.tip ? ` data-tip="${PD.esc(k.tip)}"` : ""}><div class="v">${k.value}</div><div class="l">${PD.esc(k.label)}</div>` +
        (k.detail || k.deltaText ? `<div class="d">${k.deltaText ? `<b class="${cls}">${k.deltaText}</b> ` : ""}${k.detail || ""}</div>` : "") +
        (k.spark ? PD.spark(k.spark, { w: 150, h: 24 }) : "") + "</div>";
    }).join("");
  };

  PD.section = (grid, html) => grid.appendChild(PD.el("div", { class: "pd-section" }, html));

  // card: PD.card(grid, {title, note, span, flag}, body => { ...draw... })
  PD.card = function (grid, o, draw) {
    const c = grid.appendChild(PD.el("section", { class: "pd-card" + (o.span ? " s" + o.span : "") + (o.flag ? " flag" : "") }));
    if (o.id) c.id = o.id;
    c.appendChild(PD.el("h3", null, o.title));
    if (o.note) c.appendChild(PD.el("p", { class: "pd-note" }, o.note));
    const ctl = c.appendChild(PD.el("div", { class: "pd-ctl" }));
    const body = c.appendChild(PD.el("div", { class: "pd-body" }));
    body.ctl = ctl;
    if (draw) PD.safe(body, () => draw(body, ctl));
    if (!ctl.children.length) ctl.remove();
    return body;
  };
  PD.safe = function (el, fn) {
    try { fn(); } catch (e) { console.error(e); el.innerHTML = `<div class="pd-err">Chart error: ${PD.esc(e.message)}</div>`; }
  };

  // segmented control bound to PD.ui[key]
  PD.seg = function (parent, key, options, dflt, onChange) {
    if (PD.ui[key] == null) PD.ui[key] = dflt;
    const s = parent.appendChild(PD.el("div", { class: "pd-seg" }));
    options.forEach((o) => {
      const v = typeof o === "object" ? o.value : o, label = typeof o === "object" ? o.label : o;
      s.appendChild(PD.el("button", { "aria-pressed": PD.ui[key] === v, onclick: () => { PD.ui[key] = v; onChange ? onChange(v) : PD.rerender(); } }, label));
    });
    return s;
  };
  PD.legend = (items) => `<div class="pd-legend">${items.map((i) => `<span><i style="background:${i.color}${i.dash ? ";height:2px;vertical-align:3px" : ""}"></i>${PD.esc(i.label)}</span>`).join("")}</div>`;

  // ------------------------------------------------------------------ tooltip
  let tip;
  PD.tipShow = function (text, x, y) {
    if (!tip) return;
    tip.textContent = text; tip.style.opacity = 1;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + "px";
    tip.style.top = (y + h + 20 > window.innerHeight ? y - h - 12 : y + 14) + "px";
  };
  PD.tipHide = () => tip && (tip.style.opacity = 0);
  function initTip() {
    tip = document.body.appendChild(PD.el("div", { id: "pd-tip" }));
    document.addEventListener("mousemove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (t) PD.tipShow(t.getAttribute("data-tip"), e.clientX, e.clientY);
      else if (!PD._tipOwner) PD.tipHide();
    });
  }

  // ------------------------------------------------------------------ scales
  PD.scale = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));
  PD.ticks = function (min, max, count = 4) {
    const span = max - min || 1, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  };
  PD.niceMax = (max) => { if (max <= 0) return 1; const t = PD.ticks(0, max, 4); return t[t.length - 1] < max ? t[t.length - 1] + (t[1] - t[0]) : t[t.length - 1]; };
  const textW = (s, px = 13) => String(s).length * px * 0.52;

  // ------------------------------------------------------------------ sparkline
  PD.spark = function (vals, o = {}) {
    const w = o.w || 90, h = o.h || 22, v = vals.map((x) => (isNaN(x) ? 0 : x));
    if (!v.length) return "";
    const mn = o.min != null ? o.min : Math.min(...v), mx = Math.max(...v, mn + 1e-9);
    const x = PD.scale(0, Math.max(1, v.length - 1), 2, w - 4), y = PD.scale(mn, mx, h - 3, 3);
    const d = v.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p).toFixed(1)).join("");
    const last = v.length - 1;
    return `<svg class="pd-svg" width="${w}" height="${h}" style="width:${w}px"><path d="${d}" fill="none" stroke="${o.color || "var(--context)"}" stroke-width="1.3"/>` +
      `<circle cx="${x(last)}" cy="${y(v[last])}" r="2.6" fill="var(--red)"/></svg>`;
  };

  // ------------------------------------------------------------------ line chart
  // series: [{name, points:[[x,y],...], color, width, dash, label}] ; x may be Date or number
  PD.line = function (el, o) {
    const W = Math.max(260, el.clientWidth || 600), H = o.height || 220;
    const all = o.series.flatMap((s) => s.points);
    const X = (p) => (p[0] instanceof Date ? +p[0] : p[0]);
    let xmin = o.xMin != null ? +o.xMin : Math.min(...all.map(X)), xmax = o.xMax != null ? +o.xMax : Math.max(...all.map(X));
    let ymin = o.yMin != null ? o.yMin : Math.min(0, ...all.map((p) => p[1]));
    let ymax = o.yMax != null ? o.yMax : PD.niceMax(Math.max(...all.map((p) => p[1])));
    const labels = o.series.filter((s) => s.label !== false && s.points.length);
    const right = o.noEndLabels ? 10 : Math.min(170, 14 + Math.max(0, ...labels.map((s) => textW(s.labelText || s.name))));
    const m = { t: 10, r: right, b: 24, l: o.yAxisWidth || 46 };
    const x = PD.scale(xmin, xmax, m.l, W - m.r), y = PD.scale(ymin, ymax, H - m.b, m.t);
    const yf = o.yFmt || PD.fmt.int;
    let s = `<svg class="pd-svg" viewBox="0 0 ${W} ${H}">`;
    for (const t of PD.ticks(ymin, ymax, o.yTicks || 4)) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="${t === 0 ? 1 : 0.6}"/>`;
      s += `<text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${yf(t)}</text>`;
    }
    const xt = o.xTicks || (o.xType === "date" || all[0] && all[0][0] instanceof Date
      ? monthTicks(new Date(xmin), new Date(xmax), W) : PD.ticks(xmin, xmax, 6).map((v) => ({ v, label: (o.xFmt || String)(v) })));
    for (const t of xt) {
      const xv = x(+t.v);
      if (xv < m.l - 1 || xv > W - m.r + 1) continue;
      s += `<line x1="${xv}" x2="${xv}" y1="${H - m.b}" y2="${H - m.b + 4}" stroke="var(--silver)"/>`;
      s += `<text x="${xv}" y="${H - 6}" text-anchor="middle">${t.label}</text>`;
    }
    for (const mk of o.markers || []) {
      const xv = x(+mk.x);
      s += `<line x1="${xv}" x2="${xv}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink)" stroke-dasharray="2,3" stroke-width="1"/>`;
      s += `<text x="${xv + 4}" y="${m.t + 10}" class="lbl-strong">${PD.esc(mk.label)}</text>`;
    }
    for (const b of o.bands || []) {
      s += `<rect x="${x(+b.from)}" y="${m.t}" width="${Math.max(0, x(+b.to) - x(+b.from))}" height="${H - m.b - m.t}" fill="var(--track)" opacity=".7"/>`;
      if (b.label) s += `<text x="${x(+b.from) + 3}" y="${H - m.b - 4}">${PD.esc(b.label)}</text>`;
    }
    const ends = [];
    o.series.forEach((sr) => {
      if (!sr.points.length) return;
      const pts = sr.points.slice().sort((a, b) => X(a) - X(b));
      const d = pts.map((p, i) => (i ? "L" : "M") + x(X(p)).toFixed(1) + "," + y(p[1]).toFixed(1)).join("");
      if (sr.area) s += `<path d="${d}L${x(X(pts[pts.length - 1]))},${y(ymin)}L${x(X(pts[0]))},${y(ymin)}Z" fill="${sr.color}" opacity=".12"/>`;
      s += `<path d="${d}" fill="none" stroke="${sr.color || "var(--context)"}" stroke-width="${sr.width || 1.5}" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ""} stroke-linejoin="round"/>`;
      if (sr.dots) pts.forEach((p) => (s += `<circle cx="${x(X(p))}" cy="${y(p[1])}" r="2.4" fill="${sr.color}"/>`));
      const lp = pts[pts.length - 1];
      if (sr.label !== false && !o.noEndLabels) ends.push({ y: y(lp[1]), x: x(X(lp)), text: sr.labelText || sr.name, color: sr.labelColor || sr.color, strong: sr.strong });
      if (sr.endDot !== false) s += `<circle cx="${x(X(lp))}" cy="${y(lp[1])}" r="3" fill="${sr.color}"/>`;
    });
    // series that stop early (e.g. "this year so far") get their label above the last point
    const early = ends.filter((e) => e.x < W - m.r - 30), atEnd = ends.filter((e) => e.x >= W - m.r - 30);
    atEnd.sort((a, b) => a.y - b.y);
    for (let i = 1; i < atEnd.length; i++) if (atEnd[i].y - atEnd[i - 1].y < 14) atEnd[i].y = atEnd[i - 1].y + 14;
    for (const e of atEnd) s += `<text x="${e.x + 7}" y="${e.y + 4}" style="fill:${e.color};${e.strong ? "font-weight:600" : ""}">${PD.esc(e.text)}</text>`;
    for (const e of early) s += `<text x="${e.x - 6}" y="${e.y - 9}" text-anchor="end" style="fill:${e.color};paint-order:stroke;stroke:var(--panel);stroke-width:4px;${e.strong ? "font-weight:600" : ""}">${PD.esc(e.text)}</text>`;
    s += `<rect class="hover" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/><line class="guide" y1="${m.t}" y2="${H - m.b}" stroke="var(--silver)" opacity="0"/></svg>`;
    el.innerHTML = s;
    // hover readout: nearest point of every series
    const svg = el.querySelector("svg"), guide = svg.querySelector(".guide"), hov = svg.querySelector(".hover");
    const xfmt = o.tipX || ((v) => (all[0][0] instanceof Date ? PD.fmt.dateY(new Date(v)) : String(v)));
    hov.addEventListener("mousemove", (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      const xv = xmin + ((px - m.l) / (W - m.l - m.r)) * (xmax - xmin);
      let best = null;
      const lines = o.series.filter((sr) => sr.points.length && sr.tip !== false).map((sr) => {
        let p = sr.points[0];
        for (const q of sr.points) if (Math.abs(X(q) - xv) < Math.abs(X(p) - xv)) p = q;
        if (!best) best = p;
        return `${sr.name}: ${yf(p[1])}`;
      });
      if (!best) return;
      guide.setAttribute("x1", x(X(best))); guide.setAttribute("x2", x(X(best))); guide.setAttribute("opacity", 1);
      PD._tipOwner = true;
      PD.tipShow(xfmt(X(best)) + "\n" + lines.join("\n"), ev.clientX, ev.clientY);
    });
    hov.addEventListener("mouseleave", () => { guide.setAttribute("opacity", 0); PD._tipOwner = false; PD.tipHide(); });
  };
  function monthTicks(a, b, W) {
    const out = [], span = (b - a) / (30 * 864e5), every = span > 30 ? 6 : span > 14 ? 3 : span > 7 ? 2 : 1;
    let d = new Date(a.getFullYear(), a.getMonth() + (a.getDate() > 1 ? 1 : 0), 1);
    while (d <= b) {
      if (d.getMonth() % every === 0 || every === 1) out.push({ v: d, label: d.getMonth() === 0 || out.length === 0 ? PD.fmt.monthY(d) : PD.fmt.month(d) });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
    if (W < 420 && out.length > 6) return out.filter((_, i) => i % 2 === 0);
    return out;
  }

  // ------------------------------------------------------------------ horizontal bars
  // items: [{label, sub, value, ref, valueText, hot, tip, onClick}]
  PD.bars = function (el, o) {
    const items = o.items, max = o.max || Math.max(1e-9, ...items.map((i) => Math.max(i.value || 0, i.ref || 0)));
    const f = o.fmt || PD.fmt.int;
    el.innerHTML = "";
    const box = el.appendChild(PD.el("div", { class: "pd-bars" }));
    if (!items.length) { box.innerHTML = `<div class="pd-empty">${o.empty || "Nothing to show."}</div>`; return; }
    items.forEach((it) => {
      const r = box.appendChild(PD.el("div", { class: "pd-brow" + (it.hot ? " hot" : "") + (it.onClick ? " click" : "") }));
      if (it.tip) r.setAttribute("data-tip", it.tip);
      if (it.onClick) r.addEventListener("click", it.onClick);
      r.innerHTML = `<span class="n" title="${PD.esc(it.label)}">${it.labelHtml || PD.esc(it.label)}${it.sub ? ` <small>${PD.esc(it.sub)}</small>` : ""}</span>` +
        `<span class="t"><span class="f" style="width:${(Math.max(0, it.value) / max) * 100}%"></span>${it.ref != null ? `<span class="f2" style="left:${Math.min(100, (it.ref / max) * 100)}%"></span>` : ""}</span>` +
        `<span class="v">${it.valueText != null ? it.valueText : f(it.value)}</span>`;
    });
  };

  // ------------------------------------------------------------------ vertical columns (stacked, can go negative)
  // categories: [label], series: [{name, values:[], color}], markIndex: highlight
  PD.columns = function (el, o) {
    const W = Math.max(260, el.clientWidth || 600), H = o.height || 220, m = { t: 12, r: 8, b: 24, l: o.yAxisWidth || 46 };
    const n = o.categories.length;
    let top = 0, bot = 0;
    for (let i = 0; i < n; i++) {
      let p = 0, q = 0;
      o.series.forEach((s) => { const v = s.values[i] || 0; if (v >= 0) p += v; else q += v; });
      top = Math.max(top, p); bot = Math.min(bot, q);
    }
    if (o.yMax) top = o.yMax;
    const ymax = PD.niceMax(top), ymin = bot < 0 ? -PD.niceMax(-bot) : 0;
    const y = PD.scale(ymin, ymax, H - m.b, m.t), bw = (W - m.l - m.r) / n, gap = Math.min(10, bw * 0.28);
    const yf = o.yFmt || PD.fmt.int;
    let s = `<svg class="pd-svg" viewBox="0 0 ${W} ${H}">`;
    for (const t of PD.ticks(ymin, ymax, 4)) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width="${t === 0 ? 1.2 : 0.6}"${t === 0 ? ' style="stroke:var(--silver)"' : ""}/>`;
      s += `<text x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${yf(t)}</text>`;
    }
    const every = Math.ceil((n * 34) / (W - m.l));
    for (let i = 0; i < n; i++) {
      let p = 0, q = 0;
      const x0 = m.l + i * bw + gap / 2;
      o.series.forEach((sr) => {
        const v = sr.values[i] || 0;
        if (!v) return;
        const y0 = v >= 0 ? y(p + v) : y(q), h = Math.abs(y(v) - y(0));
        const col = typeof sr.color === "function" ? sr.color(i) : sr.color;
        s += `<rect x="${x0}" y="${y0}" width="${bw - gap}" height="${Math.max(0.5, h)}" fill="${col}" data-tip="${PD.esc(o.categories[i] + "\n" + sr.name + ": " + (o.tipFmt || yf)(v))}"/>`;
        if (v >= 0) p += v; else q += v;
      });
      if (o.valueLabels) {
        const tot = o.series.reduce((a, sr) => a + (sr.values[i] > 0 ? sr.values[i] : 0), 0);
        s += `<text x="${x0 + (bw - gap) / 2}" y="${y(tot) - 4}" text-anchor="middle" class="${o.markIndex === i ? "lbl-red" : ""}">${(o.labelFmt || yf)(tot)}</text>`;
        if (q < 0) s += `<text x="${x0 + (bw - gap) / 2}" y="${y(q) + 14}" text-anchor="middle" class="lbl-red">${(o.negLabelFmt || o.labelFmt || yf)(-q)}</text>`;
      }
      if (i % every === 0) s += `<text x="${x0 + (bw - gap) / 2}" y="${H - 6}" text-anchor="middle" class="${o.markIndex === i ? "lbl-strong" : ""}">${PD.esc(o.categories[i])}</text>`;
    }
    for (const ln of o.lines || []) {
      const d = ln.values.map((v, i) => (v == null ? null : [m.l + i * bw + bw / 2, y(v)])).filter(Boolean).map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join("");
      s += `<path d="${d}" fill="none" stroke="${ln.color}" stroke-width="${ln.width || 1.6}" ${ln.dash ? `stroke-dasharray="${ln.dash}"` : ""}/>`;
    }
    el.innerHTML = s + "</svg>";
  };

  // ------------------------------------------------------------------ heatmap
  // rows: [{key,label,sub}], cols: [label], values[r][c], max, onRow(key), selected
  PD.heat = function (el, o) {
    const max = o.max || Math.max(1e-9, ...o.values.flat().filter((v) => !isNaN(v)));
    const f = o.fmt || ((v) => (v ? PD.fmt.int(v) : ""));
    const lw = Math.min(o.labelWidth || 150, Math.max(90, (el.clientWidth || 600) * 0.3));
    const g = PD.el("div", { class: "pd-heat", style: `grid-template-columns:${lw}px repeat(${o.cols.length}, minmax(26px,1fr))${o.total ? " 56px" : ""};min-width:${lw + o.cols.length * 28 + (o.total ? 58 : 0)}px` });
    g.appendChild(PD.el("div"));
    o.cols.forEach((c) => g.appendChild(PD.el("div", { class: "cl" }, PD.esc(c))));
    if (o.total) g.appendChild(PD.el("div", { class: "cl" }, PD.esc(o.total.label)));
    o.rows.forEach((r, ri) => {
      const lab = g.appendChild(PD.el("div", { class: "rl" + (o.onRow ? " row-click" : "") + (o.selected === r.key ? " sel" : "") }, PD.esc(r.label) + (r.sub ? `<small>${PD.esc(r.sub)}</small>` : "")));
      if (o.onRow) lab.addEventListener("click", () => o.onRow(r.key));
      o.cols.forEach((c, ci) => {
        const v = o.values[ri][ci];
        const t = isNaN(v) || v == null ? 0 : Math.min(1, v / max);
        const cell = g.appendChild(PD.el("div", { class: "c", style: `background:color-mix(in srgb, var(--heat-1) ${Math.round(t * 100)}%, var(--heat-0));color:${t > 0.55 ? "#fff" : "var(--ink-2)"}` }, f(v)));
        cell.setAttribute("data-tip", `${r.label} · ${c}\n${o.tipFmt ? o.tipFmt(v, ri, ci) : f(v)}`);
        if (o.onRow) { cell.style.cursor = "pointer"; cell.addEventListener("click", () => o.onRow(r.key)); }
      });
      if (o.total) g.appendChild(PD.el("div", { class: "c", style: "justify-content:flex-end;font-weight:600" }, o.total.fmt(r, ri)));
    });
    el.innerHTML = "";
    el.appendChild(PD.el("div", { style: "overflow-x:auto" })).appendChild(g);
  };

  // ------------------------------------------------------------------ slope chart
  PD.slope = function (el, o) {
    const W = Math.max(260, el.clientWidth || 500), H = o.height || 260, f = o.fmt || PD.fmt.pct;
    const lw = Math.min(170, 12 + Math.max(...o.items.map((i) => textW(i.label + " " + f(i.b)))));
    const m = { t: 26, b: 12, l: Math.min(170, 12 + Math.max(...o.items.map((i) => textW(f(i.a) + " " + i.label)))), r: lw };
    const vals = o.items.flatMap((i) => [i.a, i.b]);
    const y = PD.scale(o.min != null ? o.min : Math.min(...vals), o.max != null ? o.max : Math.max(...vals), H - m.b, m.t);
    const x0 = m.l, x1 = W - m.r;
    let s = `<svg class="pd-svg" viewBox="0 0 ${W} ${H}">`;
    s += `<text x="${x0}" y="12" text-anchor="middle" class="lbl-strong">${PD.esc(o.leftLabel)}</text><text x="${x1}" y="12" text-anchor="middle" class="lbl-strong">${PD.esc(o.rightLabel)}</text>`;
    s += `<line x1="${x0}" x2="${x0}" y1="${m.t - 6}" y2="${H - m.b}" stroke="var(--line)"/><line x1="${x1}" x2="${x1}" y1="${m.t - 6}" y2="${H - m.b}" stroke="var(--line)"/>`;
    const L = o.items.map((i) => ({ ...i, ya: y(i.a), yb: y(i.b) }));
    const spread = (key, out) => { const a = L.slice().sort((p, q) => p[key] - q[key]); for (let i = 1; i < a.length; i++) if (a[i][key] - a[i - 1][key] < 14) a[i][key] = a[i - 1][key] + 14; a.forEach((p) => (p[out] = p[key])); };
    L.forEach((p) => { p.la = p.ya; p.lb = p.yb; });
    spread("la", "la"); spread("lb", "lb");
    L.forEach((p) => {
      const col = p.hot ? "var(--red)" : p.color || "var(--context)", cls = p.hot ? "lbl-red" : "";
      s += `<line x1="${x0}" y1="${p.ya}" x2="${x1}" y2="${p.yb}" stroke="${col}" stroke-width="${p.hot ? 2.2 : 1.4}" data-tip="${PD.esc(p.label + "\n" + o.leftLabel + ": " + f(p.a) + "\n" + o.rightLabel + ": " + f(p.b))}"/>`;
      s += `<circle cx="${x0}" cy="${p.ya}" r="3" fill="${col}"/><circle cx="${x1}" cy="${p.yb}" r="3" fill="${col}"/>`;
      s += `<text x="${x0 - 7}" y="${p.la + 4}" text-anchor="end" class="${cls}">${PD.esc(p.label)} ${f(p.a)}</text>`;
      s += `<text x="${x1 + 7}" y="${p.lb + 4}" class="${cls}">${f(p.b)} ${PD.esc(p.label)}</text>`;
    });
    el.innerHTML = s + "</svg>";
  };

  // ------------------------------------------------------------------ sankey
  // nodes: [{id,label,col,color}], links: [{source,target,value,color}]
  PD.sankey = function (el, o) {
    const W = Math.max(320, el.clientWidth || 700), H = o.height || 380, f = o.fmt || PD.fmt.money, nw = 12, gapY = o.gap || 10;
    const N = new Map(o.nodes.map((n, i) => [n.id, { ...n, i, ins: [], outs: [] }]));
    o.links.forEach((l) => { l.s = N.get(l.source); l.t = N.get(l.target); l.s.outs.push(l); l.t.ins.push(l); });
    N.forEach((n) => (n.value = Math.max(PD.sum(n.ins, (l) => l.value), PD.sum(n.outs, (l) => l.value))));
    const cols = Math.max(...o.nodes.map((n) => n.col)) + 1;
    const byCol = [...Array(cols)].map((_, c) => [...N.values()].filter((n) => n.col === c));
    const lab = (n) => `${n.label}  ${f(n.value)}`;
    const leftW = Math.min(220, 10 + Math.max(...byCol[0].map((n) => textW(lab(n), 13))));
    const rightW = Math.min(240, 10 + Math.max(...byCol[cols - 1].map((n) => textW(lab(n), 13))));
    const x = (c) => leftW + (c * (W - leftW - rightW - nw)) / (cols - 1);
    const ky = Math.min(...byCol.map((ns) => (H - gapY * (ns.length - 1)) / Math.max(1e-9, PD.sum(ns, (n) => n.value))));
    byCol.forEach((ns, c) => {
      const total = PD.sum(ns, (n) => n.value) * ky + gapY * (ns.length - 1);
      let yy = (H - total) / 2;
      ns.forEach((n) => { n.x = x(c); n.y = yy; n.h = Math.max(1, n.value * ky); yy += n.h + gapY; });
    });
    N.forEach((n) => {
      let so = n.y; n.outs.sort((a, b) => a.t.y - b.t.y).forEach((l) => { l.sy = so; so += l.value * ky; });
      let ti = n.y; n.ins.sort((a, b) => a.s.y - b.s.y).forEach((l) => { l.ty = ti; ti += l.value * ky; });
    });
    let s = `<svg class="pd-svg" viewBox="0 0 ${W} ${H}">`;
    o.links.forEach((l) => {
      const x0 = l.s.x + nw, x1 = l.t.x, xm = (x0 + x1) / 2, h = l.value * ky;
      s += `<path d="M${x0},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${x1},${l.ty}L${x1},${l.ty + h}C${xm},${l.ty + h} ${xm},${l.sy + h} ${x0},${l.sy + h}Z" fill="${l.color || "var(--context)"}" opacity="${l.opacity || 0.35}" data-tip="${PD.esc(l.s.label + " → " + l.t.label + "\n" + f(l.value))}"/>`;
    });
    N.forEach((n) => {
      s += `<rect x="${n.x}" y="${n.y}" width="${nw}" height="${n.h}" fill="${n.color || "var(--ink)"}" data-tip="${PD.esc(n.label + "\n" + f(n.value))}"/>`;
      const left = n.col === 0, right = n.col === cols - 1, cy = n.y + n.h / 2 + 4;
      if (n.h < 9 && !left && !right) return;
      const tx = left ? n.x - 6 : n.x + nw + 6, anchor = left ? "end" : "start";
      s += `<text x="${tx}" y="${cy}" text-anchor="${anchor}"><tspan class="lbl-strong">${PD.esc(n.label)}</tspan> ${f(n.value)}</text>`;
    });
    el.innerHTML = s + "</svg>";
  };

  // ------------------------------------------------------------------ table (click headers to sort)
  // columns: [{key,label,html:(row)=>, sort:(row)=>, r:true}], rows, max, hot:(row)=>bool
  PD.table = function (el, o) {
    const st = (PD.ui["tbl:" + (o.id || "")] = PD.ui["tbl:" + (o.id || "")] || { k: o.sortKey, dir: o.sortDir || -1 });
    const draw = () => {
      let rows = o.rows.slice();
      const col = o.columns.find((c) => c.key === st.k);
      if (col) {
        const g = col.sort || ((r) => r[col.key]);
        rows.sort((a, b) => { const p = g(a), q = g(b); return (p > q ? 1 : p < q ? -1 : 0) * st.dir; });
      }
      const total = rows.length;
      if (o.max) rows = rows.slice(0, o.max);
      el.innerHTML = `<div class="${o.scroll === false ? "" : "pd-scroll"}"><table class="pd-table"><thead><tr>${o.columns.map((c) => `<th class="${c.r ? "r" : ""}" data-k="${c.key}">${PD.esc(c.label)}${st.k === c.key ? (st.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>` +
        rows.map((r) => `<tr class="${o.hot && o.hot(r) ? "hot" : ""}">${o.columns.map((c) => `<td class="${c.r ? "r" : ""}">${c.html ? c.html(r) : PD.esc(r[c.key])}</td>`).join("")}</tr>`).join("") +
        `</tbody></table></div>` + (o.max && total > o.max ? `<div class="pd-note" style="margin-top:6px">Showing ${o.max} of ${total}.</div>` : "") +
        (!total ? `<div class="pd-empty">${o.empty || "Nothing here."}</div>` : "");
      el.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
        const k = th.dataset.k; st.dir = st.k === k ? -st.dir : -1; st.k = k; draw();
      }));
    };
    draw();
  };

  // ------------------------------------------------------------------ maps
  const GEO_URL = {
    us: "https:\/\/cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json",
    world: "https:\/\/cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
  };
  // Outlines: fetch the TopoJSON from jsDelivr; where fetch is blocked (e.g. a claude.ai artifact),
  // fall back to the Datamaps script on cdnjs, which carries US + world TopoJSON inside it.
  const DATAMAPS = "https:\/\/cdnjs.cloudflare.com/ajax/libs/datamaps/0.5.9/datamaps.all.min.js";
  let dm;
  const fromDatamaps = (name) => {
    dm = dm || loadScript(DATAMAPS, () => window.Datamap).catch(() => null);
    return dm.then(() => {
      const t = window.Datamap && window.Datamap.prototype[name === "us" ? "usaTopo" : "worldTopo"];
      return t && typeof t === "object" ? t : null;
    });
  };
  PD.loadGeo = function (name) {
    if (PD.geo[name] !== undefined) return Promise.resolve(PD.geo[name]);
    if (!PD.geo["_" + name]) {
      PD.geo["_" + name] = fetch(GEO_URL[name]).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((t) => t || fromDatamaps(name))
        .then((t) => { try { PD.geo[name] = t ? PD.topo(t, Object.keys(t.objects)[0]) : null; } catch (e) { PD.geo[name] = null; } return PD.geo[name]; });
    }
    return PD.geo["_" + name];
  };
  // TopoJSON -> [{id, name, rings:[[ [lon,lat], ...], ...]}]
  PD.topo = function (topo, objName) {
    const tf = topo.transform, arcs = topo.arcs.map((arc) => {
      let x = 0, y = 0;
      return arc.map((p) => { if (tf) { x += p[0]; y += p[1]; return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]]; } return p; });
    });
    const ring = (ids) => {
      const out = [];
      ids.forEach((i, k) => { const a = i >= 0 ? arcs[i] : arcs[~i].slice().reverse(); (k ? a.slice(1) : a).forEach((p) => out.push(p)); });
      return out;
    };
    return topo.objects[objName].geometries.filter((g) => g.arcs).map((g) => ({
      id: g.id, name: g.properties && g.properties.name,
      rings: g.type === "Polygon" ? g.arcs.map(ring) : g.arcs.flatMap((poly) => poly.map(ring)),
    }));
  };
  // Albers USA (same math as d3.geoAlbersUsa) — lower 48 plus Alaska / Hawaii insets
  const R = Math.PI / 180;
  function conic(phi0, phi1, rot, center, k, tx, ty) {
    const sy0 = Math.sin(phi0 * R), n = (sy0 + Math.sin(phi1 * R)) / 2, c = 1 + sy0 * (2 * n - sy0), r0 = Math.sqrt(c) / n;
    const raw = (l, p) => { const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(p))) / n; return [r * Math.sin(l * n), r0 - r * Math.cos(l * n)]; };
    const cc = raw(center[0] * R, center[1] * R);
    return (lon, lat) => {
      let l = (lon + rot) * R; l = Math.atan2(Math.sin(l), Math.cos(l));
      const p = raw(l, lat * R);
      return [tx + k * (p[0] - cc[0]), ty - k * (p[1] - cc[1])];
    };
  }
  PD.albersUsa = function (k = 1300, x = 487.5, y = 305) {
    const lower = conic(29.5, 45.5, 96, [-0.6, 38.7], k, x, y);
    const ak = conic(55, 65, 154, [-2, 58.5], 0.35 * k, x - 0.307 * k, y + 0.201 * k);
    const hi = conic(8, 18, 157, [-3, 19.9], k, x - 0.205 * k, y + 0.212 * k);
    return (lon, lat, where) => (where === "AK" || where === "02" ? ak : where === "HI" || where === "15" ? hi : lower)(lon, lat);
  };

  // points: [{lat, lon, value, label, state}]
  PD.usMap = function (el, o) {
    const W = 975, H = 610, proj = PD.albersUsa();
    const geo = PD.geo.us;
    if (geo === undefined) PD.loadGeo("us").then(() => PD.rerender());
    let s = `<svg class="pd-svg" viewBox="0 0 ${W} ${H}" style="max-height:${o.height || 520}px">`;
    if (geo) {
      if (!PD.geo.usPath) PD.geo.usPath = geo.filter((f) => f.id !== "-99").map((f) => ({ id: f.id, name: f.name, d: f.rings.map((r) => "M" + r.map((p) => proj(p[0], p[1], f.id).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("") }));
      const sv = o.stateValues || {}, smax = Math.max(1, ...Object.values(sv));
      for (const p of PD.geo.usPath) {
        const v = sv[p.name] || 0, t = v / smax;
        s += `<path d="${p.d}" fill="${v ? `color-mix(in srgb, var(--context-2) ${Math.round(40 + t * 60)}%, var(--panel))` : "var(--panel)"}" stroke="var(--silver)" stroke-width=".7" data-tip="${PD.esc(p.name + (o.stateTip ? "\n" + o.stateTip(p.name, v) : ""))}"/>`;
      }
    } else {
      s += `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" style="font-size:16px">${geo === null ? "State outlines need an internet connection — showing pins only." : "Loading state outlines…"}</text>`;
    }
    s += pins(o.points.map((p) => ({ ...p, xy: proj(p.lon, p.lat, p.state) })), o, 26);
    el.innerHTML = s + "</svg>";
  };
  function pins(pts, o, rmax) {
    const max = Math.max(1, ...pts.map((p) => p.value));
    return pts.slice().sort((a, b) => b.value - a.value).map((p) => {
      const r = Math.max(2.5, Math.sqrt(p.value / max) * (o.maxR || rmax));
      return `<circle cx="${p.xy[0].toFixed(1)}" cy="${p.xy[1].toFixed(1)}" r="${r.toFixed(1)}" fill="var(--red)" fill-opacity=".55" stroke="var(--red)" stroke-width="1" data-tip="${PD.esc(p.label)}"/>`;
    }).join("");
  }

  // draggable globe on canvas. points: [{lat, lon, value, label}]
  PD.globe = function (el, o) {
    const geo = PD.geo.world;
    if (geo === undefined) PD.loadGeo("world").then(() => PD.rerender());
    const W = Math.max(260, el.clientWidth || 500), H = o.height || Math.min(460, W);
    const dpr = window.devicePixelRatio || 1;
    el.innerHTML = "";
    const cv = el.appendChild(PD.el("canvas", { class: "pd-canvas", width: W * dpr, height: H * dpr, style: `height:${H}px` }));
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    const rot = (PD.ui.globeRot = PD.ui.globeRot || o.start || [-45, 28]);
    const r = Math.min(W, H) / 2 - 8, cx = W / 2, cy = H / 2;
    const max = Math.max(1, ...o.points.map((p) => p.value));
    const col = { land: PD.css("--context-2"), sea: PD.css("--bg"), edge: PD.css("--panel"), grid: PD.css("--line"), red: PD.css("--red"), ink: PD.css("--muted"), rim: PD.css("--silver") };
    function proj(lon, lat) {
      const l = (lon - rot[0]) * R, p = lat * R, p0 = rot[1] * R;
      const cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l);
      const x = Math.cos(p) * Math.sin(l), y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l);
      return [x, y, cosc >= 0];
    }
    function ringPath(ring) {
      let prev = null, started = false;
      for (const pt of ring) {
        let [x, y, vis] = proj(pt[0], pt[1]);
        if (!vis) { const h = Math.hypot(x, y) || 1; x /= h; y /= h; }
        if (prev && !vis && !prev[2]) {
          // walk along the rim between two hidden points so shapes hug the horizon
          let a0 = Math.atan2(prev[1], prev[0]), a1 = Math.atan2(y, x), da = a1 - a0;
          if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          const steps = Math.ceil(Math.abs(da) / 0.08);
          for (let i = 1; i < steps; i++) ctx.lineTo(cx + r * Math.cos(a0 + (da * i) / steps), cy - r * Math.sin(a0 + (da * i) / steps));
        }
        started ? ctx.lineTo(cx + r * x, cy - r * y) : ctx.moveTo(cx + r * x, cy - r * y);
        started = true; prev = [x, y, vis];
      }
      ctx.closePath();
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = col.sea; ctx.fill();
      ctx.strokeStyle = col.grid; ctx.lineWidth = 0.6;
      for (let lon = -180; lon < 180; lon += 30) { ctx.beginPath(); let on = false; for (let lat = -90; lat <= 90; lat += 3) { const [x, y, v] = proj(lon, lat); if (v) { on ? ctx.lineTo(cx + r * x, cy - r * y) : ctx.moveTo(cx + r * x, cy - r * y); on = true; } else on = false; } ctx.stroke(); }
      for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let on = false; for (let lon = -180; lon <= 180; lon += 3) { const [x, y, v] = proj(lon, lat); if (v) { on ? ctx.lineTo(cx + r * x, cy - r * y) : ctx.moveTo(cx + r * x, cy - r * y); on = true; } else on = false; } ctx.stroke(); }
      if (geo) {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.clip();
        ctx.fillStyle = col.land; ctx.strokeStyle = col.edge; ctx.lineWidth = 0.7;
        for (const f of geo) for (const ring of f.rings) {
          if (!ring.some((p) => proj(p[0], p[1])[2])) continue;
          ctx.beginPath(); ringPath(ring); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.strokeStyle = col.rim; ctx.lineWidth = 1; ctx.stroke();
      el._hits = [];
      o.points.slice().sort((a, b) => b.value - a.value).forEach((p) => {
        const [x, y, v] = proj(p.lon, p.lat);
        if (!v) return;
        const pr = Math.max(2.5, Math.sqrt(p.value / max) * (o.maxR || 18));
        ctx.beginPath(); ctx.arc(cx + r * x, cy - r * y, pr, 0, 2 * Math.PI);
        ctx.globalAlpha = 0.55; ctx.fillStyle = col.red; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = col.red; ctx.lineWidth = 1; ctx.stroke();
        el._hits.push({ x: cx + r * x, y: cy - r * y, r: pr, p });
      });
      if (geo === null) { ctx.fillStyle = col.ink; ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.fillText("Country outlines need an internet connection", cx, H - 4); }
    }
    draw();
    let drag = null;
    cv.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointerup", () => (drag = null));
    cv.addEventListener("pointermove", (e) => {
      if (drag) {
        rot[0] -= (e.clientX - drag[0]) * 0.35; rot[1] = Math.max(-75, Math.min(75, rot[1] + (e.clientY - drag[1]) * 0.35));
        drag = [e.clientX, e.clientY]; draw(); PD.tipHide(); return;
      }
      const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
      const hit = (el._hits || []).slice().reverse().find((h) => Math.hypot(h.x - mx, h.y - my) <= h.r + 2);
      PD._tipOwner = !!hit;
      hit ? PD.tipShow(hit.p.label, e.clientX, e.clientY) : PD.tipHide();
    });
    cv.addEventListener("pointerleave", () => { PD._tipOwner = false; PD.tipHide(); });
    el.spin = (lon, lat) => { rot[0] = lon; rot[1] = lat; draw(); };
    return el;
  };

  // ------------------------------------------------------------------ theme, file loading, lifecycle
  PD.toggleTheme = function () {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark";   // light is the default; dark only when chosen
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("pomfret-theme", root.dataset.theme); } catch (e) {}
    PD.rerender();
  };
  PD.pickFile = function () {
    const i = PD.el("input", { type: "file", accept: ".csv,.tsv,.txt,.xlsx,.xls" });
    i.addEventListener("change", () => i.files[0] && PD.readFile(i.files[0]));
    i.click();
  };
  PD.readFile = function (file) {
    const name = file.name;
    if (/\.xlsx?$/i.test(name)) {
      loadScript("https:\/\/cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js").then(() => file.arrayBuffer()).then((buf) => {
        const wb = XLSX.read(buf, { type: "array" });
        const want = PD.config && PD.config.sheet;
        const sheet = wb.Sheets[want && wb.Sheets[want] ? want : wb.SheetNames.find((n) => n !== "README") || wb.SheetNames[0]];
        PD.run(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }).map((r) => r.map(String)), name);
      }).catch((e) => PD.fail(new Error("Could not read that spreadsheet (" + e.message + "). Try File › Download › CSV.")));
    } else {
      file.text().then((t) => PD.run(/\.tsv$/i.test(name) ? t.split(/\r?\n/).filter(Boolean).map((l) => l.split("\t")) : PD.parseCSV(t), name));
    }
  };
  function loadScript(src, ready = () => window.XLSX) {
    return new Promise((ok, bad) => { if (ready()) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("offline?")); document.head.appendChild(s); });
  }
  PD.banner = function (msg) {
    let b = document.getElementById("pd-banner");
    if (!b) { b = PD.el("div", { id: "pd-banner", class: "pd-banner" }); document.body.prepend(b); }
    b.innerHTML = msg;
    b.onclick = () => b.remove();
  };
  PD.fail = function (e) { console.error(e); PD.banner("⚠ " + PD.esc(e && e.message ? e.message : e) + " <small>(click to dismiss)</small>"); };

  PD.run = function (rows, sourceName) {
    const need = (PD.config && PD.config.columns) || [];
    const have = (rows[0] || []).map((h) => String(h).trim());
    const missing = need.filter((c) => !have.includes(c));
    if (missing.length) {
      PD.fail(new Error(`That file is missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Rename the headers to match and try again.`));
      return;
    }
    PD.rows = rows;
    if (sourceName) PD.sourceName = sourceName;
    const b = document.getElementById("pd-banner"); if (b) b.remove();
    PD.rerender();
  };
  PD.rerender = function () {
    if (!PD.rows || !PD.renderFn) return;
    const y = window.scrollY;
    try { PD.renderFn(PD.rows); } catch (e) { PD.fail(e); }
    window.scrollTo(0, y);
  };
  PD.start = function (config, loadData, render) {
    PD.config = config; PD.renderFn = render;
    try { const t = localStorage.getItem("pomfret-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
    const go = () => {
      initTip();
      if (config.fileLoad !== false) {
        const drop = document.body.appendChild(PD.el("div", { id: "pd-drop" }, "Drop a CSV or XLSX to rebuild this dashboard"));
        let depth = 0;
        addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.style.display = "flex"; });
        addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; drop.style.display = "none"; } });
        addEventListener("dragover", (e) => e.preventDefault());
        addEventListener("drop", (e) => { e.preventDefault(); depth = 0; drop.style.display = "none"; const f = e.dataTransfer.files[0]; if (f) PD.readFile(f); });
      }
      let lastW = innerWidth, tmr;
      addEventListener("resize", () => { clearTimeout(tmr); tmr = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 30) { lastW = innerWidth; PD.rerender(); } }, 200); });
      window.addEventListener("error", (e) => PD.fail(e.error || e.message));
      // a parent page (the showcase deck) can switch the theme: postMessage({pomfretTheme: "dark"})
      window.addEventListener("message", (e) => { if (e.data && e.data.pomfretTheme) { document.documentElement.dataset.theme = e.data.pomfretTheme; PD.rerender(); } });
      if (/[?&]embed/.test(location.search)) document.documentElement.classList.add("pd-embed");
      Promise.resolve().then(loadData).then((rows) => PD.run(rows, config.source)).catch(PD.fail);
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : go();
  };
})();
