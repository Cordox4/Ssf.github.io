// =====================================================
//  KICKSTREAM — app.js  v3.2 (corrigé)
// =====================================================

// ─── CONFIG ──────────────────────────────────────────
const FD_BASE = 'https://api.football-data.org/v4';
const AF_BASE = 'https://v3.football.api-sports.io';
const FD_KEY  = '2619f1b7ba494cc5a948cc6343d23a2e';
const AF_KEY  = '53227037b68f679a9lf2d4d8f68cd4c5';

const COMPS = {
  CL:  { name:'Champions League', short:'C.League',   flag:'https://crests.football-data.org/CL.png'  },
  EL:  { name:'Europa League',    short:'Europa',     flag:'https://crests.football-data.org/EL.png'  },
  PD:  { name:'La Liga',          short:'La Liga',    flag:'https://crests.football-data.org/PD.png'  },
  PL:  { name:'Premier League',   short:'Premier',    flag:'https://crests.football-data.org/PL.png'  },
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
    homeKeyword: 'barcelona',
    awayKeyword: 'newcastle',
    url: 'https://apsattv.com/ssungusa.m3u8',
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
        console.log('[KickStream] Stream assigné :', hn, 'vs', an);
      }
    }
  }
}

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
        const ft  = m.score?.fullTime;
        const ht  = m.score?.halfTime;
        m.goals   = { home: ft?.home ?? ht?.home ?? null, away: ft?.away ?? ht?.away ?? null };
        m._status = null;
        m._dayKey = dayKey(new Date(m.utcDate));
      }
      all.push(...res.matches);
    })
  );

  loading   = false;
  lastFetch = Date.now();
  all.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  assignManualStreams(all);

  data.byDate = {};
  for (const m of all) {
    if (!data.byDate[m._dayKey]) data.byDate[m._dayKey] = [];
    data.byDate[m._dayKey].push(m);
  }

  data.live = all.filter(isLive);
  const tk = todayKey();
  if (!selectedDate || !data.byDate[selectedDate]) selectedDate = tk;

  $('ndot').style.display = data.live.length ? 'block' : 'none';
  renderTicker();
  renderContent();
}

// ─── RENDER ─────────────────────────────────────────
function renderTicker() {
  const live = data.live;
  if (!live.length) {
    $('ticker').innerHTML = `<span class="t-item" style="color:var(--t3);font-size:11px">AUCUN MATCH EN DIRECT</span>`;
    return;
  }
  const lH = live.map(m => {
    const min = getMin(m);
    const hn  = m.homeTeam.shortName || m.homeTeam.name;
    const an  = m.awayTeam.shortName || m.awayTeam.name;
    return `<span class="t-item"><span class="t-live">● LIVE</span><span style="font-weight:600">${hn}</span><span class="t-sc">${getScore(m)}</span><span style="font-weight:600">${an}</span>${min?`<span style="color:var(--t3);font-size:10px">${min}</span>`:''}</span>`;
  }).join('');
  $('ticker').innerHTML = lH + lH;
}

// ─── PAGE ACCUEIL ───────────────────────────────────
function renderHome() {
  const sel  = selectedDate || todayKey();
  let   mAll = (data.byDate[sel] || []).slice();
  if (lgFilter !== 'all') mAll = mAll.filter(m => m._cid === lgFilter);
  const live = mAll.filter(isLive);
  const up   = mAll.filter(m => m.status === 'SCHEDULED' || m.status === 'TIMED');
  const fin  = mAll.filter(isFin);

  return `
  ${live.length ? `<div class="mlist">${live.map(m => `<div>${m.homeTeam.name} vs ${m.awayTeam.name} — <button onclick="playStream('${m.streamUrl}')">Regarder</button></div>`).join('')}</div>` : '<div>Aucun match en direct</div>'}
  `;
}

// ─── LECTEUR ───────────────────────────────────────
function playStream(url) {
  if (!url) return toast_('Aucun stream disponible');
  const playerEl = $('player');
  playerEl.innerHTML = `<video id="vid" controls autoplay style="width:100%;height:100%">
      <source src="${url}" type="application/x-mpegURL">
    </video>`;
  toast_('Lecture du match…');
}

// ─── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadMatches);