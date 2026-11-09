const $ = id => document.getElementById(id);
const C = 2 * Math.PI * 130, CA = 2 * Math.PI * 42;
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local day key: YYYY-MM-DD
const today = () => keyOf(new Date());
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

const el = {
  time: $('time'), sub: $('sub'), ring: $('ring'), mode: $('modeLabel'),
  start: $('startBtn'),
  brk: $('breakMin'), long: $('longMin'), every: $('longEvery'),
  aRing: $('aRing'), aPct: $('aPct'), aTime: $('aTime'), aOf: $('aOf')
};

/* ---------- Saved data ---------- */
// history: focused milliseconds per day { 'YYYY-MM-DD': ms }. It is the single source of truth for
// "today's achievement" and for the statistics page, and it is kept forever in this browser.
let history = store.get('history', null);
if (!history || typeof history !== 'object') {
  history = {};
  const old = store.get('achieved', 0), oldDay = store.get('achievedDate', null); // data from the previous version
  if (old > 0 && oldDay) history[oldDay] = Math.floor(old / 1000) * 1000;
  store.set('history', history);
}
let histDirty = false, lastHistSave = 0;
function saveHistory(force){
  if (!histDirty) return;
  const n = Date.now();
  if (force || n - lastHistSave >= 2000) { store.set('history', history); histDirty = false; lastHistSave = n; }
}

// tasks: { id, text, done, min (minutes, optional), asked }
let todos = store.get('todos', []);
todos.forEach(t => { if (!t.id) t.id = uid(); });
let activeId = store.get('activeTask', null); // the task the next focus period is made for
const saveTodos = () => store.set('todos', todos);
const taskById = id => todos.find(t => t.id === id);

const s = {
  mode: 'focus', running: false, paused: false,
  remaining: 0, total: 0, last: 0, timer: null, cycle: 0, waiting: false,
  taskId: null,   // task attached to the current focus period
  credited: 0,    // whole seconds of this focus period already added to the achievement
  achieved: history[today()] || 0 // ms, today
};

// The achievement counter is per day: it starts again from zero on a new day
let achievedDate = today();
let autoFocus = store.get('autoFocus', false); // start focus automatically after a break (off by default)
let autoBreak = store.get('autoBreak', true);  // start a break automatically after focus (on by default)
let fx = store.get('fx', true); // visual effects: gradients, animations and the theme wave (on by default)
document.body.classList.toggle('no-fx', !fx);
function dayCheck(){
  const t = today();
  if (t !== achievedDate) { achievedDate = t; s.achieved = history[t] || 0; }
}
function addFocus(ms){
  dayCheck();
  history[achievedDate] = (history[achievedDate] || 0) + ms;
  s.achieved = history[achievedDate];
  histDirty = true;
}

/* ---------- Theme ---------- */
document.documentElement.dataset.theme = store.get('theme', 'dark');
const setTheme = t => { document.documentElement.dataset.theme = t; store.set('theme', t); };
let waving = false;

