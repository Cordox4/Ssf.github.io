// =====================================================
//  KICKSTREAM — app.js  v3.2
// =====================================================

// ─── CONFIG ──────────────────────────────────────────
const FD_BASE = 'https://api.football-data.org/v4';
const AF_BASE = 'https://v3.football.api-sports.io';
const FD_KEY  = '2619f1b7ba494cc5a948cc6343d23a2e';
const AF_KEY  = '53227037b68f679a9lf2d4d8f68cd4c5';

const COMPS = {
  CL:  { name:'Champions League', short:'C.League',   flag:'https://crests.football-data.org/CL.png'  },
  EL:  { name:'Europa League',    short:'Europa',     flag:'https://crests.football-data.org/EL.png'  },
  EC:  { name:'Conf. League',     short:'Conf.Lge',   flag:'https://crests.football-data.org/EC.png'  },
  PL:  { name:'Premier League',   short:'Premier',    flag:'https://crests.football-data.org/PL.png'  },
  PD:  { name:'La Liga',          short:'La Liga',    flag:'https://crests.football-data.org/PD.png'  },
  BL1: { name:'Bundesliga',       short:'Bundesliga', flag:'https://crests.football-data.org/BL1.png' },
  SA:  { name:'Serie A',          short:'Serie A',    flag:'https://crests.football-data.org/SA.png'  },
  FL1: { name:'Ligue 1',          short:'Ligue 1',    flag:'https://crests.football-data.org/FL1.png' },
  PPL: { name:'Primeira Liga',    short:'Portugal',   flag:'https://crests.football-data.org/PPL.png' },
  DED: { name:'Eredivisie',       short:'Eredivisie', flag:'https://crests.football-data.org/DED.png' },
  BSA: { name:'Brasileirao',      short:'Bresil',     flag:'https://crests.football-data.org/BSA.png' },
  MLS: { name:'MLS',              short:'MLS',        flag:'https://crests.football-data.org/MLS.png' },
};

const DAYS_BACK    = 3;
const DAYS_FORWARD = 6;

const PROXIES = [
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.org/?${encodeURIComponent(u)}`,
];
let pxi = +(localStorage.getItem('pxi') || 0);

// ─── ETAT GLOBAL ─────────────────────────────────────
let page         = 'home';
let tab          = 0;
let lgFilter     = 'all';
let sq           = '';
let selectedDate = null;
let curMatch     = null;
let loading      = false;
let lastFetch    = 0;

let favorites = new Set(
  JSON.parse(localStorage.getItem('favs') || '[]').map(x => isNaN(+x) ? x : +x)
);

let data = {
  live:      [],   // matchs EN_PLAY|PAUSED (tous jours)
  byDate:    {},   // { 'YYYY-MM-DD': [match, ...] }
  standings: {},
};

const QS = ['SD','HD','HD+','4K'];
let qi = 1;

// ─── STREAMS MANUELS ─────────────────────────────────
const MANUAL_STREAMS = [
  {
    // Barca vs Newcastle — Champions League
    homeKeyword: 'barcelona',
    awayKeyword: 'newcastle',
    url: 'https://viamotionhsi.netplus.ch/live/eds/tf1hd/browser-HLS8/tf1hd.m3u8'',
  },
];

function assignManualStreams(matches) {
  for (const m of matches) {
    const hn = (m.homeTeam?.name || m.homeTeam?.shortName || '').toLowerCase();
    const an = (m.awayTeam?.name || m.awayTeam?.shortName || '').toLowerCase();
    for (const s of MANUAL_STREAMS) {
      const match1 = hn.includes(s.homeKeyword) && an.includes(s.awayKeyword);
      const match2 = hn.includes(s.awayKeyword) && an.includes(s.homeKeyword);
      if (match1 || match2) {
        m.streamUrl = s.url;
        console.log('[KickStream] Stream assigne :', hn, 'vs', an);
      }
    }
  }
}

// ─── ETAT LECTEUR ────────────────────────────────────
const player = {
  playing:      false,
  muted:        false,
  fs:           false,
  timer:        null,
  hideTimer:    null,
  dragging:     false,
  ctrlsVisible: true,
};

// ─── UTILS ───────────────────────────────────────────
const $ = id => document.getElementById(id);

function toast_(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function abbr(n) {
  if (!n) return '?';
  const w = n.trim().split(/\s+/);
  return w.length === 1 ? n.slice(0,3).toUpperCase()
       : (w[0][0] + (w[1]?.[0] || '')).toUpperCase();
}

function fmtTime(d) {
  return new Date(d).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}

function fmtSecs(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2,'0')}`;
}

// Renvoie 'YYYY-MM-DD' en heure LOCALE (pas UTC)
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function todayKey() { return dayKey(new Date()); }

function getScore(m) {
  const g = m.goals;
  if (g?.home == null || g?.away == null) return '-:-';
  return `${g.home}:${g.away}`;
}

function getMin(m) {
  const st = m._status;
  if (st) {
    if (st.short === 'HT') return 'MT';
    const el = st.elapsed;
    if (el == null) return '';
    return st.extra ? `${el}+${st.extra}'` : `${el}'`;
  }
  if (m.status === 'PAUSED')  return 'MT';
  if (m.status === 'IN_PLAY') return 'LIVE';
  return '';
}

function isLive(m) { return m.status === 'IN_PLAY' || m.status === 'PAUSED'; }
function isFin(m)  { return m.status === 'FINISHED'; }

function crestImg(url, name, cls) {
  const ab = abbr(name);
  if (url) return `<div class="crest ${cls}"><img src="${url}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<div class=cp>${ab}</div>'"></div>`;
  return `<div class="crest ${cls}"><div class="cp">${ab}</div></div>`;
}

function setCrest(elId, url, name) {
  const el = $(elId); if (!el) return;
  const ab = abbr(name);
  el.innerHTML = url
    ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:contain;padding:4px" onerror="this.parentNode.innerHTML='<div class=cp>${ab}</div>'">`
    : `<div class="cp">${ab}</div>`;
}

// ─── FETCH ───────────────────────────────────────────
async function fdFetch(ep, timeout=12000) {
  const url = `${FD_BASE}${ep}`;
  for (let i = 0; i < PROXIES.length; i++) {
    const idx = (pxi + i) % PROXIES.length;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), timeout);
      const res  = await fetch(PROXIES[idx](url), {
        headers: { 'X-Auth-Token': FD_KEY, 'x-requested-with': 'XMLHttpRequest' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!res.ok) { console.warn('FD', res.status, ep); continue; }
      const json = await res.json();
      if (idx !== pxi) { pxi = idx; localStorage.setItem('pxi', String(idx)); }
      return json;
    } catch(e) { console.warn(`proxy ${idx}:`, e.message); }
  }
  return null;
}

