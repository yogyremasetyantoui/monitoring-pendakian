/* =====================================================================
   monitoring_core.js — logika BERSAMA dashboard 2D & 3D
   (konfigurasi pos, klasifikasi hujan, kapasitas, aturan penahanan pendakian)
   Satu sumber aturan => 2D dan 3D selalu memberi keputusan yang sama.
   ===================================================================== */
(function (global) {
  'use strict';

  // ---------- KONFIGURASI ----------
  // Endpoint cuaca = Apps Script yang sama + ?weather=true (lihat apps_script_cuaca.gs)
  const WEATHER_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyKgkvB9lvlKBI_SXjiGaLGpCIUijmmXKprlMdn04k6GOkLsa1BvUJlAqyfRlX127PnvQ/exec?weather=true';
  const WEATHER_REFRESH_MS = 10 * 60 * 1000;   // cuaca diperbarui tiap 10 menit
  const WEATHER_STALE_MS = 25 * 60 * 1000;     // data cuaca dianggap basi bila lebih tua dari ini

  // Aturan penahanan karena hujan:
  //  - hujan >= WEATHER_TRIGGER_LEVEL (3 = Hujan Lebat) di sebuah pos MEMICU penahanan;
  //  - "zona hujan" = pos berurutan dengan hujan >= WEATHER_ZONE_MIN_LEVEL (2 = Hujan Sedang);
  //  - pendakian ditahan di pos SEBELUM zona hujan itu dimulai.
  const WEATHER_TRIGGER_LEVEL = 3;
  const WEATHER_ZONE_MIN_LEVEL = 2;
  const NEAR_FULL_RATIO = 0.8;   // >= 80% kapasitas => "Hampir penuh" (peringatan, belum menahan)

  // cap: batas jumlah pendaki DI pos itu (null = tanpa batas: Basecamp & Surya Kencana)
  // Titik koordinat = GPS pos; alt = ketinggian cadangan bila DEM gagal diunduh.
  const POS = [
    {n:'Basecamp',        full:'Basecamp',                 short:'Basecamp',    lat:-6.756053628447355,  lon:107.00957468484653, alt:1450, cap:null},
    {n:'Tanah Merah',     full:'Pos Bayangan Tanah Merah', short:'T. Merah',    lat:-6.765305507838552,  lon:107.00343648294188, alt:1850, cap:30},
    {n:'Pos 1 Gerbang',   full:'Pos 1 Gerbang Putri',      short:'Gerbang',     lat:-6.767645222134659,  lon:107.00139909986743, alt:1950, cap:30},
    {n:'Legok Leunca',    full:'Pos 2 Legok Leunca',       short:'L. Leunca',   lat:-6.769980625428798,  lon:106.99879243066526, alt:2150, cap:30},
    {n:'Buntut Lutung',   full:'Pos 3 Buntut Lutung',      short:'B. Lutung',   lat:-6.7757969103080224, lon:106.9930848012497,  alt:2300, cap:30},
    {n:'Lawang Sekateng', full:'Lawang Sekateng',          short:'L. Sekateng', lat:-6.77993024972741,   lon:106.99173117025516, alt:2500, cap:30},
    {n:'Simpang Maleber', full:'Pos 4 Simpang Maleber',    short:'S. Maleber',  lat:-6.783276150190118,  lon:106.99179867009686, alt:2625, cap:30},
    {n:'Surya Kencana',   full:'Surya Kencana',            short:'S. Kencana',  lat:-6.79242922610526,   lon:106.9918168003512,  alt:2750, cap:null},
    {n:'Puncak Gede',     full:'Puncak',                   short:'Puncak',      lat:-6.789838053500752,  lon:106.98317416582837, alt:2958, cap:150}
  ];
  const SEG = ['Basecamp – Tanah Merah','Tanah Merah – Pos 1','Pos 1 – Legok Leunca','Legok Leunca – Buntut Lutung',
    'Buntut Lutung – Lawang Sekateng','Lawang Sekateng – Simpang Maleber','Simpang Maleber – Surya Kencana','Surya Kencana – Puncak'];

  // ---------- UTIL ----------
  const ts = v => { if (!v) return null; const t = +new Date(v); return isNaN(t) ? null : t; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- KLASIFIKASI HUJAN (precip_mm per jam) ----------
  const RAIN = [
    {lv:0, name:'Tidak Hujan',     icon:'☀️', color:'#4ade80'},
    {lv:1, name:'Hujan Ringan',    icon:'🌦️', color:'#60a5fa'},
    {lv:2, name:'Hujan Sedang',    icon:'🌧️', color:'#facc15'},
    {lv:3, name:'Hujan Lebat',     icon:'⛈️', color:'#fb923c'},
    {lv:4, name:'BADAI / EKSTREM', icon:'🌪️', color:'#ef4444'}
  ];
  function classifyRain(mmIn) {
    const mm = Number(mmIn);
    if (!isFinite(mm) || mm < 0.1) return Object.assign({bmkg:'Cerah / Berawan', mm:0}, RAIN[0]);
    let lv, bmkg;
    if (mm <= 1.0)       { lv = 1; bmkg = 'Hujan Sangat Ringan'; }
    else if (mm <= 5.0)  { lv = 1; bmkg = 'Hujan Ringan'; }
    else if (mm <= 10.0) { lv = 2; bmkg = 'Hujan Sedang'; }
    else if (mm <= 20.0) { lv = 3; bmkg = 'Hujan Lebat'; }
    else                 { lv = 4; bmkg = 'Hujan Sangat Lebat'; }
    return Object.assign({bmkg, mm}, RAIN[lv]);
  }

  // Ubah respons endpoint -> array W[1..9] (W[0] tak dipakai)
  function normalizeWeather(payload) {
    const W = Array(10).fill(null);
    (payload.points || []).forEach(p => {
      if (!p || !p.pos || p.pos < 1 || p.pos > 9 || p.error) return;
      W[p.pos] = {
        pos:p.pos, mm:Number(p.mm) || 0, cls:classifyRain(p.mm),
        temp:p.temp_c, humidity:p.humidity, wind:p.wind_kph, cloud:p.cloud, condition:p.condition || '',
        observed:p.last_updated || '',
        forecast:(p.forecast || []).map(f => ({time:f.time, mm:Number(f.mm) || 0, chance:f.chance, cls:classifyRain(f.mm)}))
      };
    });
    W.updated = payload.updated || null;
    W.demo = !!payload.demo;
    return W;
  }
  async function fetchWeather() {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(WEATHER_ENDPOINT, {signal:ctl.signal});
      const j = await res.json();
      if (!j || !j.success || !Array.isArray(j.points)) throw new Error((j && j.error) || 'endpoint cuaca belum aktif di Apps Script');
      return normalizeWeather(j);
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'timeout' : e.message); }
    finally { clearTimeout(to); }
  }
  // Cuaca segmen k (0..7) = yang terburuk dari dua pos di ujungnya (konservatif untuk keselamatan)
  function segmentWeather(W, k) {
    const a = W && W[k + 1], b = W && W[k + 2];
    if (!a && !b) return null;
    return (!b || (a && a.cls.lv >= b.cls.lv)) ? a : b;
  }

  // ---------- ANALISIS PENDAKI (dipakai 2D & 3D) ----------
  const AT_POS = ['REST-BREAK', 'CAMPING-OVERNIGHT', 'SUMMIT-REACHED'];
  function lastPos(r) {   // pos dengan timestamp TERBARU
    let b = null;
    for (let i = 1; i <= 9; i++) { const t = ts(r['timePos' + i]); if (t !== null && (!b || t >= b.ms)) b = {pos:i, ms:t}; }
    return b;
  }
  function analyzeHiker(r, now) {
    const st = r.latestStatus; if (st === 'CHECK-OUT-EXIT') return null;
    const lp = lastPos(r); if (!lp) return null;
    let dir = 1;   // REST/CAMPING/SOS: arah dari riwayat (sudah ke puncak & kini di bawahnya = turun)
    if (/TURUN/i.test(st)) dir = -1; else if (!/NAIK|SUMMIT/i.test(st) && ts(r.timePos9) !== null && lp.pos < 9) dir = -1;
    const nx = lp.pos + dir;
    const pred = (nx >= 1 && nx <= 9) ? ts(r['PredPos' + nx]) : null;
    const delay = pred !== null ? (now - pred) / 3600000 : 0;
    const lvl = st === 'SOS-EMERGENCY' ? 4 : delay >= 3 ? 3 : delay >= 2 ? 2 : delay >= 1 ? 1 : 0;
    const atPos = AT_POS.includes(st) || (now - lp.ms) < 10 * 60000 || nx < 1 || nx > 9;
    let seg = -1, t = 0;
    if (!atPos) { const span = pred !== null ? pred - lp.ms : 0; t = span > 0 ? clamp((now - lp.ms) / span, .03, .98) : .4; seg = Math.min(lp.pos, nx) - 1; }
    return {r, pos:lp.pos, atPos, seg, t, dir, nx, lvl, delay, ms:lp.ms};
  }

  // ---------- STATUS POS: kapasitas + cuaca -> penahanan pendakian ----------
  // A = hasil analyzeHiker (tanpa null); W = hasil normalizeWeather (atau null bila cuaca tak tersedia)
  function computeStatus(A, W) {
    const occ = Array(10).fill(0), inb = Array(10).fill(0);
    A.forEach(a => { if (a.atPos) occ[a.pos]++; else if (a.dir > 0 && a.nx >= 1 && a.nx <= 9) inb[a.nx]++; });
    const lv = i => (W && W[i]) ? W[i].cls.lv : 0;
    const holds = Array.from({length:10}, () => []);   // alasan penahanan di tiap pos
    const entryBlocked = Array(10).fill(false);        // pos yang TIDAK boleh dimasuki (pendakian naik)
    const zone = Array(10).fill(false), zones = [], seen = new Set();

    // 1) kapasitas: pos i penuh -> pendakian ditahan di pos sebelumnya (i-1)
    for (let i = 2; i <= 9; i++) {
      const cap = POS[i - 1].cap;
      if (cap != null && occ[i] >= cap) {
        entryBlocked[i] = true;
        holds[i - 1].push({type:'cap', text:`${POS[i - 1].n} penuh (${occ[i]}/${cap})`});
      }
    }
    // 2) cuaca: hujan lebat di pos i -> telusuri zona hujan >= sedang, tahan di pos sebelum zona
    for (let i = 1; i <= 9; i++) {
      if (lv(i) < WEATHER_TRIGGER_LEVEL) continue;
      let s = i, e = i;
      while (s > 1 && lv(s - 1) >= WEATHER_ZONE_MIN_LEVEL) s--;
      while (e < 9 && lv(e + 1) >= WEATHER_ZONE_MIN_LEVEL) e++;
      const key = s + '-' + e; if (seen.has(key)) continue; seen.add(key);
      for (let j = s; j <= e; j++) zone[j] = true;
      zones.push({s, e, trigger:i});
      const holdAt = Math.max(1, s - 1);
      for (let j = s; j <= 9; j++) entryBlocked[j] = true;   // naik ke zona/di atasnya ditutup
      holds[holdAt].push({type:'weather', text: s === 1
        ? `Hujan ${W[i].cls.name.toLowerCase()} di ${POS[i - 1].n} — pendakian belum boleh dimulai`
        : `Zona hujan ≥ sedang mulai ${POS[s - 1].n} (${W[i].cls.name.toLowerCase()} di ${POS[i - 1].n})`});
    }

    const pos = [], banner = [];
    for (let i = 1; i <= 9; i++) {
      const cap = POS[i - 1].cap, o = occ[i];
      const full = cap != null && o >= cap;
      const near = cap != null && !full && (o >= cap * NEAR_FULL_RATIO || o + inb[i] >= cap);
      const hold = holds[i].length > 0;
      const status = hold ? 'TAHAN' : full ? 'PENUH' : lv(i) >= WEATHER_TRIGGER_LEVEL ? 'HUJAN_LEBAT' : near ? 'HAMPIR_PENUH' : lv(i) >= 2 ? 'WASPADA' : 'BUKA';
      pos[i] = {i, cap, occ:o, inb:inb[i], full, near, hold, holds:holds[i], zone:zone[i], status, weather:(W && W[i]) || null};
      if (hold) banner.push(`⛔ Pendakian ditahan di ${POS[i - 1].n} — ${holds[i].map(h => h.text).join('; ')}`);
    }
    // pendaki yang sedang berjalan menuju pos yang ditutup (perlu dihentikan petugas)
    const violators = A.filter(a => !a.atPos && a.dir > 0 && a.nx >= 2 && entryBlocked[a.nx]);
    return {pos, zones, entryBlocked, banner, violators, anyHold:banner.length > 0};
  }
  const STATUS = {
    BUKA:         {icon:'🟢', label:'BUKA',          color:'#22c55e'},
    WASPADA:      {icon:'🟡', label:'WASPADA HUJAN', color:'#eab308'},
    HAMPIR_PENUH: {icon:'🟡', label:'HAMPIR PENUH',  color:'#eab308'},
    PENUH:        {icon:'🔴', label:'PENUH',         color:'#ef4444'},
    HUJAN_LEBAT:  {icon:'🔴', label:'HUJAN LEBAT',   color:'#ef4444'},
    TAHAN:        {icon:'⛔', label:'TAHAN NAIK',    color:'#ef4444'}
  };

  // ---------- DATA CONTOH (?demo) ----------
  function demoWeather() {   // skenario: hujan lebat di Lawang Sekateng, sedang di sekitarnya
    const mm = [0, 0, 0.4, 3.2, 7.5, 13.8, 6.1, 0.2, 0];
    const now = Date.now();
    return normalizeWeather({demo:true, updated:new Date(now).toISOString(), points:mm.map((v, i) => ({
      pos:i + 1, mm:v, temp_c:22 - i * 1.4, humidity:75 + i, wind_kph:6 + i * 2, cloud:60, condition:v > 0 ? 'Hujan' : 'Berawan', last_updated:new Date(now).toLocaleString('sv'),
      forecast:[1, 2, 3].map(h => ({time:new Date(now + h * 3600000).toLocaleString('sv').slice(0, 16), mm:Math.max(0, +(v * (1 - h * .18)).toFixed(1)), chance:70}))
    }))});
  }
  function demoHikers() {
    const now = Date.now(), M = 60000, out = [];
    const base = i => ({hikername:'Pendaki ' + (i + 1), groupname:'Grup ' + (1 + i % 12), uniqueid:'U' + i, nik:'3201' + String(100000 + i)});
    for (let i = 0; i < 70; i++) {
      const lp = 1 + Math.min(8, Math.floor(Math.pow(Math.random(), 1.3) * 9)), up = Math.random() > .25;
      const since = Math.random() * Math.random() * 300;
      const r = base(i);
      const T = (k, min) => r['timePos' + k] = new Date(now - min * M).toISOString();
      const pr = k => r['PredPos' + k] = new Date(now - since * M + (70 + Math.random() * 50) * M).toISOString();
      let st;
      if (up) {
        for (let k = 1; k <= lp; k++) T(k, since + (lp - k) * 80);
        st = lp === 9 ? 'SUMMIT-REACHED' : ['CHECK-IN-NAIK', 'CHECK-IN-NAIK', 'CHECK-IN-NAIK', 'REST-BREAK', 'CAMPING-OVERNIGHT'][i % 5];
        if (lp < 9) pr(lp + 1);
      } else {
        for (let k = 1; k <= 9; k++) T(k, k >= lp ? since + (k - lp) * 70 : since + (9 - lp) * 70 + 300 + (9 - k) * 80);
        st = i % 6 === 0 ? 'REST-BREAK' : 'CHECK-IN-TURUN'; if (lp > 1) pr(lp - 1);
      }
      if (i === 7) st = 'SOS-EMERGENCY';
      r.latestStatus = st; out.push(r);
    }
    for (let j = 0; j < 31; j++) {   // rombongan besar beristirahat di Legok Leunca -> pos penuh (>=30)
      const r = base(100 + j); const s = 20 + Math.random() * 60;
      for (let k = 1; k <= 4; k++) r['timePos' + k] = new Date(now - (s + (4 - k) * 80) * M).toISOString();
      r.latestStatus = 'REST-BREAK'; r.PredPos5 = new Date(now + 40 * M).toISOString(); out.push(r);
    }
    return out;
  }

  global.MC = {POS, SEG, RAIN, STATUS, WEATHER_REFRESH_MS, WEATHER_STALE_MS, WEATHER_TRIGGER_LEVEL, WEATHER_ZONE_MIN_LEVEL,
    classifyRain, normalizeWeather, fetchWeather, segmentWeather, analyzeHiker, lastPos, computeStatus, demoWeather, demoHikers};
})(typeof window !== 'undefined' ? window : globalThis);