// Circular waves spread from the button across the whole page while the new theme is revealed.
// A frozen copy of the page (old theme) sits on top and a growing hole in it shows the new theme.
function themeWaves(next, x, y){
  waving = true;
  const old = document.documentElement.dataset.theme, b = document.body.getBoundingClientRect();
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script').forEach(n => n.remove());
  clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  const src = document.body.querySelectorAll('input,textarea');
  clone.querySelectorAll('input,textarea').forEach((n, i) => { n.value = src[i].value; n.checked = src[i].checked; });
  Object.assign(clone.style, { position: 'absolute', margin: '0', left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
  clone.dataset.theme = old;

  const cover = document.createElement('div'); cover.className = 'wave-cover'; cover.append(clone);
  const box = document.createElement('div'); box.className = 'wave-rings';
  const color = next === 'dark' ? '#e2e5ea' : '#4a505a';
  const rings = [[0, 1], [110, .6], [220, .35]].map(([off, k]) => {
    const i = document.createElement('i'); i.style.setProperty('--wc', color); box.append(i); return { i, off, k };
  });
  [cover, box].forEach(n => { n.style.setProperty('--x', x + 'px'); n.style.setProperty('--y', y + 'px'); });
  cover.style.setProperty('--r', '0px');
  document.body.append(cover, box);

  // keep the frozen copy's running animations in step with the real page (no visible jump)
  const oa = document.body.getAnimations({ subtree: true }), ca = clone.getAnimations({ subtree: true });
  ca.forEach((a, i) => { if (oa[i] && oa[i].animationName === a.animationName) a.currentTime = oa[i].currentTime; });

  setTheme(next);
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 100, dur = 1400, t0 = performance.now();
  const frame = now => {
    const p = Math.min(1, (now - t0) / dur), R = (p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2) * end;
    cover.style.setProperty('--r', R + 'px');
    rings.forEach(({ i, off, k }) => {
      const d = Math.max(0, R - off) * 2;
      i.style.width = i.style.height = d + 'px';
      i.style.opacity = d > 20 ? k * (1 - p * p) : 0;
    });
    if (p < 1) requestAnimationFrame(frame); else { cover.remove(); box.remove(); waving = false; }
  };
  requestAnimationFrame(frame);
}

$('themeBtn').onclick = () => {
  if (waving) return;
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  if (!fx || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTheme(next);
  const r = $('themeBtn').getBoundingClientRect();
  themeWaves(next, r.left + r.width / 2, r.top + r.height / 2);
};

/* ---------- Helpers ---------- */
const clampMin = (input, def, max) => Math.min(max, Math.max(1, parseInt(input.value) || def));
const every = () => Math.min(12, Math.max(2, parseInt(el.every.value) || 4));
const shorten = (t, n = 26) => t.length > n ? t.slice(0, n - 1) + '…' : t;

// The focus length comes from the chosen task (its "I'll finish it within" time); 25 min if there is none.
function activeTask(){
  const timed = todos.filter(t => !t.done && t.min);
  return timed.find(t => t.id === activeId) || timed[0] || null;
}
const duration = mode => (mode === 'focus' ? ((activeTask() || {}).min || 0) : mode === 'long' ? clampMin(el.long, 15, 120) : clampMin(el.brk, 5, 60)) * 60000;
const lockedSel = () => s.running && s.mode === 'focus' && !s.waiting; // a focus period is counting (or paused midway)

function subText(){
  if (!s.running) { const t = activeTask(); return t ? `جاهز للبدء • ${shorten(t.text)}` : 'أضف مهمة بوقت لتبدأ'; }
  if (s.paused && s.waiting) return s.mode === 'focus' ? 'انتهت الراحة • اضغط بدء للتركيز' : 'انتهى التركيز • اضغط بدء للراحة';
  if (s.paused) return 'متوقف مؤقتاً';
  if (s.mode === 'focus') return `ركّز على مهمتك • الدورة ${s.cycle % every() + 1} من ${every()}`;
  return s.mode === 'long' ? 'استراحة طويلة، استرح جيداً' : 'خذ قسطاً من الراحة';
}

function saveTimer(){
  store.set('timer', { mode: s.mode, running: s.running, paused: s.paused, remaining: s.remaining, total: s.total, cycle: s.cycle, waiting: s.waiting, taskId: s.taskId });
}

function render(){
  const secs = Math.ceil(Math.max(0, s.remaining) / 1000);
  const noTask = !s.running && !s.total; // nothing to focus on yet
  el.time.textContent = noTask ? 'أضف مهمة للبدء' : `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  el.time.classList.toggle('idle', noTask);
  const clock = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  const elapsed = s.total ? 1 - s.remaining / s.total : 0;
  el.ring.style.strokeDasharray = C;
  el.ring.style.strokeDashoffset = C * (1 - Math.min(1, Math.max(0, elapsed)));
  document.title = s.running ? `${clock} • ${s.mode === 'focus' ? 'تركيز' : 'راحة'}` : 'همّة | مساعدك في الدراسة';
  renderAchieve();
  updateTaskBars();
  if (!statsEl.hidden) statsTick();
}

// The ring is today's focused time as a share of the total time of all the tasks.
const totalTaskMs = () => todos.reduce((a, t) => a + (t.min || 0), 0) * 60000;
function renderAchieve(){
  dayCheck();
  const t = Math.floor(s.achieved / 1000), goal = totalTaskMs();
  el.aTime.textContent = `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t % 3600 / 60))}:${pad(t % 60)}`;
  const p = goal ? Math.min(1, s.achieved / goal) : 0;
  el.aPct.textContent = Math.round(p * 100) + '%';
  el.aOf.textContent = goal ? `من ${fmtMin(goal / 60000)} (مجموع وقت مهامك)` : 'أضف مهامًا بوقت ليظهر تقدمك';
  el.aRing.style.strokeDashoffset = CA * (1 - p);
}

function setMode(mode, keep){
  s.mode = mode;
  if (!keep) {
    s.total = s.remaining = duration(mode);
    s.credited = 0;
    s.taskId = mode === 'focus' ? ((activeTask() || {}).id || null) : null;
  }
  document.body.classList.toggle('break', mode !== 'focus');
  el.mode.textContent = mode === 'focus' ? 'تركيز' : mode === 'long' ? 'استراحة طويلة' : 'استراحة';
  el.sub.textContent = subText();
  renderTodos();
}

/* ---------- Soft chime (Web Audio) ---------- */
let ctx;
function audio(){
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
  return ctx;
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, audio, { once: true }));

function chime(){
  const a = audio(); if (!a) return;
  const out = a.createGain(); out.gain.value = .55;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
  out.connect(lp); lp.connect(a.destination);
  const notes = [1046.5, 1318.5, 1568, 2093]; // C6 E6 G6 C7, a gentle rising arpeggio
  [0, 2.4].forEach((pass, p) => {
    notes.forEach((f, i) => {
      const t0 = a.currentTime + .05 + pass + i * .2, peak = (p ? .16 : .24) * (1 - i * .08);
      [[f, 1], [f * 2, .12]].forEach(([fr, v]) => {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = fr;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak * v, t0 + .03);
        g.gain.exponentialRampToValueAtTime(.0008, t0 + 2);
        o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 2.1);
      });
    });
  });
}

/* ---------- Ambient sounds (your own audio files, endless loop) ---------- */
// Waves = audio/1.mp3, Rain = audio/2.mp3. Put the two files inside the "audio" folder.
const SOUND_FILES = {
  waves: 'audio/1.mp3',
  rain: 'audio/2.mp3'
};

const live = {};
function paintSound(name){
  const b = document.querySelector(`.snd[data-sound="${name}"]`), on = !!live[name];
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
}
function setSound(name, on){
  if (on && !live[name]) {
    if (!SOUND_FILES[name]) return;
    const au = new Audio(SOUND_FILES[name]); au.loop = true; // loops forever until it is pressed again
    live[name] = au;
    const fail = () => { if (live[name] === au) { delete live[name]; paintSound(name); } }; // file missing / blocked
    au.addEventListener('error', fail);
    au.play().catch(fail);
  } else if (!on && live[name]) {
    live[name].pause(); delete live[name];
  }
  paintSound(name);
}
document.querySelectorAll('.snd').forEach(b => b.onclick = () => setSound(b.dataset.sound, !live[b.dataset.sound]));

/* ---------- Timer ---------- */
function tick(){
  if (!s.running || s.paused) return;
  const now = Date.now(), d = now - s.last; s.last = now;
  s.remaining -= d;
  if (s.mode === 'focus') {
    // The achievement is credited in whole seconds, exactly when the dial's seconds change, so the two always agree.
    const e = Math.min(Math.floor(s.total / 1000), Math.max(0, Math.floor((s.total - s.remaining) / 1000)));
    if (e > s.credited) { addFocus((e - s.credited) * 1000); s.credited = e; }
  }
  if (s.remaining <= 0){
    chime();
    if (s.mode === 'focus') { endFocusTask(); s.cycle++; setMode(s.cycle % every() === 0 ? 'long' : 'break'); }
    else { if (!activeTask()) { fullReset(); return; } setMode('focus'); } // no task left: back to waiting
    if (!(s.mode === 'focus' ? autoFocus : autoBreak)) { s.paused = true; s.waiting = true; ui(); } // wait for the user
    else if (s.mode === 'focus') beginFocusTask();
  }
  render(); saveTimer(); saveHistory();
}

function run(){
  clearInterval(s.timer);
  s.last = Date.now();
  s.timer = setInterval(tick, 200);
}

function start(){
  if (!activeTask()) return;
  audio();
  s.running = true; s.paused = false; s.waiting = false; s.cycle = 0;
  setMode('focus');
  beginFocusTask();
  run(); ui(); render(); saveTimer();
}

function togglePause(){
  s.paused = !s.paused;
  if (!s.paused) { s.last = Date.now(); if (s.waiting) { s.waiting = false; beginFocusTask(); } } // paused time is never counted
  ui(); render(); saveTimer();
}

function fullReset(){
  clearInterval(s.timer);
  s.running = false; s.paused = false; s.waiting = false; s.cycle = 0;
  setMode('focus');
  ui(); render(); saveTimer();
}

function ui(){
  const b = el.start;
  b.disabled = !s.running && !activeTask();
  if (!s.running) { b.textContent = 'بدء'; b.className = 'main-btn go'; }
  else if (s.paused) { b.textContent = s.waiting ? 'بدء' : 'استئناف'; b.className = 'main-btn go'; }
  else { b.textContent = 'إيقاف مؤقت'; b.className = 'main-btn stop'; }
  el.sub.textContent = subText();
  if (lockedSel() !== lastLock) renderTodos(); // the "choose" buttons appear / disappear with the lock
}

el.start.onclick = () => s.running ? togglePause() : start();

/* ---------- Settings ---------- */
const settingInputs = [[el.brk, 'breakMin', 5], [el.long, 'longMin', 15], [el.every, 'longEvery', 4]];
settingInputs.forEach(([inp, key, def]) => inp.value = store.get(key, def));

[el.brk, el.long, el.every].forEach(i => {
  i.addEventListener('input', () => store.set(settingInputs.find(x => x[0] === i)[1], i.value));
  i.addEventListener('change', () => {
    const m = i === el.brk ? 'break' : i === el.long ? 'long' : null;
    if (!s.running) setMode('focus');
    else if (m && m === s.mode) { // changing the active period's length applies now
      const d = duration(s.mode); s.remaining = Math.max(0, s.remaining + d - s.total); s.total = d;
    }
    render(); saveTimer();
  });
});
/* ---------- Settings drawer ---------- */
const drawer = $('drawer'), overlay = $('overlay'), notes = $('notes');
function toggleDrawer(open){
  drawer.classList.toggle('open', open); overlay.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  (open ? $('closeSettings') : $('gearBtn')).focus({ preventScroll: true });
}
$('gearBtn').onclick = () => toggleDrawer(true);
$('closeSettings').onclick = overlay.onclick = () => toggleDrawer(false);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (drawer.classList.contains('open')) toggleDrawer(false); else if (!statsEl.hidden) closeStats();
});
const cFocus = $('autoFocus'), cBreak = $('autoBreak');
cFocus.checked = autoFocus; cBreak.checked = autoBreak;
cFocus.onchange = () => { autoFocus = cFocus.checked; store.set('autoFocus', autoFocus); };
cBreak.onchange = () => { autoBreak = cBreak.checked; store.set('autoBreak', autoBreak); };
const cFx = $('fx');
cFx.checked = fx;
cFx.onchange = () => { fx = cFx.checked; store.set('fx', fx); document.body.classList.toggle('no-fx', !fx); };

/* ---------- Notes ---------- */
notes.value = store.get('notes', '');
notes.addEventListener('input', () => store.set('notes', notes.value));

/* ---------- Todo (each task can carry "I'll finish it within N minutes") ---------- */
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}س${m % 60 ? ' ' + (m % 60) + 'د' : ''}` : `${m}د`;
let taskEls = {}, lastLock = null, justAdded = null;

function renderTodos(){
  const ul = $('todoList'), st = ul.scrollTop;
  ul.innerHTML = ''; taskEls = {};
  $('empty').style.display = todos.length ? 'none' : 'block';
  const locked = lastLock = lockedSel(), act = activeTask();
  const curId = locked ? s.taskId : act && act.id;
  const timedCount = todos.filter(t => !t.done && t.min).length;

  todos.forEach(t => {
    const li = document.createElement('li');
    li.className = [t.done && 'done', !t.done && t.id === curId && t.min && 'current', t.id === justAdded && 'new'].filter(Boolean).join(' ');
    const row = document.createElement('div'); row.className = 'trow';
    const c = document.createElement('input'); c.type = 'checkbox'; c.className = 'chk'; c.checked = t.done;
    c.setAttribute('aria-label', 'إنجاز المهمة');
    c.onchange = () => { t.done = c.checked; t.asked = false; saveTodos(); renderTodos(); retarget(); };
    const sp = document.createElement('span'); sp.className = 'ttxt'; sp.textContent = t.text;
    row.append(c, sp);
    if (t.min) {
      const chip = document.createElement('span'); chip.className = 'tchip'; chip.textContent = '⏱ ' + fmtMin(t.min); row.append(chip);
      if (!t.done && timedCount > 1) {
        if (t.id === curId) { const b = document.createElement('span'); b.className = 'tcur'; b.textContent = 'الحالية'; row.append(b); }
        else if (!locked) {
          const b = document.createElement('button'); b.className = 'tsel'; b.textContent = 'اختيار'; b.title = 'اجعلها مهمة التركيز القادمة';
          b.onclick = () => { activeId = t.id; store.set('activeTask', activeId); renderTodos(); retarget(); };
          row.append(b);
        }
      }
    }
    const d = document.createElement('button'); d.className = 'del'; d.textContent = '×'; d.setAttribute('aria-label', 'حذف');
    d.onclick = () => {
      todos.splice(todos.indexOf(t), 1); saveTodos();
      if (s.taskId === t.id) { s.taskId = null; saveTimer(); }
      renderTodos(); retarget();
    };
    row.append(d); li.append(row);

    if (t.min && !t.done) { // the bar that shrinks while this task's focus period runs
      const bar = document.createElement('div'); bar.className = 'tbar'; bar.hidden = true;
      const trk = document.createElement('div'); trk.className = 'trk'; const fill = document.createElement('i'); trk.append(fill);
      const tx = document.createElement('small'); bar.append(trk, tx); li.append(bar);
      taskEls[t.id] = { bar, fill, tx };
    }
    if (t.asked && !t.done) { // time is up: did you finish?
      const q = document.createElement('div'); q.className = 'task-q';
      const msg = document.createElement('b'); msg.textContent = 'هل أنجزت مهمتك ؟';
      const yes = document.createElement('button'); yes.className = 'q-btn yes'; yes.textContent = 'نعم';
      const no = document.createElement('button'); no.className = 'q-btn'; no.textContent = 'ليس بعد';
      yes.onclick = () => { t.done = true; t.asked = false; saveTodos(); renderTodos(); retarget(); };
      no.onclick = () => { t.asked = false; saveTodos(); renderTodos(); };
      q.append(msg, yes, no); li.append(q);
    }
    ul.append(li);
  });
  ul.scrollTop = st; justAdded = null;
  updateTaskBars(); renderAchieve();
}

function updateTaskBars(){
  const on = s.running && s.mode === 'focus';
  for (const id in taskEls) {
    const e = taskEls[id], mine = on && s.taskId === id;
    e.bar.hidden = !mine;
    if (!mine) continue;
    const rem = Math.max(0, s.remaining), p = s.total ? rem / s.total : 0, secs = Math.ceil(rem / 1000);
    e.fill.style.width = (p * 100) + '%';
    e.bar.classList.toggle('low', p <= .2);
    e.tx.textContent = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  }
}

// a focus period starts / ends for the attached task
function beginFocusTask(){
  const t = s.mode === 'focus' && taskById(s.taskId);
  if (t && t.asked) { t.asked = false; saveTodos(); renderTodos(); }
}
function endFocusTask(){
  const t = taskById(s.taskId);
  if (t && !t.done) { t.asked = true; saveTodos(); }
}
// the focus length follows the chosen task while nothing is counting
function retarget(){
  if (lockedSel()) return;
  if (s.mode === 'focus') setMode('focus');
  render(); ui(); saveTimer();
}

const todoIn = $('todoInput'), todoH = $('todoH'), todoMin = $('todoMin'), addBtn = $('addBtn');
const taskMinutes = () => Math.min(720, (parseInt(todoH.value) || 0) * 60 + (parseInt(todoMin.value) || 0));
todoIn.addEventListener('input', () => { addBtn.hidden = !todoIn.value.trim(); }); // the + button appears only once something is typed
function addTodo(){
  const v = todoIn.value.trim(); if (!v) return;
  const min = taskMinutes();
  if (!min) { // every task needs its time
    const box = todoH.closest('.add-time'); box.classList.remove('bad'); void box.offsetWidth; box.classList.add('bad');
    todoMin.focus(); return;
  }
  const t = { id: uid(), text: v, done: false, min };
  todos.unshift(t); justAdded = t.id; saveTodos();
  if (!lockedSel()) { activeId = t.id; store.set('activeTask', activeId); } // the new task becomes the current one
  todoIn.value = todoH.value = todoMin.value = ''; addBtn.hidden = true;
  renderTodos(); retarget();
}
addBtn.onclick = addTodo;
[todoH, todoMin].forEach(i => i.addEventListener('input', () => todoH.closest('.add-time').classList.remove('bad')));
[todoIn, todoH, todoMin].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); }));