async function afFetch(ep, timeout=12000) {
  const url = `${AF_BASE}${ep}`;
  for (let i = 0; i < PROXIES.length; i++) {
    const idx = (pxi + i) % PROXIES.length;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), timeout);
      const res  = await fetch(PROXIES[idx](url), {
        headers: { 'x-apisports-key': AF_KEY, 'x-requested-with': 'XMLHttpRequest' },
        signal: ctrl.signal,
      });
      clearTimeout(tid);
      if (!res.ok) { console.warn('AF', res.status, ep); continue; }
      const json = await res.json();
      if (json?.errors && Object.keys(json.errors).length) continue;
      if (idx !== pxi) { pxi = idx; localStorage.setItem('pxi', String(idx)); }
      return json;
    } catch(e) { console.warn(`proxy ${idx}:`, e.message); }
  }
  return null;
}

// ─── CHARGEMENT MATCHS ───────────────────────────────
async function loadMatches() {
  loading = true;
  renderContent();

  const today    = new Date();
  const dateFrom = addDays(today, -DAYS_BACK);
  const dateTo   = addDays(today,  DAYS_FORWARD);
  const df       = d => d.toISOString().split('T')[0];
  const all      = [];

  await Promise.allSettled(
    Object.entries(COMPS).map(async ([id, comp]) => {
      const res = await fdFetch(`/competitions/${id}/matches?dateFrom=${df(dateFrom)}&dateTo=${df(dateTo)}`);
      if (!res?.matches?.length) return;
      for (const m of res.matches) {
        m._cid    = id;
        m._cname  = comp.name;
        m._cflag  = comp.flag;
        m._cshort = comp.short;
        // Score : fullTime > halfTime > null
        const ft  = m.score?.fullTime;
        const ht  = m.score?.halfTime;
        m.goals   = { home: ft?.home ?? ht?.home ?? null, away: ft?.away ?? ht?.away ?? null };
        m._status = null;
        // Clé de jour en heure locale (pas UTC, évite les décalages minuit)
        m._dayKey = dayKey(new Date(m.utcDate));
      }
      all.push(...res.matches);
    })
  );

  loading   = false;
  lastFetch = Date.now();
  all.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  // Assignation des streams manuels (ex: Barça vs Newcastle)
  assignManualStreams(all);

  // Index par date
  data.byDate = {};
  for (const m of all) {
    if (!data.byDate[m._dayKey]) data.byDate[m._dayKey] = [];
    data.byDate[m._dayKey].push(m);
  }

  // Live = tous jours (cas exceptionnel CL en soirée)
  data.live = all.filter(isLive);

  // Date sélectionnée : aujourd'hui par défaut, ou conserver si elle existe
  const tk = todayKey();
  if (!selectedDate || !data.byDate[selectedDate]) selectedDate = tk;

  $('ndot').style.display = data.live.length ? 'block' : 'none';
  renderTicker();
  renderContent();

  if (data.live.length) loadLiveData();

  // Auto-scroll de la date-bar vers aujourd'hui
  setTimeout(scrollDateBarToSelected, 80);
}

function scrollDateBarToSelected() {
  const bar  = $('date-bar');
  const chip = bar?.querySelector('.date-chip.on');
  if (bar && chip) {
    bar.scrollLeft = chip.offsetLeft - bar.offsetWidth / 2 + chip.offsetWidth / 2;
  }
}

async function loadLiveData() {
  const res = await afFetch('/fixtures?live=all');
  if (!res?.response) return;

  for (const f of res.response) {
    const hn = f.teams?.home?.name;
    const an = f.teams?.away?.name;
    if (!hn || !an) continue;
    const match = data.live.find(m => {
      const mh = m.homeTeam.name || '';
      const ma = m.awayTeam.name || '';
      return (mh === hn || mh.includes(hn) || hn.includes(mh))
          && (ma === an || ma.includes(an) || an.includes(ma));
    });
    if (!match) continue;
    match._status = f.fixture?.status ?? null;
    if (f.goals?.home != null) match.goals = { home: f.goals.home, away: f.goals.away };
  }

  renderTicker();
  renderContent();
  if (curMatch && isLive(curMatch)) playerUpdateHud();
}

async function loadStandings(cid) {
  if (data.standings[cid]) return;
  const res = await fdFetch(`/competitions/${cid}/standings`);
  if (!res?.standings) return;
  data.standings[cid] = res.standings[0]?.table || [];
  renderContent();
}

// Refresh automatique
setInterval(() => { if (Date.now() - lastFetch > 60000) loadMatches(); }, 60000);
setInterval(() => { if (data.live.length) loadLiveData(); }, 30000);

// ─── TICKER ──────────────────────────────────────────
function renderTicker() {
  const live = data.live;
  // Matchs terminés d'aujourd'hui
  const fin  = (data.byDate[todayKey()] || []).filter(isFin).slice(0, 5);

  if (!live.length && !fin.length) {
    $('ticker').innerHTML = `<span class="t-item" style="color:var(--t3);font-size:11px;letter-spacing:1px">AUCUN MATCH EN DIRECT</span>`;
    return;
  }
  const lH = live.map(m => {
    const min = getMin(m);
    const hn  = m.homeTeam.shortName || m.homeTeam.name;
    const an  = m.awayTeam.shortName || m.awayTeam.name;
    return `<span class="t-item"><span class="t-live">● LIVE</span><span style="font-weight:600">${hn}</span><span class="t-sc">${getScore(m)}</span><span style="font-weight:600">${an}</span>${min?`<span style="color:var(--t3);font-size:10px">${min}</span>`:''}</span>`;
  }).join('');
  const fH = fin.map(m => {
    const hn = m.homeTeam.shortName || m.homeTeam.name;
    const an = m.awayTeam.shortName || m.awayTeam.name;
    return `<span class="t-item"><span class="t-ft">FT</span><span style="font-weight:600">${hn}</span><span class="t-sc" style="background:var(--s4);color:var(--t2)">${getScore(m)}</span><span style="font-weight:600">${an}</span></span>`;
  }).join('');
  const c = lH + fH;
  $('ticker').innerHTML = c + c; // double pour loop infini
}

