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

    // 3) PENUTUPAN POS: pos dengan hujan >= lebat DITUTUP, begitu juga pos tepat di bawah & di atasnya
    const closed = Array(10).fill(false), closeReasons = Array.from({length:10}, () => []);
    for (let i = 1; i <= 9; i++) {
      if (lv(i) < WEATHER_TRIGGER_LEVEL) continue;
      const nm = POS[i - 1].n, w = W[i].cls.name.toLowerCase();
      [[i, `${W[i].cls.name} di pos ini`],
       [i - 1, `Pos di bawah ${nm} (${w})`],
       [i + 1, `Pos di atas ${nm} (${w})`]].forEach(([j, text]) => {
        if (j < 1 || j > 9) return;
        closed[j] = true; closeReasons[j].push({type:'closed', text});
        if (j >= 2) entryBlocked[j] = true;
      });
    }

    const pos = [], banner = [];
    for (let i = 1; i <= 9; i++) {
      const cap = POS[i - 1].cap, o = occ[i];
      const full = cap != null && o >= cap;
      const near = cap != null && !full && (o >= cap * NEAR_FULL_RATIO || o + inb[i] >= cap);
      const hold = holds[i].length > 0;
      const status = closed[i] ? 'TUTUP' : hold ? 'TAHAN' : full ? 'PENUH' : lv(i) >= WEATHER_TRIGGER_LEVEL ? 'HUJAN_LEBAT' : near ? 'HAMPIR_PENUH' : lv(i) >= 2 ? 'WASPADA' : 'BUKA';
      pos[i] = {i, cap, occ:o, inb:inb[i], full, near, hold, holds:holds[i], closed:closed[i], closeReasons:closeReasons[i], zone:zone[i], status, weather:(W && W[i]) || null};
      if (closed[i]) banner.push(`🚫 ${POS[i - 1].n} DITUTUP — ${closeReasons[i].map(h => h.text).join('; ')}`);
      if (hold) banner.push(`⛔ Pendakian ditahan di ${POS[i - 1].n} — ${holds[i].map(h => h.text).join('; ')}`);
    }
    // pendaki yang sedang berjalan menuju pos yang ditutup (perlu dihentikan petugas)
    const violators = A.filter(a => !a.atPos && a.dir > 0 && a.nx >= 2 && entryBlocked[a.nx]);
    return {pos, zones, closed, entryBlocked, banner, violators, anyHold:banner.length > 0};
  }
  const STATUS = {
    BUKA:         {icon:'🟢', label:'BUKA',          color:'#22c55e'},
    WASPADA:      {icon:'🟡', label:'WASPADA HUJAN', color:'#eab308'},
    HAMPIR_PENUH: {icon:'🟡', label:'HAMPIR PENUH',  color:'#eab308'},
    PENUH:        {icon:'🔴', label:'PENUH',         color:'#ef4444'},
    HUJAN_LEBAT:  {icon:'🔴', label:'HUJAN LEBAT',   color:'#ef4444'},
    TAHAN:        {icon:'⛔', label:'TAHAN NAIK',    color:'#ef4444'},
    TUTUP:        {icon:'🚫', label:'DITUTUP',       color:'#dc2626'}
  };

  // ---------- SKENARIO DEMO TERARAH (?demo1 … ?demo6) ----------
  // Data deterministik (acak bersemi tetap) => tiap skenario selalu menghasilkan kondisi yang sama.
  // Waktu diacu ke saat halaman dibuka (DEMO_T0), sehingga pendaki "berjalan" seiring waktu nyata.
  const DEMO_T0 = Date.now();
  const DEMO_SCENARIOS = [
    {id:1, title:'Normal',               desc:'Pendakian lancar, cuaca cerah, semua pos BUKA'},
    {id:2, title:'Ramai / padat',        desc:'Pos & jalur padat, beberapa pos hampir penuh, hujan sedang (waspada), ada pendaki terlambat'},
    {id:3, title:'Pos penuh',            desc:'Legok Leunca penuh → pendakian ditahan di Pos 1; pendaki yang menuju ke sana jadi pelanggar'},
    {id:4, title:'Hujan lebat',          desc:'Hujan lebat di Buntut Lutung & Lawang Sekateng → Legok Leunca s/d Simpang Maleber DITUTUP'},
    {id:5, title:'SOS',                  desc:'Tiga pendaki memicu SOS (dua di jalur, satu di pos) dengan kondisi lainnya normal'},
    {id:6, title:'Krisis gabungan',      desc:'Hujan lebat/badai di atas + Legok Leunca penuh + pendaki terlambat + 2 SOS'}
  ];
  const DEMO_MM = {   // curah hujan mm/jam di pos 1..9
    1:[0, 0, 0.2, 0, 0.4, 0.6, 0, 0, 0],
    2:[0, 0.4, 1.1, 2.4, 6.8, 7.5, 3.0, 1.0, 0.2],
    3:[0, 0, 0, 0.2, 0.3, 0, 0, 0, 0],
    4:[0, 0.3, 2.0, 6.5, 12.8, 17.0, 8.0, 1.0, 0],
    5:[0, 0, 0.5, 0.8, 0.4, 0.3, 0, 0, 0],
    6:[0, 0.3, 1.5, 3.0, 6.0, 9.5, 15.0, 22.0, 2.0]
  };
  function scenarioHikers(n) {
    const now = DEMO_T0, M = 60000, out = [];
    let seed = (n * 7919 + 13) >>> 0;
    const R = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rnd = (a, b) => a + R() * (b - a);
    // o: dir 'up'|'down' · mode 'move'|'rest'|'camp'|'sos' · since = menit sejak pos terakhir · eta = menit ke pos berikutnya (negatif = TERLAMBAT)
    function add(pos, o) {
      const i = out.length, up = o.dir !== 'down', mode = o.mode || 'move';
      const since = o.since != null ? o.since : (mode === 'move' ? rnd(14, 70) : rnd(12, 120));
      const eta = o.eta != null ? o.eta : rnd(25, 90);
      const r = {hikername:'Pendaki ' + (i + 1), groupname:'Grup ' + (1 + i % 14), uniqueid:'D' + n + '-' + i, nik:'3201' + String(200000 + i)};
      const T = (k, min) => r['timePos' + k] = new Date(now - min * M).toISOString();
      if (up) {
        for (let k = 1; k <= pos; k++) T(k, since + (pos - k) * 80);
        if (pos < 9) r['PredPos' + (pos + 1)] = new Date(now + eta * M).toISOString();
        r.latestStatus = pos === 9 ? 'SUMMIT-REACHED' : {move:'CHECK-IN-NAIK', rest:'REST-BREAK', camp:'CAMPING-OVERNIGHT', sos:'SOS-EMERGENCY'}[mode];
      } else {
        for (let k = 1; k <= 9; k++) T(k, k >= pos ? since + (k - pos) * 70 : since + (9 - pos) * 70 + 300 + (9 - k) * 80);
        if (pos > 1) r['PredPos' + (pos - 1)] = new Date(now + eta * M).toISOString();
        r.latestStatus = {move:'CHECK-IN-TURUN', rest:'REST-BREAK', camp:'REST-BREAK', sos:'SOS-EMERGENCY'}[mode];
      }
      out.push(r);
    }
    const many = (c, pos, o) => { for (let j = 0; j < c; j++) add(pos, o || {}); };
    const U = {dir:'up'}, D = {dir:'down'}, rest = {dir:'up', mode:'rest'}, rest_d = {dir:'down', mode:'rest'}, camp = {dir:'up', mode:'camp'};

    const baseline = () => {   // lalu lintas normal
      [[1,3],[2,3],[3,3],[4,2],[5,2],[6,2],[7,1]].forEach(([p, c]) => many(c, p, U));
      [[2,2],[3,2],[5,2],[7,2],[8,2]].forEach(([p, c]) => many(c, p, D));
      [[3,3],[4,2],[5,2],[6,3]].forEach(([p, c]) => many(c, p, rest));
      many(8, 8, camp); many(3, 9, U);
    };

    if (n === 1) baseline();
    else if (n === 2) {
      [[2,22],[3,25],[4,26],[5,25],[6,20],[7,19]].forEach(([p, c]) => many(c, p, rest));
      many(55, 8, camp); many(90, 9, U);
      [[1,10],[2,9],[3,8],[4,8],[5,7],[6,6],[7,5],[8,4]].forEach(([p, c]) => many(c, p, U));
      [[2,4],[3,4],[4,5],[5,5],[6,6],[7,6],[8,5]].forEach(([p, c]) => many(c, p, D));
      many(4, 5, {dir:'up', eta:-75}); many(3, 6, {dir:'up', eta:-140});   // terlambat 1 dan 2 jam+
    } else if (n === 3) {
      many(31, 4, rest); many(26, 5, rest); many(12, 3, rest); many(10, 2, rest);
      many(7, 3, U);   // menuju Legok Leunca yang penuh -> pelanggar
      many(5, 2, U); many(4, 5, D); many(3, 7, D); many(12, 8, camp); many(6, 9, U);
    } else if (n === 4) {
      [[3,14],[4,8],[5,10],[6,9],[7,6]].forEach(([p, c]) => many(c, p, rest));
      many(15, 8, camp); many(5, 9, U);
      [[1,5],[2,5],[3,6],[4,4],[5,3],[6,3]].forEach(([p, c]) => many(c, p, U));   // yang menuju zona tutup = pelanggar
      [[8,3],[7,4],[6,4],[5,3],[4,3]].forEach(([p, c]) => many(c, p, D));
    } else if (n === 5) {
      baseline();
      add(2, {dir:'up', mode:'sos', since:25, eta:60});     // di jalur Tanah Merah – Pos 1
      add(5, {dir:'down', mode:'sos', since:40, eta:90});   // di jalur Buntut Lutung – Legok Leunca
      add(8, {dir:'up', mode:'sos', since:5});              // di Surya Kencana
    } else if (n === 6) {
      many(32, 4, rest); many(20, 5, rest); many(14, 6, rest); many(10, 7, rest);
      many(50, 8, camp); many(60, 9, U);
      [[3,5],[4,6],[5,5],[6,5],[7,4]].forEach(([p, c]) => many(c, p, U));
      [[8,6],[7,5],[6,4]].forEach(([p, c]) => many(c, p, D));
      many(3, 6, {dir:'up', eta:-150}); many(2, 7, {dir:'up', eta:-200});   // terlambat lama
      add(6, {dir:'up', mode:'sos', since:30, eta:80});
      add(8, {dir:'up', mode:'sos', since:5});
    }
    return out;
  }

  // ---------- DATA CONTOH (?demo) ----------
  function demoWeather(n) {   // tanpa n: hujan lebat di Lawang Sekateng, sedang di sekitarnya; dengan n: skenario ?demoN
    const mm = DEMO_MM[n] || [0, 0, 0.4, 3.2, 7.5, 13.8, 6.1, 0.2, 0];
    const now = Date.now();
    return normalizeWeather({demo:true, updated:new Date(now).toISOString(), points:mm.map((v, i) => ({
      pos:i + 1, mm:v, temp_c:22 - i * 1.4, humidity:75 + i, wind_kph:6 + i * 2, cloud:60, condition:v > 0 ? 'Hujan' : 'Berawan', last_updated:new Date(now).toLocaleString('sv'),
      forecast:[1, 2, 3].map(h => ({time:new Date(now + h * 3600000).toLocaleString('sv').slice(0, 16), mm:Math.max(0, +(v * (1 - h * .18)).toFixed(1)), chance:70}))
    }))});
  }
  function demoHikers(n) {
    if (DEMO_MM[n]) return scenarioHikers(n);
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
    classifyRain, normalizeWeather, fetchWeather, segmentWeather, analyzeHiker, lastPos, computeStatus, demoWeather, demoHikers, DEMO_SCENARIOS};
})(typeof window !== 'undefined' ? window : globalThis);