/* ---------- Statistics ---------- */
const statsEl = $('stats');
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']; // one-letter day names for narrow screens
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const weekStartDow = 6; // week starts on Saturday
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = d => addDays(d, -((d.getDay() - weekStartDow + 7) % 7));
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const dayMs = d => history[keyOf(d)] || 0;
const weekDays = ws => Array.from({ length: 7 }, (_, i) => addDays(ws, i));
const weekTotal = ws => weekDays(ws).reduce((a, d) => a + dayMs(d), 0);
const sameDay = (a, b) => a.getTime() === b.getTime();
const dateLabel = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtDur = ms => { const m = Math.round(ms / 60000), h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}س ${r}د` : `${h}س`) : `${m}د`; };
const fmtShort = ms => !ms ? '0' : ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}د` : `${(ms / 3600000).toFixed(1).replace(/\.0$/, '')}س`;

function firstDay(){
  const ks = Object.keys(history).filter(k => history[k] > 0).sort();
  const n = new Date(); return ks.length ? parseKey(ks[0]) : new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
// ▲ better / ▼ worse / ＝ same, with the difference
function chip(cur, prev, pct){
  const d = cur - prev;
  if (Math.abs(d) < 30000) return '<span class="chip same">＝ ثابت</span>';
  const p = pct && prev > 0 ? ` • <bdi dir="ltr">${Math.round(Math.abs(d) / prev * 100)}%</bdi>` : '';
  return d > 0 ? `<span class="chip up">▲ تحسّن ${fmtDur(d)}${p}</span>` : `<span class="chip down">▼ تراجع ${fmtDur(-d)}${p}</span>`;
}
function weekName(ws, curWs){
  const n = Math.round((curWs - ws) / (7 * 864e5));
  return n === 0 ? 'هذا الأسبوع' : n === 1 ? 'الأسبوع الماضي' : n === 2 ? 'قبل أسبوعين' : n <= 10 ? `قبل ${n} أسابيع` : `قبل ${n} أسبوعًا`;
}
function weekRange(ws){
  const a = ws, b = addDays(ws, 6), y = new Date().getFullYear();
  return `${dateLabel(a)}${a.getFullYear() !== y ? ' ' + a.getFullYear() : ''} – ${dateLabel(b)}${b.getFullYear() !== y ? ' ' + b.getFullYear() : ''}`;
}

let viewWeek = startOfWeek(new Date()), lastStat = '';
function renderStats(anim){
  if (statsEl.hidden) return;
  statsEl.classList.toggle('anim', !!anim);
  const n = new Date(), td = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const curWs = startOfWeek(td), first = firstDay(), firstWs = startOfWeek(first);
  const minWs = firstWs < curWs ? firstWs : curWs;
  if (viewWeek > curWs) viewWeek = curWs;
  if (viewWeek < minWs) viewWeek = minWs;
  const isCur = sameDay(viewWeek, curWs), days = weekDays(viewWeek), vals = days.map(dayMs);
  const total = vals.reduce((a, b) => a + b, 0), elapsed = days.filter(d => d <= td).length;
  const bi = vals.indexOf(Math.max(...vals)), best = vals[bi];
  const goalMs = 0;
  const hasPrev = viewWeek > firstWs, prevTotal = weekTotal(addDays(viewWeek, -7));

  $('wkTitle').textContent = weekName(viewWeek, curWs);
  $('wkRange').textContent = weekRange(viewWeek);
  $('wkPrev').disabled = viewWeek <= minWs;
  $('wkNext').disabled = viewWeek >= curWs;

  // summary tiles
  $('wkTiles').innerHTML = `
    <div class="tile main"><small>محصلة الأسبوع${isCur ? ' (حتى الآن)' : ''}</small><b>${fmtDur(total)}</b>
      ${hasPrev ? chip(total, prevTotal, true) + `<em>مقابل الأسبوع السابق (${fmtDur(prevTotal)})</em>` : '<em>أول أسبوع مسجّل</em>'}</div>
    <div class="tile"><small>المتوسط اليومي</small><b>${fmtDur(elapsed ? total / elapsed : 0)}</b></div>
    <div class="tile"><small>أفضل يوم</small><b>${best > 0 ? DAYS[days[bi].getDay()] : '—'}</b><em>${best > 0 ? fmtDur(best) : 'لا يوجد بعد'}</em></div>
    <div class="tile"><small>أيام الإنجاز</small><b>${vals.filter(v => v >= 60000).length} / ${elapsed}</b></div>`;

  // bar chart: hours per day
  const max = Math.max(...vals, goalMs, 3600000);
  $('wkChart').innerHTML = `
    <div class="plot"><div class="plot-in">
      ${goalMs ? `<div class="goal-line" style="bottom:${goalMs / max * 100}%"><span>الهدف ${fmtShort(goalMs)}</span></div>` : ''}
      ${days.map((d, i) => {
        const v = vals[i], fut = d > td, h = v ? Math.max(3, v / max * 100) : 0;
        return `<div class="col${fut ? ' fut' : ''}${sameDay(d, td) ? ' today' : ''}${goalMs && v >= goalMs ? ' hit' : ''}">
          ${fut ? '' : `<span class="val" style="bottom:calc(${h}% + 4px)">${fmtShort(v)}</span>`}
          <i class="bar" style="height:${h}%"></i></div>`;
      }).join('')}
    </div></div>
    <div class="xlab">${days.map(d => `<div class="xl${sameDay(d, td) ? ' today' : ''}"><b><span class="short">${SHORT[d.getDay()]}</span><span class="full">${DAYS[d.getDay()]}</span></b><small>${d.getDate()}</small></div>`).join('')}</div>`;

  // day by day: each day against the day before it
  const dmax = Math.max(...vals, goalMs, 1);
  $('dayList').innerHTML = days.map((d, i) => {
    const v = vals[i], fut = d > td, isToday = sameDay(d, td);
    let c = '';
    if (fut || d < first) c = '<span class="chip same">—</span>';
    else if (sameDay(d, first)) c = '<span class="chip same">بداية التسجيل</span>';
    else c = chip(v, dayMs(addDays(d, -1)), false);
    return `<li class="${fut ? 'fut' : ''}${isToday ? ' today' : ''}">
      <div class="d-name"><b>${DAYS[d.getDay()]}${goalMs && v >= goalMs ? ' <span class="tick" title="تحقق الهدف">✓</span>' : ''}</b><small>${dateLabel(d)}${isToday ? ' • اليوم' : ''}</small></div>
      <div class="d-bar"><i style="width:${fut ? 0 : v / dmax * 100}%"></i></div>
      <div class="d-val">${fut ? '—' : fmtDur(v)}</div>
      <div class="d-delta">${c}</div></li>`;
  }).join('');

  // every week since the first record
  const weeks = []; for (let w = curWs, k = 0; w >= minWs && k < 520; w = addDays(w, -7), k++) weeks.push(w);
  const totals = weeks.map(weekTotal), wmax = Math.max(...totals, 1), all = totals.reduce((a, b) => a + b, 0);
  $('allSub').textContent = `إجمالي ما أنجزته: ${fmtDur(all)} خلال ${weeks.length} ${weeks.length === 1 ? 'أسبوع' : weeks.length === 2 ? 'أسبوعين' : weeks.length <= 10 ? 'أسابيع' : 'أسبوعًا'} • كل أسبوع مقابل الذي قبله`;
  $('weekList').innerHTML = weeks.map((w, i) => {
    const t = totals[i], isFirst = w <= firstWs;
    const c = isFirst ? '<span class="chip same">أول أسبوع</span>' : chip(t, weekTotal(addDays(w, -7)), true);
    return `<li><button class="wk-row${sameDay(w, viewWeek) ? ' sel' : ''}" data-w="${keyOf(w)}">
      <div class="d-name"><b>${weekName(w, curWs)}</b><small>${weekRange(w)}</small></div>
      <div class="d-bar"><i style="width:${t / wmax * 100}%"></i></div>
      <div class="d-val">${fmtDur(t)}</div>
      <div class="d-delta">${c}</div></button></li>`;
  }).join('');
}

// live pill + refresh once a minute of new progress (the page itself updates every second elsewhere)
function statsTick(){
  const live = $('stLive');
  live.hidden = !s.running;
  if (s.running) live.textContent = `${pad(Math.floor(Math.ceil(Math.max(0, s.remaining) / 1000) / 60))}:${pad(Math.ceil(Math.max(0, s.remaining) / 1000) % 60)} • ${s.mode === 'focus' ? 'تركيز' : 'استراحة'}`;
  const k = Math.floor(s.achieved / 60000) + '|' + today();
  if (k !== lastStat) { lastStat = k; renderStats(false); }
}

function openStats(){
  if (drawer.classList.contains('open')) toggleDrawer(false);
  statsEl.hidden = false; document.body.classList.add('stats-open');
  viewWeek = startOfWeek(new Date()); lastStat = '';
  renderStats(true); statsTick();
  window.scrollTo(0, 0); $('statsClose').focus({ preventScroll: true });
}
function closeStats(){
  statsEl.hidden = true; document.body.classList.remove('stats-open');
  window.scrollTo(0, 0);
}
$('statsBtn').onclick = openStats;
$('statsClose').onclick = () => { closeStats(); $('statsBtn').focus({ preventScroll: true }); };
$('wkPrev').onclick = () => { viewWeek = addDays(viewWeek, -7); renderStats(true); };
$('wkNext').onclick = () => { viewWeek = addDays(viewWeek, 7); renderStats(true); };
$('weekList').onclick = e => {
  const b = e.target.closest('[data-w]'); if (!b) return;
  viewWeek = parseKey(b.dataset.w); renderStats(true);
  $('wkTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
/* ---------- Restore saved state ---------- */
const saved = store.get('timer', null);
if (saved && saved.running && ['focus', 'break', 'long'].includes(saved.mode) && saved.total > 0 && saved.remaining >= 0 && saved.remaining <= saved.total) {
  s.mode = saved.mode; s.total = saved.total; s.remaining = saved.remaining;
  s.cycle = saved.cycle || 0; s.running = true; s.paused = true; s.waiting = !!saved.waiting; // reopening always comes back paused, ready to resume
  s.taskId = s.mode === 'focus' && taskById(saved.taskId) ? saved.taskId : null;
  s.credited = s.mode === 'focus' ? Math.max(0, Math.floor((s.total - s.remaining) / 1000)) : 0;
  setMode(s.mode, true);
  run(); // continues from the exact point it was left at
} else {
  setMode('focus');
}
ui(); render(); renderTodos();

// save the exact position when the tab is closed or hidden
const flush = () => { tick(); saveTimer(); saveHistory(true); };
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else renderAchieve(); });

/* ---------- Entrance animation: the word grows in, then shrinks into the header while everything else appears ---------- */
(async function intro(){
  const body = document.body, screen = $('intro');
  const finish = () => { body.classList.remove('intro', 'hold-brand'); screen.remove(); };
  if (!fx || matchMedia('(prefers-reduced-motion: reduce)').matches || !screen.animate) return finish();
  try {
    await Promise.race([document.fonts ? document.fonts.ready : 0, new Promise(r => setTimeout(r, 1500))]);
    const brand = document.querySelector('.brand'), cs = getComputedStyle(brand), tgt = brand.getBoundingClientRect();
    const word = document.createElement('div'); word.className = 'intro-word'; word.textContent = brand.textContent;
    Object.assign(word.style, { fontSize: cs.fontSize, fontFamily: cs.fontFamily, visibility: 'hidden' });
    screen.append(word);
    const w0 = word.getBoundingClientRect().width;
    word.style.fontSize = parseFloat(cs.fontSize) * Math.min(innerWidth * .55, 560) / w0 + 'px'; // big, so it stays sharp when scaled down
    const r = word.getBoundingClientRect();
    word.style.left = (innerWidth - r.width) / 2 + 'px'; word.style.top = (innerHeight - r.height) / 2 + 'px';
    word.style.visibility = '';
    const k = tgt.width / r.width, dx = tgt.left + tgt.width / 2 - innerWidth / 2, dy = tgt.top + tgt.height / 2 - innerHeight / 2;
    const T = 2800, hold = .55, still = { opacity: 1, transform: 'translate(0px,0px) scale(1)', filter: 'blur(0px)', textShadow: '0 0 60px #e2e5ea' };
    const a = word.animate([
      { opacity: 0, transform: 'translate(0px,0px) scale(.85)', filter: 'blur(16px)', textShadow: '0 0 0 #e2e5ea', offset: 0, easing: 'cubic-bezier(.2,.8,.2,1)' },
      { ...still, offset: .3 },
      { ...still, offset: hold, easing: 'cubic-bezier(.7,0,.2,1)' },
      { opacity: 1, transform: `translate(${dx}px,${dy}px) scale(${k})`, filter: 'blur(0px)', textShadow: `0 0 ${22 / k}px #e2e5ea`, offset: 1 }
    ], { duration: T, fill: 'forwards' });
    screen.firstElementChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, delay: T * hold + 200, fill: 'forwards' });
    setTimeout(() => body.classList.remove('intro'), T * hold + 350); // the rest of the page appears as the word travels
    await a.finished;
  } catch {}
  finish();
})();