// ─── NAVIGATION ──────────────────────────────────────
function setPage(pg) {
  page = pg; tab = 0;
  document.querySelectorAll('.bi[data-pg]').forEach(el => el.classList.toggle('on', el.dataset.pg === pg));
  $('scroll').scrollTop = 0;
  if (pg === 'standings') loadStandings(Object.keys(COMPS)[0]);
  renderContent();
}
function setTab(i)   { tab = i; renderContent(); }
function setLg(id)   { lgFilter = id; renderContent(); }
function onSearch(v) { sq = v; renderContent(); }
function setDate(dk) {
  selectedDate = dk;
  renderContent();
  // scroll immédiat vers le chip sélectionné
  requestAnimationFrame(scrollDateBarToSelected);
}

// ─── RENDER PRINCIPAL ────────────────────────────────
function renderContent() {
  const el = $('content');
  let html = loading
    ? `<div class="loading"><div class="spinner"></div><span style="font-size:12.5px">Chargement…</span></div>`
    : page === 'home'      ? renderHome()
    : page === 'schedule'  ? renderSchedule()
    : page === 'standings' ? renderStandings()
    : page === 'favorites' ? renderFavorites()
    : page === 'notifs'    ? renderNotifs()
    : page === 'profile'   ? renderProfile()
    : page === 'search'    ? renderSearch()
    : '';
  el.innerHTML = `<div class="page">${html}</div>`;
  bindEvents();
}

// ─── HELPERS LABEL DATE ──────────────────────────────
function fmtDayLabel(key) {
  const tk = todayKey();
  if (key === tk)                          return "Auj.";
  if (key === dayKey(addDays(new Date(),  1))) return "Demain";
  if (key === dayKey(addDays(new Date(), -1))) return "Hier";
  const d = new Date(key + 'T12:00:00');
  // "Lun 03"
  return d.toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit' })
           .replace(/\./g,'').trim();
}

function fmtDayFull(key) {
  const d = new Date(key + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' });
}

// ─── DATE PICKER ─────────────────────────────────────
function datePicker() {
  const today = new Date();
  const tk    = todayKey();
  let html    = '<div class="date-bar" id="date-bar">';
  for (let i = -DAYS_BACK; i <= DAYS_FORWARD; i++) {
    const k     = dayKey(addDays(today, i));
    const count = (data.byDate[k] || []).length;
    const on    = selectedDate === k ? ' on' : '';
    const empty = count === 0       ? ' empty' : '';
    html += `<div class="date-chip${on}${empty}" onclick="setDate('${k}')">
      <span class="dc-label">${fmtDayLabel(k)}</span>
      ${count > 0 ? `<span class="dc-count">${count}</span>` : ''}
    </div>`;
  }
  html += '</div>';
  return html;
}

// ─── HOME ────────────────────────────────────────────
function renderHome() {
  const chips = [
    { id:'all', name:'Tous' },
    ...Object.entries(COMPS).map(([k,v]) => ({ id:k, name:v.short })),
  ];

  const sel  = selectedDate || todayKey();
  let   mAll = (data.byDate[sel] || []).slice();
  if (lgFilter !== 'all') mAll = mAll.filter(m => m._cid === lgFilter);

  const live = mAll.filter(isLive);
  const up   = mAll.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED');
  const fin  = mAll.filter(isFin);

  // Featured = premier live, sinon premier "à venir" si c'est aujourd'hui
  const feat = live[0] || (sel === todayKey() ? up[0] : null) || null;

  // Grouper par competition
  function groupByComp(arr) {
    const g = {};
    for (const m of arr) {
      if (!g[m._cname]) g[m._cname] = [];
      g[m._cname].push(m);
    }
    return g;
  }

  const liveRest  = feat && isLive(feat)   ? live.slice(1) : live;
  const upFiltered = feat && !isLive(feat) && (feat.status === 'SCHEDULED' || feat.status === 'TIMED')
                   ? up.slice(1) : up;

  return `
  ${datePicker()}
  <div class="chips">${chips.map(c=>`<div class="chip${lgFilter===c.id?' on':''}" onclick="setLg('${c.id}')">${c.name}</div>`).join('')}</div>
  ${feat ? featCard(feat) : ''}

  ${liveRest.length ? `
    <div class="sec-head">
      <span class="sec-title"><span style="color:var(--red);font-size:9px">●</span> EN DIRECT (${live.length})</span>
    </div>
    <div class="mlist">${liveRest.map(mCard).join('')}</div>
    <div class="gap"></div>` : ''}

  ${Object.entries(groupByComp(upFiltered)).map(([comp,ms])=>`
    <div class="sec-head">
      <span class="sec-title">${comp}</span>
      <span style="font-size:10px;color:var(--t3)">${ms.length} match${ms.length>1?'s':''}</span>
    </div>
    <div class="mlist">${ms.map(mCard).join('')}</div>
    <div class="gap"></div>`).join('')}

  ${Object.entries(groupByComp(fin)).map(([comp,ms])=>`
    <div class="sec-head">
      <span class="sec-title">${comp}</span>
      <span class="sec-badge-ft">FT</span>
    </div>
    <div class="mlist">${ms.map(mCard).join('')}</div>
    <div class="gap"></div>`).join('')}

  ${!live.length && !up.length && !fin.length
    ? `<div class="empty">Aucun match ce jour</div>` : ''}`;
}

// ─── SCHEDULE ────────────────────────────────────────
function renderSchedule() {
  const allDates = Object.keys(data.byDate).sort();
  if (!allDates.length) return `<div class="empty">Aucun match programme</div>`;

  return allDates.map(dk => {
    let matches = (data.byDate[dk] || []).slice();
    if (lgFilter !== 'all') matches = matches.filter(m => m._cid === lgFilter);
    if (!matches.length) return '';

    // Grouper par competition
    const byC = {};
    for (const m of matches) {
      if (!byC[m._cname]) byC[m._cname] = [];
      byC[m._cname].push(m);
    }

    const isToday = dk === todayKey();
    return `
    <div class="day-header">
      <span class="day-title">${fmtDayLabel(dk)}</span>
      <span class="day-full">${fmtDayFull(dk)}</span>
      ${isToday ? '<span class="day-today-dot"></span>' : ''}
    </div>
    ${Object.entries(byC).map(([comp,ms])=>`
      <div class="sec-head" style="padding-top:8px">
        <span class="sec-title" style="font-size:13px">${comp}</span>
        <span style="font-size:10px;color:var(--t3)">${ms.length} match${ms.length>1?'s':''}</span>
      </div>
      <div class="mlist">${ms.map(mCard).join('')}</div>`).join('')}
    <div class="gap"></div>`;
  }).join('');
}

// ─── STANDINGS ───────────────────────────────────────
function renderStandings() {
  const compKeys = Object.keys(COMPS);
  const selKey   = compKeys[tab] || compKeys[0];
  const tabsHtml = `<div class="tabs">${compKeys.map((k,i)=>`<div class="tab${tab===i?' on':''}" onclick="setTab(${i})">${COMPS[k].short}</div>`).join('')}</div>`;

  if (!data.standings[selKey]) {
    loadStandings(selKey);
    return tabsHtml + `<div class="loading"><div class="spinner"></div></div>`;
  }
  const rows = data.standings[selKey];
  if (!rows.length) return tabsHtml + `<div class="empty">Classement indisponible</div>`;

  return `${tabsHtml}
  <div class="tbl-wrap"><table>
    <thead><tr><th>#</th><th></th><th>Equipe</th><th class="c">MJ</th><th class="c">G</th><th class="c">N</th><th class="c">P</th><th class="c">Pts</th><th>Forme</th></tr></thead>
    <tbody>${rows.map((r,i) => {
      const cl   = i < 4 ? 'var(--blue)' : i < 6 ? '#f80' : 'transparent';
      const form = (r.form || '').split('').slice(-5);
      const name = r.team.shortName || r.team.name;
      return `<tr>
        <td class="td-pos">${r.position}</td>
        <td class="td-cl"><div class="cl-bar" style="background:${cl}"></div></td>
        <td><div class="td-tc">${crestImg(r.team.crest, name, 'crest-sm')}<span style="font-weight:700;font-size:12px">${name}</span></div></td>
        <td class="c">${r.playedGames}</td>
        <td class="c">${r.won??'-'}</td><td class="c">${r.draw??'-'}</td><td class="c">${r.lost??'-'}</td>
        <td class="c"><span class="td-pts">${r.points}</span></td>
        <td><div class="form-row">${form.map(f=>`<div class="fd ${f==='W'?'w':f==='D'?'d':'l'}">${f}</div>`).join('')}</div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>
  <div style="padding:10px 14px 16px;font-size:10.5px;color:var(--t3);display:flex;gap:16px">
    <span><span style="display:inline-block;width:7px;height:7px;border-radius:1px;background:var(--blue);margin-right:5px"></span>C1</span>
    <span><span style="display:inline-block;width:7px;height:7px;border-radius:1px;background:#f80;margin-right:5px"></span>Europa</span>
  </div>`;
}

// ─── FAVORITES ───────────────────────────────────────
function renderFavorites() {
  const all  = Object.values(data.byDate).flat();
  const favs = all.filter(m => favorites.has(m.id));
  return `
  <div class="sec-head" style="margin-top:4px">
    <span class="sec-title">Mes matchs</span>
    <span style="font-size:11px;color:var(--t2)">${favs.length} sauvegarde${favs.length!==1?'s':''}</span>
  </div>
  ${favs.length ? `<div class="mlist">${favs.map(mCard).join('')}</div>`
                : `<div class="empty">Aucun match sauvegarde</div>`}
  <div class="gap"></div>`;
}

// ─── NOTIFICATIONS ───────────────────────────────────
function renderNotifs() {
  $('ndot').style.display = 'none';
  const notifs = [
    ...data.live.map(m => ({
      text: `EN DIRECT — ${m.homeTeam.name} ${getScore(m)} ${m.awayTeam.name}${getMin(m)?' · '+getMin(m):''}`,
      sub: m._cname, unread: true,
    })),
    { text:'Scores mis a jour toutes les 60 s',        sub:'football-data.org',       unread:false },
    { text:'Minutes live toutes les 30 s',             sub:'API-Football',             unread:false },
    { text:'Classements pour toutes les ligues',       sub:'Mise a jour au demarrage', unread:false },
  ];
  return `
  <div class="sec-head" style="margin-top:4px">
    <span class="sec-title">Alertes</span>
    <span class="sec-more" onclick="toast_('Tout lu')">Tout lire</span>
  </div>
  <div class="notif-list">
    ${notifs.map(n=>`
    <div class="notif${n.unread?' unread':''}">
      <div class="notif-ico">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="12" cy="12" r="${n.unread?6:4}"/></svg>
      </div>
      <div>
        <div class="notif-text">${n.text}</div>
        ${n.sub?`<div class="notif-time">${n.sub}</div>`:''}
      </div>
    </div>`).join('')}
  </div>
  <div class="gap"></div>`;
}

// ─── PROFILE ─────────────────────────────────────────
function renderProfile() {
  const total = Object.values(data.byDate).flat().length;
  const ico = path => `<div class="p-row-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">${path}</svg></div>`;
  return `
  <div class="p-head">
    <div class="p-av">KS</div>
    <div><div class="p-name">KickStream</div><div class="p-meta">Scores de football en direct</div></div>
  </div>
  <div class="p-stats">
    <div class="ps"><div class="ps-v">${data.live.length}</div><div class="ps-l">En direct</div></div>
    <div class="ps"><div class="ps-v">${total}</div><div class="ps-l">Matchs chargés</div></div>
    <div class="ps"><div class="ps-v">${favorites.size}</div><div class="ps-l">Favoris</div></div>
  </div>
  <div class="p-section">
    <div class="p-s-title">Statut API</div>
    <div class="api-info">
      <div class="api-info-row"><span class="api-info-label">football-data.org</span><span class="api-status ok">● Actif</span></div>
      <div class="api-info-row"><span class="api-info-label">API-Football (minutes live)</span><span class="api-status ok">● Actif</span></div>
    </div>
  </div>
  <div class="p-section">
    <div class="p-s-title">Parametres</div>
    <div class="p-row" id="btn-refresh">
      <div class="p-row-l">${ico('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.28"/>')}Rafraichir les donnees</div>
      <span class="p-row-r">›</span>
    </div>
    <div class="p-row" id="btn-lang">
      <div class="p-row-l">${ico('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>')}Langue</div>
      <span class="p-row-r">Francais ›</span>
    </div>
  </div>
  <div class="p-section">
    <div class="p-s-title">Informations</div>
    <div class="p-row" id="btn-cgu"><div class="p-row-l">${ico('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>')}Conditions d\'utilisation</div><span class="p-row-r">›</span></div>
    <div class="p-row" id="btn-privacy"><div class="p-row-l">${ico('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')}Confidentialite</div><span class="p-row-r">›</span></div>
    <div class="p-row" id="btn-sources"><div class="p-row-l">${ico('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>')}Sources des donnees</div><span class="p-row-r">›</span></div>
    <div class="p-row" id="btn-about"><div class="p-row-l">${ico('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>')}A propos</div><span class="p-row-r">›</span></div>
  </div>
  <div style="padding:16px 14px;text-align:center;font-size:11px;color:var(--t3)">KickStream v3.2 · 10 jours · 12 ligues</div>
  <div class="gap"></div>`;
}

// ─── SEARCH ──────────────────────────────────────────
function renderSearch() {
  const q   = sq.toLowerCase().trim();
  const all = Object.values(data.byDate).flat();
  const res = q
    ? all.filter(m =>
        (m.homeTeam.name||'').toLowerCase().includes(q) ||
        (m.awayTeam.name||'').toLowerCase().includes(q) ||
        (m._cname||'').toLowerCase().includes(q))
    : all.slice(0, 40);
  return `
  <div class="search-box">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16" style="color:var(--t3);flex-shrink:0"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="text" id="search-input" placeholder="Equipe, competition..." value="${sq.replace(/"/g,'&quot;')}" autofocus>
  </div>
  ${res.length ? `<div class="mlist">${res.map(mCard).join('')}</div>`
               : `<div class="empty">Aucun resultat${sq?` pour "${sq}"`:''}${!q&&!all.length?' — chargement en cours':''}</div>`}
  <div class="gap"></div>`;
}

// ─── COMPOSANTS CARTES ───────────────────────────────
function featCard(m) {
  const live = isLive(m), fin = isFin(m);
  const min  = getMin(m);
  const fav  = favorites.has(m.id);
  const hn   = m.homeTeam.shortName || m.homeTeam.name;
  const an   = m.awayTeam.shortName || m.awayTeam.name;
  const goals = (m.goals_detail || []).filter(e => e.type === 'Goal');
  return `
  <div class="featured" data-mid="${m.id}">
    <div class="feat-glow"></div>
    <div class="feat-top">
      <div class="feat-meta">
        <span class="feat-league"><img src="${m._cflag}" onerror="this.style.display='none'" alt="">${m._cname}</span>
        ${live  ? `<div class="live-pill"><div class="live-dot"></div><span class="live-lbl">EN DIRECT</span></div>`
        : fin   ? `<span style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--t3)">TERMINE</span>`
                : `<span style="font-size:11px;font-weight:700;color:var(--blue)">${fmtTime(m.utcDate)}</span>`}
      </div>
      <div class="feat-match">
        <div class="feat-team">${crestImg(m.homeTeam.crest, hn, 'crest-lg')}<div class="feat-name">${hn}</div></div>
        <div>
          <div class="feat-score">${(live||fin) ? getScore(m) : '-'}</div>
          ${live && min ? `<div class="feat-min">${min}</div>` : ''}
        </div>
        <div class="feat-team">${crestImg(m.awayTeam.crest, an, 'crest-lg')}<div class="feat-name">${an}</div></div>
      </div>
    </div>
    ${goals.length ? `<div class="feat-events">${goals.map(e=>`<div class="ev-chip goal">${e.time?.elapsed??e.minute}' ${(e.scorer?.name||e.player?.name||'').split(' ').pop()}</div>`).join('')}</div>` : ''}
    <div class="feat-foot">
      <button class="f-btn ghost" data-fid="${m.id}">${fav?'Sauvegarde':'Sauvegarder'}</button>
      ${live ? `<button class="f-btn primary" data-watch="${m.id}">Regarder</button>`
      : fin  ? `<button class="f-btn ghost" data-watch="${m.id}">Replay</button>`
             : `<button class="f-btn ghost" data-remind="${m.id}">Rappel</button>`}
    </div>
  </div>`;
}

function mCard(m) {
  const live = isLive(m), fin = isFin(m);
  const min  = getMin(m);
  const fav  = favorites.has(m.id);
  const hn   = m.homeTeam.shortName || m.homeTeam.name;
  const an   = m.awayTeam.shortName || m.awayTeam.name;
  let statusHtml, scoreClass, timeHtml;
  if (live) {
    statusHtml = `<span class="mc-status live">● LIVE</span>`;
    scoreClass = 'live';
    timeHtml   = `<span class="mc-time"><span class="mc-ld"></span>${min||'LIVE'}</span>`;
  } else if (fin) {
    statusHtml = `<span class="mc-status ft">FT</span>`;
    scoreClass = 'ft';
    timeHtml   = `<span class="mc-time">Termine</span>`;
  } else {
    statusHtml = `<span class="mc-status soon">${fmtTime(m.utcDate)}</span>`;
    scoreClass = 'soon';
    timeHtml   = `<span class="mc-time">A venir</span>`;
  }
  return `
  <div class="mcard" data-mid="${m.id}">
    <div class="mc-head">
      <span class="mc-league"><img src="${m._cflag}" onerror="this.style.display='none'" alt="">${m._cname}</span>
      ${statusHtml}
    </div>
    <div class="mc-body">
      <div class="mct">${crestImg(m.homeTeam.crest, hn, 'crest-md')}<div class="mct-name">${hn}</div></div>
      <div class="mc-score ${scoreClass}">${(live||fin) ? getScore(m) : 'vs'}</div>
      <div class="mct r"><div class="mct-name">${an}</div>${crestImg(m.awayTeam.crest, an, 'crest-md')}</div>
    </div>
    <div class="mc-foot">
      ${timeHtml}
      <div class="mc-act">
        <div class="fav-btn${fav?' on':''}" data-fid="${m.id}">
          <svg viewBox="0 0 24 24" fill="${fav?'currentColor':'none'}" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </div>
        <div class="watch-btn${m.streamUrl?' has-stream':''}" data-watch="${m.id}">
          ${live ? `<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><path d="M8 5v14l11-7z"/></svg> Regarder`
          : fin  ? 'Replay'
          : m.streamUrl ? `<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><path d="M8 5v14l11-7z"/></svg> Stream`
          : 'Rappel'}
        </div>
      </div>
    </div>
  </div>`;
}

// ─── EVENTS BINDING ──────────────────────────────────
function bindEvents() {
  // lookup unique par id
  const matchById = {};
  for (const m of Object.values(data.byDate).flat()) matchById[String(m.id)] = m;

  document.querySelectorAll('[data-mid]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-fid],[data-watch],[data-remind]')) return;
      const m = matchById[el.dataset.mid];
      if (m) openModal(m);
    });
  });
  document.querySelectorAll('[data-watch]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const m = matchById[el.dataset.watch];
      if (m) openModal(m);
    });
  });
  document.querySelectorAll('[data-fid]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); toggleFav(el.dataset.fid); });
  });
  document.querySelectorAll('[data-remind]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); toast_('Rappel active'); });
  });

  const si = $('search-input');
  if (si) si.addEventListener('input', e => onSearch(e.target.value));

  const btnR = $('btn-refresh');
  if (btnR) btnR.onclick = () => {
    data = { live:[], byDate:{}, standings:{} };
    lastFetch = 0;
    loadMatches();
    toast_('Donnees rechargees');
  };
  const btnL = $('btn-lang');
  if (btnL) btnL.onclick = () => toast_('Langue : Francais');
  ['cgu','privacy','sources','about'].forEach(k => {
    const el = $(`btn-${k}`); if (el) el.onclick = () => openLegal(k);
  });
}

// ─── FAVORIS ─────────────────────────────────────────
function toggleFav(rawId) {
  // IDs football-data sont des entiers
  const id = isNaN(+rawId) ? rawId : +rawId;
  if (favorites.has(id)) { favorites.delete(id); toast_('Retire des favoris'); }
  else                   { favorites.add(id);    toast_('Sauvegarde'); }
  localStorage.setItem('favs', JSON.stringify([...favorites]));
  if (curMatch && String(curMatch.id) === String(id)) playerSyncFavBtn();
  renderContent();
}
function toggleFavCur() { if (curMatch) toggleFav(curMatch.id); }

// ═══════════════════════════════════════════════════
//  LECTEUR VIDEO
// ═══════════════════════════════════════════════════

function playerShowCtrls() {
  clearTimeout(player.hideTimer);
  const ctrls = $('player-ctrls');
  const hud   = $('player-hud');
  if (!ctrls || !hud) return;
  ctrls.classList.remove('hidden');
  hud.classList.remove('hide');
  player.ctrlsVisible = true;
  if (player.playing) player.hideTimer = setTimeout(playerHideCtrls, 3000);
}

function playerHideCtrls() {
  $('player-ctrls')?.classList.add('hidden');
  $('player-hud')?.classList.add('hide');
  player.ctrlsVisible = false;
}

function playerSetPlayState(playing) {
  player.playing = playing;
  const ipa = $('ico-pause'), ipl = $('ico-play');
  if (ipa) ipa.style.display = playing ? '' : 'none';
  if (ipl) ipl.style.display = playing ? 'none' : '';

  // flash central
  const flash = $('player-flash');
  const ico   = $('pf-ico');
  if (flash && ico) {
    ico.innerHTML = playing
      ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    flash.classList.remove('show');
    void flash.offsetWidth;
    flash.classList.add('show');
  }

  if (playing) {
    player.hideTimer = setTimeout(playerHideCtrls, 3000);
  } else {
    clearTimeout(player.hideTimer);
    playerShowCtrls();
  }
}

function playerTogglePlay() {
  const v = $('main-vid'); if (!v) return;
  if (player.playing) { v.pause(); playerSetPlayState(false); }
  else { v.play().catch(() => {}); playerSetPlayState(true); }
}

function playerSetMute(muted) {
  player.muted = muted;
  const v = $('main-vid'); if (v) v.muted = muted;
  const iv = $('ico-vol'), im = $('ico-mute');
  if (iv) iv.style.display = muted ? 'none' : '';
  if (im) im.style.display = muted ? '' : 'none';
}

function playerSetProgress(pct) {
  const fill  = $('pc-fill');
  const thumb = $('pc-thumb');
  if (fill)  fill.style.width = pct + '%';
  if (thumb) thumb.style.left = pct + '%';
}

function playerUpdateHud() {
  if (!curMatch) return;
  const score = getScore(curMatch);
  const min   = getMin(curMatch) || (isFin(curMatch) ? 'FT' : 'LIVE');
  const hsc   = $('hud-sc'),  hmin  = $('hud-min');
  const fsc   = $('fb-score'), fmin = $('fb-min');
  if (hsc)  hsc.textContent  = score;
  if (hmin) hmin.textContent = min;
  if (fsc)  fsc.textContent  = score;
  if (fmin) fmin.textContent = min;
}

function playerSyncFavBtn() {
  if (!curMatch) return;
  const isFav = favorites.has(curMatch.id);
  const out = $('ico-fav-out'), inn = $('ico-fav-in'), lbl = $('fav-label');
  if (out) out.style.display = isFav ? 'none' : '';
  if (inn) inn.style.display = isFav ? '' : 'none';
  if (lbl) lbl.textContent   = isFav ? 'Sauvegarde' : 'Sauvegarder';
  $('mi-fav')?.classList.toggle('active', isFav);
}

// Drag barre progression
function playerInitProgressDrag() {
  const zone  = $('pc-prog-zone');
  const track = $('pc-track');
  const fill  = $('pc-fill');
  const vid   = $('main-vid');
  if (!zone || !track || !fill || !vid) return;

  function getPct(clientX) {
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }
  function applyPct(pct) {
    fill.classList.add('dragging');
    playerSetProgress(pct * 100);
    if (vid.duration) vid.currentTime = pct * vid.duration;
  }
  zone.addEventListener('pointerdown', e => {
    player.dragging = true;
    zone.setPointerCapture(e.pointerId);
    applyPct(getPct(e.clientX));
    playerShowCtrls();
  });
  zone.addEventListener('pointermove', e => {
    if (player.dragging) applyPct(getPct(e.clientX));
  });
  zone.addEventListener('pointerup', e => {
    player.dragging = false;
    fill.classList.remove('dragging');
    applyPct(getPct(e.clientX));
  });
}
playerInitProgressDrag();

// ─── RÉSOLUTION STREAM ───────────────────────────────

// Tente de récupérer le contenu d'une URL via plusieurs proxies CORS
async function fetchText(url) {
  for (const proxy of PROXIES) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(proxy(url), { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) return await res.text();
    } catch(e) { /* essai suivant */ }
  }
  return null;
}

// Parse une playlist M3U/M3U8 et retourne la première URL de stream
function parseM3U(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('#') && (
      line.startsWith('http') ||
      line.includes('.m3u8') ||
      line.includes('.ts') ||
      line.includes('stream') ||
      line.includes('live')
    )) return line;
  }
  return null;
}

// Résout n'importe quelle URL stream vers une URL lisible par le player
async function resolveStreamUrl(url) {
  const isM3U  = url.endsWith('.m3u') || url.includes('.m3u?');
  const isM3U8 = url.endsWith('.m3u8') || url.includes('.m3u8?');

  if (isM3U) {
    // Playlist IPTV → parser pour extraire le vrai stream
    console.log('[KickStream] Parsing playlist M3U:', url);
    const text = await fetchText(url);
    if (!text) { console.warn('[KickStream] Impossible de lire la playlist'); return url; }
    const extracted = parseM3U(text);
    console.log('[KickStream] Stream extrait:', extracted);
    return extracted || url;
  }

  // M3U8 ou autre → utiliser directement
  return url;
}

// Charge un stream dans le <video> avec HLS.js si nécessaire
function loadStreamInPlayer(vid, url) {
  const isHLS = url.includes('.m3u8') || url.includes('.ts');

  if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    window._hls = hls;
    hls.loadSource(url);
    hls.attachMedia(vid);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      vid.play().then(() => playerSetPlayState(true)).catch(() => playerSetPlayState(false));
    });
    hls.on(Hls.Events.ERROR, (evt, data) => {
      if (data.fatal) {
        console.error('[HLS] Erreur fatale:', data.type, data.details);
        toast_('Erreur lecture stream');
      }
    });
  } else if (isHLS && vid.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari / iOS natif
    vid.src = url;
    vid.play().then(() => playerSetPlayState(true)).catch(() => playerSetPlayState(false));
  } else {
    vid.src = url;
    vid.play().then(() => playerSetPlayState(true)).catch(() => playerSetPlayState(false));
  }
}

// Ouvrir le lecteur
function openModal(m) {
  curMatch = m;
  const live = isLive(m), fin = isFin(m);
  const min  = getMin(m);
  const hn   = m.homeTeam.shortName || m.homeTeam.name;
  const an   = m.awayTeam.shortName || m.awayTeam.name;

  // Crests
  setCrest('hud-c1',   m.homeTeam.crest, hn);
  setCrest('hud-c2',   m.awayTeam.crest, an);
  setCrest('fb-crest1', m.homeTeam.crest, hn);
  setCrest('fb-crest2', m.awayTeam.crest, an);

  // Textes HUD
  const safe = el => { const e = $(el); if(e) return e; };
  safe('hud-n1') && ($('hud-n1').textContent  = hn);
  safe('hud-n2') && ($('hud-n2').textContent  = an);
  safe('fb-home') && ($('fb-home').textContent = hn);
  safe('fb-away') && ($('fb-away').textContent = an);

  const score  = getScore(m);
  const minTxt = min || (fin ? 'FT' : live ? 'LIVE' : fmtTime(m.utcDate));
  $('hud-sc').textContent   = score;
  $('fb-score').textContent = score;
  $('hud-min').textContent  = minTxt;
  $('fb-min').textContent   = minTxt;

  // Panneau info
  $('mi-league').textContent = m._cname;
  $('mi-title').textContent  = `${hn} — ${an}`;
  $('mi-sub').textContent    = live ? 'En direct' : fin ? 'Termine' : 'Coup d\'envoi ' + fmtTime(m.utcDate);
  $('pc-title').textContent  = `${hn} · ${an}`;

  playerSyncFavBtn();

  // Buts
  const goals = (m.goals_detail || []).filter(e => e.type === 'Goal');
  $('modal-evs').innerHTML = goals.length ? `
    <div class="modal-evs-wrap">
      <div class="modal-evs-title">Buts</div>
      <div class="ev-list">
        ${goals.map(g=>`
        <div class="ev-row">
          <span class="ev-min">${g.time?.elapsed??g.minute}'</span>
          <div class="ev-dot"></div>
          <div>
            <div class="ev-text">${g.scorer?.name||g.player?.name||'Inconnu'}</div>
            <div class="ev-sub">${g.team?.name||''}</div>
          </div>
        </div>`).join('')}
      </div>
    </div>` : '';

  // Video
  const vid = $('main-vid');
  // Détruire l'instance HLS précédente si elle existe
  if (window._hls) { window._hls.destroy(); window._hls = null; }

  if (m.streamUrl) {
    vid.style.display = 'block';
    $('m-fallback').style.display = 'none';
    toast_('Chargement du stream...');

    // Résoudre l'URL réelle (gère .m3u playlist IPTV et .m3u8 direct)
    resolveStreamUrl(m.streamUrl).then(finalUrl => {
      if (!finalUrl) {
        vid.style.display = 'none';
        $('m-fallback').style.display = 'flex';
        toast_('Stream indisponible');
        playerSetPlayState(false);
        return;
      }
      console.log('[KickStream] URL finale :', finalUrl);
      loadStreamInPlayer(vid, finalUrl);
    });
  } else {
    vid.src = ''; vid.style.display = 'none';
    $('m-fallback').style.display = 'flex';
    playerSetPlayState(false);
  }

  $('modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  playerShowCtrls();

  // Progression simulée
  clearInterval(player.timer);
  const startMin = m._status?.elapsed || 0;
  let tSec = startMin * 60;
  playerSetProgress(Math.min(99, startMin / 90 * 100));

  const tlEl = $('pc-time-left');
  const trEl = $('pc-time-right');
  if (tlEl) tlEl.textContent = live ? `${startMin}'` : fin ? 'FT' : fmtTime(m.utcDate);
  if (trEl) trEl.textContent = '';

  if (live) {
    player.timer = setInterval(() => {
      tSec++;
      playerSetProgress(Math.min(99, tSec / 5400 * 100));
      if (tlEl) tlEl.textContent = `${Math.floor(tSec / 60)}'`;
    }, 1000);
  } else {
    playerSetProgress(fin ? 100 : 0);
  }

  // Sync progression avec vraie vidéo
  vid.onplay  = () => playerSetPlayState(true);
  vid.onpause = () => playerSetPlayState(false);
  vid.ontimeupdate = () => {
    if (!player.dragging && vid.duration) {
      playerSetProgress(vid.currentTime / vid.duration * 100);
      const cur = Math.floor(vid.currentTime);
      const dur = Math.floor(vid.duration);
      if (tlEl) tlEl.textContent = fmtSecs(cur);
      if (trEl) trEl.textContent = '-' + fmtSecs(dur - cur);
    }
  };
}

function closeModal() {
  clearInterval(player.timer);
  clearTimeout(player.hideTimer);
  // Détruire HLS.js si actif
  if (window._hls) { window._hls.destroy(); window._hls = null; }
  const v = $('main-vid');
  if (v) { v.pause(); v.src = ''; v.onplay = v.onpause = v.ontimeupdate = null; }
  $('modal').style.display = 'none';
  document.body.style.overflow = '';
  curMatch = null;
  player.playing = false;
  player.fs = false;
  const ifs = $('ico-fs'), iefs = $('ico-exit-fs');
  if (ifs)  ifs.style.display  = '';
  if (iefs) iefs.style.display = 'none';
}

// ─── EVENTS LECTEUR ──────────────────────────────────
$('player-tap').addEventListener('click', () => {
  if ($('m-fallback').style.display !== 'none') return; // pas de vidéo, ignore
  player.ctrlsVisible ? playerTogglePlay() : playerShowCtrls();
});

$('mc-play').addEventListener('click',  () => playerTogglePlay());
$('pc-mute').addEventListener('click',  () => playerSetMute(!player.muted));

$('mc-q').addEventListener('click', () => {
  qi = (qi + 1) % QS.length;
  $('mc-q').textContent = QS[qi];
  toast_(`Qualite : ${QS[qi]}`);
  playerShowCtrls();
});

$('mc-pip').addEventListener('click', () => {
  const v = $('main-vid');
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});
  else if (v?.requestPictureInPicture)   v.requestPictureInPicture().catch(()=>toast_('PiP non disponible'));
  else toast_('PiP non disponible');
});

$('mc-fs').addEventListener('click', () => {
  const stage = $('player-stage'), v = $('main-vid');
  if (!player.fs) {
    const fn = stage.requestFullscreen || stage.webkitRequestFullscreen || v?.webkitEnterFullscreen;
    if (fn) { fn.call(stage)?.catch?.(()=>{}); }
    player.fs = true;
    $('ico-fs').style.display = 'none';
    $('ico-exit-fs').style.display = '';
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(()=>{});
    player.fs = false;
    $('ico-fs').style.display = '';
    $('ico-exit-fs').style.display = 'none';
  }
  playerShowCtrls();
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    player.fs = false;
    const ifs = $('ico-fs'), iefs = $('ico-exit-fs');
    if (ifs)  ifs.style.display  = '';
    if (iefs) iefs.style.display = 'none';
  }
});

$('mc-close-btn').addEventListener('click', closeModal);
$('mi-close').addEventListener('click',     closeModal);
$('player-stage').addEventListener('pointermove', () => { if (!player.dragging) playerShowCtrls(); });

$('mi-stats').addEventListener('click', () => toast_('Stats indisponibles'));
$('mi-fav').addEventListener('click',   () => { toggleFavCur(); playerSyncFavBtn(); });
$('mi-share').addEventListener('click', () => {
  if (navigator.share && curMatch) {
    navigator.share({ title:`${curMatch.homeTeam.name} vs ${curMatch.awayTeam.name}`, url:location.href }).catch(()=>{});
  } else toast_('Lien copie');
});

// ─── LEGAL ───────────────────────────────────────────
const LEGAL = {
  cgu:     { title:"Conditions d'utilisation", body:`<h4>1. Objet</h4><p>KickStream est une application mobile gratuite de scores de football en temps reel.</p><h4>2. Utilisation</h4><li>Usage personnel et non commercial uniquement.</li><li>KickStream ne peut etre tenu responsable des interruptions liees aux APIs tierces.</li><h4>3. Donnees</h4><p>Scores fournis par football-data.org et API-Football.</p><h4>4. Propriete intellectuelle</h4><p>Les logos appartiennent a leurs proprietaires respectifs.</p>` },
  privacy: { title:"Confidentialite", body:`<h4>Donnees collectees</h4><p>KickStream ne collecte <strong>aucune donnee personnelle</strong>. Aucun compte requis.</p><h4>Stockage local</h4><li>Matchs favoris (localStorage)</li><li>Index du proxy CORS actif</li><h4>Cookies</h4><p>Aucun cookie utilise.</p>` },
  sources: { title:"Sources des donnees", body:`<h4>football-data.org</h4><p>Scores, resultats, classements, programme pour toutes les ligues.</p><h4>API-Football</h4><p>Minutes exactes des matchs en direct, rafraichies toutes les 30 secondes.</p><h4>Frequence</h4><li>Programme : au demarrage + toutes les 60 s</li><li>Minutes live : toutes les 30 s</li>` },
  about:   { title:"A propos", body:`<h4>KickStream v3.2</h4><p>Application mobile de scores en direct. Fonctionne depuis n'importe quel navigateur sans installation.</p><h4>Technologies</h4><li>HTML5 · CSS3 · JavaScript pur</li><li>football-data.org API v4 + API-Football v3</li><li>Proxies CORS rotatifs</li><h4>Compatibilite</h4><p>Safari iOS, Chrome Android, Trebedit.</p>` },
};

function openLegal(key) {
  const l = LEGAL[key]; if (!l) return;
  $('legal-title').textContent = l.title;
  $('legal-body').innerHTML    = l.body;
  $('legal-ov').style.display  = 'flex';
}
function closeLegal() { $('legal-ov').style.display = 'none'; }
$('legal-close').onclick = closeLegal;
$('legal-ov').addEventListener('click', e => { if (e.target === $('legal-ov')) closeLegal(); });

// ─── NAV ─────────────────────────────────────────────
$('btn-search').onclick = () => setPage('search');
$('btn-notifs').onclick = () => setPage('notifs');
document.querySelectorAll('.bi[data-pg]').forEach(el =>
  el.addEventListener('click', () => setPage(el.dataset.pg))
);

// ─── SWIPE TO CLOSE ──────────────────────────────────
let tY0 = 0;
$('modal').addEventListener('touchstart', e => { tY0 = e.touches[0].clientY; }, {passive:true});
$('modal').addEventListener('touchmove',  e => {
  if (e.touches[0].clientY - tY0 > 90 && !player.dragging) closeModal();
}, {passive:true});

let lY0 = 0;
$('legal-sheet').addEventListener('touchstart', e => { lY0 = e.touches[0].clientY; }, {passive:true});
$('legal-sheet').addEventListener('touchmove',  e => { if (e.touches[0].clientY - lY0 > 80) closeLegal(); }, {passive:true});

// ─── KEYBOARD ────────────────────────────────────────
document.addEventListener('keydown', e => {
  const modalOpen = $('modal').style.display !== 'none';
  if (e.key === 'Escape') { closeModal(); closeLegal(); }
  if (modalOpen && e.key === ' ')           { e.preventDefault(); playerTogglePlay(); }
  if (modalOpen && e.key === 'ArrowRight')  { const v=$('main-vid'); if(v?.duration) v.currentTime=Math.min(v.duration,v.currentTime+10); }
  if (modalOpen && e.key === 'ArrowLeft')   { const v=$('main-vid'); if(v?.duration) v.currentTime=Math.max(0,v.currentTime-10); }
});

// ─── INIT ────────────────────────────────────────────
renderContent();
loadMatches();