/* ---------- Rotating supplications: change every minute ---------- */
(function rotatingDua(){
  const duaEl = document.getElementById('rotatingDua');
  if (!duaEl) return;

  const duas = [
    'اللَّهُمَّ لَا سَهْلَ إِلَّا مَا جَعَلْتَهُ سَهْلًا، وَأَنْتَ تَجْعَلُ الْحَزْنَ إِذَا شِئْتَ سَهْلًا.',
    'وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ.',
    'اللَّهُمَّ يَا مُفَهِّمَ سُلَيْمَانَ فَهِّمْنِي، وَيَا مُعَلِّمَ آدَمَ عَلِّمْنِي.',
    'اللَّهُمَّ إِنِّي أَسْتَوْدِعُكَ مَا أَحْفَظُهُ لِحِينَ حَاجَتِي إِلَيْهِ.',
    'أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ الَّذِي لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ وَأَتُوبُ إِلَيْهِ.',
    'اللَّهُمَّ إِنِّي أَتَبَرَّأُ مِنْ حَوْلِي وَقُوَّتِي، وَأَسْتَعِينُ بِحَوْلِكَ وَقُوَّتِكَ.',
    'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ.',
    'اللَّهُمَّ صَلِّ وَسَلِّمْ وَبَارِكْ عَلَى نَبِيِّنَا مُحَمَّدٍ.',
    'يَا حَيُّ يَا قَيُّومُ، بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ، وَلَا تَكِلْنِي إِلَىٰ نَفْسِي طَرْفَةَ عَيْنٍ.',
    'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ.',
    'إِنَّ مَعِيَ رَبِّي سَيَهْدِينِ.',
    'إِنَّ مَعَ الْعُسْرِ يُسْرًا.',
    'رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِ.',
    'عَسَىٰ رَبِّي أَنْ يَهْدِيَنِي سَوَاءَ السَّبِيلِ.',
    'لَا تَدْرِي لَعَلَّ اللَّهَ يُحْدِثُ بَعْدَ ذَٰلِكَ أَمْرًا.',
    'إِنَّا لَا نُضِيعُ أَجْرَ مَنْ أَحْسَنَ عَمَلًا.',
    'سَيَجْعَلُ اللَّهُ بَعْدَ عُسْرٍ يُسْرًا.',
    'أَمَّنْ يُجِيبُ الْمُضْطَرَّ إِذَا دَعَاهُ.',
    'وَأَنْ لَيْسَ لِلْإِنْسَانِ إِلَّا مَا سَعَىٰ.',
    'وَاصْبِرْ لِحُكْمِ رَبِّكَ فَإِنَّكَ بِأَعْيُنِنَا.'
  ];

  let index = 0;
  duaEl.textContent = duas[index];

  window.setInterval(() => {
    duaEl.classList.add('dua-fade');
    window.setTimeout(() => {
      index = (index + 1) % duas.length;
      duaEl.textContent = duas[index];
      duaEl.classList.remove('dua-fade');
    }, 350);
  }, 60000);
})();
