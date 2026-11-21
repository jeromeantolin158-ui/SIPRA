/* =========================================================
   CHORDIFY app.js
   Songs are saved in this browser (localStorage).
   ========================================================= */

const $ = id => document.getElementById(id);
const byTitle = (a, b) => a.title.localeCompare(b.title);

/* ---------- STORAGE (keys keep the old "sipra_" names so saved songs stay) ---------- */
const load = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; }
  catch (e) { return fallback; }
};
const save = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };

const sample = {
  id: "1", title: "Amazing Grace", key: "G",
  body: "[G]Amazing [C]grace, how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\n\n[G]I once was [C]lost, but [G]now am [D]found\n[G]Was blind but [D]now I [G]see"
};

let songs = load("sipra_songs", null) || [sample];
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* setlists: [{ id, name, date: "YYYY-MM-DD" or "", songs: [songId, ...] }] */
let setlists = load("chordify_setlists", null);
if (!setlists) {                                   // first run of this version: keep the old single setlist
  const old = load("sipra_setlist", []);
  setlists = old.length ? [{ id: newId(), name: load("chordify_setname", "") || "My setlist", date: "", songs: old }] : [];
  save("chordify_setlists", setlists);
}
let lastImport = load("sipra_undo", null);
let recent = load("sipra_recent", []);

const persist = () => save("sipra_songs", songs);
const saveSetlists = () => save("chordify_setlists", setlists);
const pruneSetlists = () => {                      // drop songs that were deleted
  setlists.forEach(l => { l.songs = l.songs.filter(id => songs.some(s => s.id === id)); });
  saveSetlists();
};
const saveRecent = () => save("sipra_recent", recent);
const saveUndo = () => {
  if (lastImport) save("sipra_undo", lastImport);
  else { try { localStorage.removeItem("sipra_undo"); } catch (e) {} }
};

/* ---------- STATE ---------- */
let current = null;
let steps = 0;
let capo = 0;
let currentSetId = null;                           // set when the song was opened from a setlist
let fs = Number(load("chordify_fs", 0)) || 0;      // song text size in px (0 = default)
let chordsMode = false;
let editingId = null;
let delIds = new Set();

/* ---------- TRANSPOSE ---------- */
const SHARPS = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const FLATS  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
const FLAT_KEYS = ["F","Bb","Eb","Ab","Db","Gb","Dm","Gm","Cm","Fm","Bbm","Ebm"];

function shiftNote(note, n, useFlats) {
  let i = SHARPS.indexOf(note);
  if (i === -1) i = FLATS.indexOf(note);
  if (i === -1) return note;
  return (useFlats ? FLATS : SHARPS)[((i + n) % 12 + 12) % 12];
}

function transposeChord(chord, n, useFlats = false) {
  return chord.replace(/[A-G][#b]?/g, x => shiftNote(x, n, useFlats));
}

function transposeSong(text, n, useFlats = false) {
  return text.replace(/\[([^\]]+)\]/g, (m, c) => c[0] === '"' ? m : `[${transposeChord(c, n, useFlats)}]`);
}

function flatsFor(key, n) {
  return key ? FLAT_KEYS.includes(transposeChord(key, n, true)) : false;
}

function normKey(k) {                       // "a" -> "A", "bbm" -> "Bbm"
  k = (k || "").trim();
  return k ? k[0].toUpperCase() + k.slice(1) : "";
}

/* ---------- CHORD TOKENS ---------- */
const CHORD = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#)?\d+)*(?:\/[A-G][#b]?)?$/;

const isMul = t => /^\(?\d+x\)?$/i.test(t) || /^x\d+$/i.test(t);          // 2x, (2x), x2
const isChordTok = t => t.split("-").every(c => CHORD.test(c));            // Em, C#m-Bm, G-A-Bm-C
const isNote = t => /^["“].*["”]$/.test(t);                                // "any reminder"
const isDash = t => /^[-–—]$/.test(t);                                     // a lone - between chords
const isTok = t => isChordTok(t) || isMul(t) || isNote(t) || isDash(t);
const tokenize = s => s.match(/["“][^"”]*["”]|\S+/g) || [];                // keeps "two words" together
const fmtTok = t => isDash(t) ? "[-]"
                  : isNote(t) ? `["${t.slice(1, -1).replace(/[\[\]]/g, "").trim()}"]`
                  : isMul(t) ? `[${t.replace(/\D/g, "")}x]` : `[${t}]`;

/* ---------- SECTION NAMES ---------- */
const NAMES = "pre[- ]?chorus|post[- ]?chorus|chorus|verses?|bridges?|medley|refrain|intro|outro|interlude|instrumental";
const NAMES_ALL = NAMES + "|last";          // Import and display labels. Add more here, like |ending|tag

const LABEL_RE = new RegExp(
  "(?:[\\[(]\\s*(?:" + NAMES + ")\\s*\\d*\\s*[\\])]\\s*:?" +
  "|\\b(?:" + NAMES + ")\\s*(?:\\d+\\s*:?|:)" +
  "|^[ \\t]*(?:" + NAMES + ")\\b[ \\t]*\\d*[ \\t]*:?)[ \\t]*\\n?",
  "gim"
);

const SECTION_LINE = new RegExp("^(?:" + NAMES_ALL + ")(?:\\s*\\d+)?:?$", "i");

// "VERSE 1:" -> "[Verse 1]"
const labelText = l => "[" + l.replace(/:$/, "").toLowerCase().replace(/(^|[ -])\w/g, c => c.toUpperCase()) + "]";

const stripChords = t => t.replace(/\[[^\]]*\]/g, "");

/* ---------- TIDY (paste or button) ---------- */
function markChords(text) {
  const tokens = text.match(/\S+/g);
  if (!tokens) return text;
  if (!tokens.some(isChordTok) || !tokens.every(t => isChordTok(t) || isMul(t))) return text;

  if (tokens.some(isMul)) {                     // keep repeats as [4x], also in the middle of a line
    return tokens.map(t => isMul(t) ? `[${t.replace(/\D/g, "")}x]` : `[${t}]`).join(" ");
  }
  return text.replace(/\S+/g, t => `[${t}]`);   // keeps spacing so chords stay above the right words
}

function htmlToChordText(root) {
  let out = "";
  const BLOCK = /^(P|DIV|LI|TR|H[1-6]|PRE)$/;

  (function walk(node, bold) {
    if (node.nodeType === 3) {
      out += bold ? markChords(node.nodeValue) : node.nodeValue;
      return;
    }
    if (node.nodeType !== 1 || /^(STYLE|SCRIPT)$/.test(node.tagName)) return;

    const w = node.style && node.style.fontWeight;
    if (w) bold = w === "bold" || w === "bolder" || parseInt(w) >= 600;
    else if (/^(B|STRONG)$/.test(node.tagName)) bold = true;

    if (node.tagName === "BR") { out += "\n"; return; }

    node.childNodes.forEach(c => walk(c, bold));
    if (BLOCK.test(node.tagName)) out += "\n";
  })(root, false);

  return out.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n");
}

// chords on their own line above the lyrics -> placed inside the lyric line
const isChordLine = l => /\[[^\]]+\]/.test(l) && stripChords(l).trim() === "";

function mergeChordLines(text) {
  const lines = text.split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];

    if (isChordLine(lines[i]) && next !== undefined && next.trim() !== "" && !isChordLine(next)) {
      const marks = [];
      let col = 0;
      lines[i].replace(/\[([^\]]+)\]|[^\[]/g, (m, chord) => {
        if (chord) { marks.push({ col, chord }); col += chord.length; }
        else col += 1;
      });

      // one segment per lyric phrase (phrases are separated by 3+ spaces)
      const segs = [];
      next.replace(/\S+(?: {1,2}\S+)*/g, (m, idx) => {
        segs.push({ start: idx, end: idx + m.length, text: m, marks: [] });
      });

      // give each chord to a phrase; a chord in a gap goes to the nearer phrase
      marks.forEach(mk => {
        let k = segs.findIndex(s => mk.col < s.start);
        if (k === -1) k = segs.length - 1;
        else if (k > 0) {
          const gapToPrev = mk.col - segs[k - 1].end;
          if (gapToPrev < 0 || gapToPrev <= segs[k].start - mk.col) k--;
        }
        segs[k].marks.push(mk);
      });

      segs.forEach(s => {
        let lyric = s.text;
        s.marks.sort((a, b) => b.col - a.col).forEach(({ col, chord }) => {
          const rel = Math.max(0, col - s.start);
          if (lyric.length < rel) lyric = lyric.padEnd(rel);
          lyric = lyric.slice(0, rel) + `[${chord}]` + lyric.slice(rel);
        });
        out.push(lyric);
      });

      i++;
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n");
}

function tidy(text) {
  text = text.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(LABEL_RE, m => {
    const name = m.match(new RegExp(NAMES, "i"))[0].toUpperCase()
      .replace(/^(VERSE|BRIDGE)S$/, "$1")
      .replace(/^PRE[- ]?CHORUS$/, "PRE-CHORUS");
    const num = (m.match(/\d+/) || [""])[0];
    return "\n\n" + name + (num ? " " + num : "") + ":\n";
  });

  text = text.split("\n").map(markChords).join("\n");

  return mergeChordLines(text)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tidyBox() {
  $("fBody").value = tidy($("fBody").value);
  toast("Formatted");
}

/* ---------- SHOW A SONG (chords above lyrics, or chords only) ---------- */
function maxChars() {
  const cs = getComputedStyle($("out"));
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;" +
    `font-family:${cs.fontFamily};font-size:${cs.fontSize};font-weight:400`;
  probe.textContent = "0".repeat(10);
  $("out").appendChild(probe);
  const w = probe.getBoundingClientRect().width / 10;
  probe.remove();
  return Math.max(20, Math.floor($("out").clientWidth / w) - 1);
}

function wrapPair(chords, lyric, W) {
  const total = Math.max(chords.length, lyric.length);
  const rows = [];
  let start = 0;

  while (start < total) {
    let cut = Math.min(start + W, total);

    if (cut < total) {
      const ok = p =>
        !(chords[p - 1] && chords[p - 1] !== " " && chords[p] && chords[p] !== " ") &&
        (p >= lyric.length || lyric[p] === " " || lyric[p - 1] === " ");

      let p = cut;
      while (p > start + 1 && !ok(p)) p--;
      if (p > start + 1) cut = p;
    }

    const cRow = chords.slice(start, cut).trimEnd();
    const lRow = lyric.slice(start, cut).trimEnd();

    if (cRow) rows.push({ t: "chord", s: cRow });
    if (lRow) rows.push({ t: "lyric", s: lRow });

    start = cut;
    while (start < total && (chords[start] || " ") === " " && (lyric[start] || " ") === " ") start++;
  }
  return rows;
}

function chordsAbove(text) {
  const W = maxChars();
  const rows = [];

  text.split("\n").forEach(line => {
    const trimmed = line.trim();

    if (SECTION_LINE.test(trimmed)) { rows.push({ t: "label", s: labelText(trimmed) }); return; }

    if (!/\[[^\]]+\]/.test(line)) {
      rows.push(trimmed ? { t: "lyric", s: line } : { t: "blank" });
      return;
    }

    let lyric = "", chords = "";
    line.replace(/\[([^\]]+)\]|([^\[]+)/g, (m, chord, txt) => {
      if (chord) {
        if (chords) chords += " ";
        chords = chords.padEnd(lyric.length) + chord;
      } else {
        lyric += txt;
      }
    });

    rows.push(...wrapPair(chords, lyric, W));
  });
  return rows;
}

const chordsOnly = t => {
  const rows = [];
  let pendingLabel = "";
  let indent = 0;

  t.split("\n").forEach(line => {
    const trimmed = line.trim();

    if (SECTION_LINE.test(trimmed)) {
      pendingLabel = labelText(trimmed).slice(1, -1) + ":";
      indent = pendingLabel.length + 1;
      return;
    }
    if (!trimmed) return;

    const chords = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    if (!chords.length) return;

    if (pendingLabel) {
      rows.push({ t: "cline", label: pendingLabel, s: chords.join(" ") });
      pendingLabel = "";
    } else {
      rows.push({ t: "ccont", s: chords.join(" "), indent });
    }
  });
  return rows;
};

function paint(rows) {
  const box = $("out");
  box.innerHTML = "";

  rows.forEach(r => {
    const d = document.createElement("div");
    d.className = r.t;

    if (r.label) {                              // bold section name, normal chords
      const b = document.createElement("b");
      b.textContent = r.label;
      d.appendChild(b);
      d.appendChild(document.createTextNode(" " + r.s));
    } else {
      d.textContent = r.s || " ";
      if (r.indent) d.style.paddingLeft = r.indent + "ch";
    }
    box.appendChild(d);
  });
}

function render() {
  const k = normKey(current.key);
  const n = steps - capo;                           // capo: show the shapes you play, not the sounding chords
  const t = transposeSong(current.body, n, flatsFor(k, n));
  $("songTitle").textContent = current.title;
  $("out").style.fontSize = fs ? fs + "px" : "";
  paint(chordsMode ? chordsOnly(t) : chordsAbove(t));
  const sounding = k ? transposeChord(k, steps, flatsFor(k, steps)) : "-";
  const shapes = k ? transposeChord(k, n, flatsFor(k, n)) : "";
  $("keyLabel").textContent = sounding;
  $("capoLabel").textContent = capo;
  $("capoNote").textContent = capo && k ? "play " + shapes : "";
  const note = (current.note || "").trim();
  $("songNote").classList.toggle("hidden", !note);
  $("songNoteText").textContent = note;
  $("modeBtn").textContent = chordsMode ? "Full song" : "Chords only";
}

function shift(n) { steps += n; render(); }
function changeCapo(d) { capo = Math.min(11, Math.max(0, capo + d)); render(); }
function changeFs(d) {
  if (!fs) fs = parseFloat(getComputedStyle($("out")).fontSize) || 18;
  fs = Math.min(44, Math.max(12, fs + d));
  save("chordify_fs", fs);
  render();
}
function toggleMode() { chordsMode = !chordsMode; render(); }

window.addEventListener("resize", () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => { if (currentView === "songView" && current) render(); }, 150);
});

/* ---------- AUTO SCROLL ---------- */
let scrolling = false, speed = 30, pos = 0, lastTime = 0;

function tick(time) {
  if (!scrolling) return;
  if (lastTime) {
    pos += speed * (time - lastTime) / 1000;
    window.scrollTo(0, pos);
  }
  lastTime = time;
  if (pos >= document.body.scrollHeight - window.innerHeight) { stopScroll(); return; }
  requestAnimationFrame(tick);
}

function startScroll() {
  if (scrolling) return;
  scrolling = true;
  pos = window.scrollY;
  lastTime = 0;
  $("scrollBtn").textContent = "Stop scroll";
  keepAwake(true);
  requestAnimationFrame(tick);
}

function stopScroll() {
  scrolling = false;
  $("scrollBtn").textContent = "Start scroll";
  keepAwake(false);
}

function toggleScroll() { scrolling ? stopScroll() : startScroll(); }
function setSpeed(v) { speed = Number(v); }

/* keep the screen awake while scrolling */
let wakeLock = null;

async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && scrolling) keepAwake(true);
});

/* ---------- SMALL UI HELPERS ---------- */
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

function ask(msg, okLabel = "Confirm") {
  return new Promise(resolve => {
    const d = $("dlg");
    $("dlgMsg").textContent = msg;
    $("dlgOk").textContent = okLabel;
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue === "ok");
    $("dlgOk").onclick = () => d.close("ok");
    $("dlgNo").onclick = () => d.close("no");
    d.showModal();
  });
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("sipra_theme", next); } catch (e) {}
  syncThemeBtn();
}

function syncThemeBtn() {
  $("themeBtn").textContent = document.documentElement.dataset.theme === "light" ? "Dark" : "Light";
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/* ---------- SONG CARDS ---------- */
function previewChords(s) {
  return (s.body.match(/\[([^\]"]+)\]/g) || [])
    .map(x => x.slice(1, -1))
    .filter(x => !isMul(x) && x !== "-")
    .slice(0, 6).join(" ");
}

function songCard(s, index) {
  const card = el("article", "song-card");
  card.tabIndex = 0;
  card.setAttribute("role", "link");

  const top = el("div", "card-top");
  top.appendChild(el("span", "idx", String(index + 1).padStart(2, "0")));
  if (s.key) top.appendChild(el("span", "key-chip", "Key " + s.key));
  card.appendChild(top);

  card.appendChild(el("h3", "display", s.title));
  card.appendChild(el("p", "preview", previewChords(s) || "Open to play"));

  const foot = el("div", "card-foot");
  foot.appendChild(el("span", "play", "Play song ↗"));
  card.appendChild(foot);

  const open = () => go("song/" + s.id);
  card.onclick = open;
  card.onkeydown = e => { if (e.key === "Enter" && e.target === card) open(); };
  return card;
}

/* ---------- HOME ("On repeat") ---------- */
function renderHome() {
  const box = $("repeatGrid");
  box.innerHTML = "";

  const recentSongs = recent.map(id => songs.find(s => s.id === id)).filter(Boolean);
  const rest = songs.filter(s => !recentSongs.includes(s)).sort(byTitle);
  const pick = [...recentSongs, ...rest].slice(0, 3);

  if (!pick.length) {
    box.appendChild(el("p", "empty", "No songs yet. Open Manage to add your first song."));
    return;
  }
  pick.forEach((s, i) => box.appendChild(songCard(s, i)));
}

/* ---------- SONGS (read-only) ---------- */
function renderSongs() {
  const raw = $("songsSearch").value.trim();
  const q = raw.toLowerCase();
  const found = songs
    .filter(s => (s.title + " " + stripChords(s.body)).toLowerCase().includes(q))
    .sort(byTitle);

  $("songsInfo").textContent = q ? `${found.length} result${found.length === 1 ? "" : "s"} for "${raw}"` : `${songs.length} song${songs.length === 1 ? "" : "s"}`;
  $("setCount").textContent = setlists.length;

  const grid = $("songGrid");
  grid.innerHTML = "";
  if (!found.length) { grid.appendChild(el("p", "empty", "No songs found")); return; }
  found.forEach((s, i) => grid.appendChild(songCard(s, i)));
}

function openSong(s, setId) {
  current = s;
  currentSetId = setId && getSetlist(setId) ? setId : null;
  steps = 0;
  capo = 0;
  chordsMode = false;
  recent = [s.id, ...recent.filter(id => id !== s.id)].slice(0, 6);
  saveRecent();
  page("songView");
  render();
  updateSetNav();
}

/* previous / next song when the song was opened from a setlist */
function updateSetNav() {
  const l = currentSetId ? getSetlist(currentSetId) : null;
  const i = l ? l.songs.indexOf(current.id) : -1;
  const inSet = !!l && i !== -1;
  if (!inSet) currentSetId = null;

  $("backBtn").dataset.go = inSet ? "setlist/" + l.id : "songs";
  ["setNav", "setNavEnd"].forEach(id => {
    const box = $(id);
    box.classList.toggle("hidden", !inSet);
    if (!inSet) return;
    box.querySelector(".set-nav-title").innerHTML = "";
    const b = document.createElement("b");
    b.textContent = l.name;
    box.querySelector(".set-nav-title").append(b, ` · song ${i + 1} of ${l.songs.length}`);
  });
  [["prevBtn", "prevBtn2"], ["nextBtn", "nextBtn2"]].forEach(([a, b], n) => {
    const off = !inSet || (n === 0 ? i <= 0 : i >= l.songs.length - 1);
    $(a).disabled = off;
    $(b).disabled = off;
  });
}

function stepSetlist(d) {
  const l = currentSetId && getSetlist(currentSetId);
  if (!l) return;
  const next = l.songs[l.songs.indexOf(current.id) + d];
  if (next) go("song/" + next + "/" + l.id);
}

/* ---------- SETLISTS (many; each has a name, a date and ordered songs) ---------- */
const getSetlist = id => setlists.find(l => l.id === id);

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const songTitle = id => (songs.find(s => s.id === id) || {}).title || "";

/* --- list of all setlists --- */
function renderSetlists() {
  pruneSetlists();
  const grid = $("setlistsGrid");
  grid.innerHTML = "";
  $("setlistsInfo").textContent = setlists.length ? `${setlists.length} setlist${setlists.length === 1 ? "" : "s"}` : "";

  if (!setlists.length) {
    grid.appendChild(el("p", "empty", "No setlists yet. Create one for your next service."));
    return;
  }
  [...setlists].sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.name.localeCompare(b.name)).forEach(l => {
    const card = el("article", "song-card");
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    const top = el("div", "card-top");
    top.appendChild(el("span", "idx", `${l.songs.length} song${l.songs.length === 1 ? "" : "s"}`));
    if (l.date) top.appendChild(el("span", "key-chip", fmtDate(l.date)));
    card.appendChild(top);
    card.appendChild(el("h3", "display", l.name));
    card.appendChild(el("p", "preview", l.songs.slice(0, 3).map(songTitle).join(" · ") || "No songs yet"));
    const foot = el("div", "card-foot");
    foot.appendChild(el("span", "play", "Open setlist ↗"));
    card.appendChild(foot);
    const open = () => go("setlist/" + l.id);
    card.onclick = open;
    card.onkeydown = e => { if (e.key === "Enter" && e.target === card) open(); };
    grid.appendChild(card);
  });
}

/* --- one setlist --- */
let viewId = null;

function renderSetlistView(id) {
  pruneSetlists();
  const l = getSetlist(id);
  if (!l) { go("setlists"); return; }
  viewId = id;
  $("slvEyebrow").textContent = l.date ? fmtDate(l.date) : "Setlist";
  $("slvTitle").textContent = l.name;
  $("slvMeta").textContent = `${l.songs.length} song${l.songs.length === 1 ? "" : "s"}`;

  const ul = $("slvItems");
  ul.innerHTML = "";
  if (!l.songs.length) { ul.appendChild(el("li", "", "No songs yet. Press Edit to add some.")); return; }
  l.songs.forEach((sid, i) => {
    const s = songs.find(x => x.id === sid);
    const li = el("li", "clickable");
    li.appendChild(el("span", "idx", String(i + 1).padStart(2, "0")));
    li.appendChild(el("span", "grow", s.title));
    if (s.key) li.appendChild(el("span", "key", s.key));
    li.onclick = () => go("song/" + sid + "/" + id);
    ul.appendChild(li);
  });
}

async function deleteSetlist() {
  const l = getSetlist(viewId);
  if (!l) return;
  if (!(await ask(`Delete the setlist "${l.name}"? The songs stay in your library.`, "Delete"))) return;
  setlists = setlists.filter(x => x.id !== viewId);
  saveSetlists();
  toast("Setlist deleted");
  go("setlists");
}

/* --- create / edit --- */
let draft = null;
let dragFrom = null;

function openSetlistEditor(id) {
  const ex = id ? getSetlist(id) : null;
  if (id && !ex) { go("setlists"); return; }
  draft = ex
    ? { id: ex.id, songs: ex.songs.filter(sid => songs.some(s => s.id === sid)) }
    : { id: null, songs: [] };
  $("slHeading").textContent = ex ? "Edit setlist" : "Create setlist";
  $("slName").value = ex ? ex.name : "";
  $("slDate").value = ex ? ex.date : "";
  $("pickSearch").value = "";
  page("setEditView");
  renderPicker();
  renderDraft();
}

function renderPicker() {
  const raw = $("pickSearch").value.trim();
  const q = raw.toLowerCase();
  const found = songs
    .filter(s => (s.title + " " + stripChords(s.body)).toLowerCase().includes(q))
    .sort(byTitle);

  $("pickInfo").textContent = q ? `${found.length} result${found.length === 1 ? "" : "s"} for "${raw}"` : `${songs.length} song${songs.length === 1 ? "" : "s"}`;
  const ul = $("pickList");
  ul.innerHTML = "";
  if (!found.length) { ul.appendChild(el("li", "", "No songs found")); return; }

  found.forEach(s => {
    const on = draft.songs.includes(s.id);
    const li = el("li", "clickable");
    li.appendChild(el("span", "grow", s.title));
    if (s.key) li.appendChild(el("span", "key", s.key));
    const b = el("button", "mini" + (on ? " on" : ""), on ? "✓ Added" : "+ Add");
    b.type = "button";
    li.appendChild(b);
    li.onclick = () => {
      const i = draft.songs.indexOf(s.id);
      i === -1 ? draft.songs.push(s.id) : draft.songs.splice(i, 1);
      renderPicker();
      renderDraft();
    };
    ul.appendChild(li);
  });
}

function renderDraft() {
  $("slCount").textContent = draft.songs.length;
  const ul = $("slItems");
  ul.innerHTML = "";
  if (!draft.songs.length) {
    ul.appendChild(el("li", "", "Nothing yet. Search for a song and press + Add."));
    return;
  }

  draft.songs.forEach((id, i) => {
    const s = songs.find(x => x.id === id);
    const li = el("li");
    li.draggable = true;
    li.addEventListener("dragstart", e => {
      dragFrom = i;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
    });
    li.addEventListener("dragend", () => { li.classList.remove("dragging"); dragFrom = null; });
    li.addEventListener("dragover", e => { e.preventDefault(); li.classList.add("over"); });
    li.addEventListener("dragleave", () => li.classList.remove("over"));
    li.addEventListener("drop", e => {
      e.preventDefault();
      if (dragFrom === null || dragFrom === i) return;
      const [m] = draft.songs.splice(dragFrom, 1);
      draft.songs.splice(i, 0, m);
      dragFrom = null;
      renderDraft();
    });

    li.appendChild(el("span", "grip", "⋮⋮"));
    li.appendChild(el("span", "idx", String(i + 1).padStart(2, "0")));
    li.appendChild(el("span", "grow", s.title));
    if (s.key) li.appendChild(el("span", "key", s.key));

    const mk = (txt, label, fn) => {
      const b = el("button", "mini", txt);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.onclick = fn;
      return b;
    };
    li.appendChild(mk("↑", "Move up", () => moveDraft(i, -1)));
    li.appendChild(mk("↓", "Move down", () => moveDraft(i, 1)));
    li.appendChild(mk("✕", "Remove", () => { draft.songs.splice(i, 1); renderPicker(); renderDraft(); }));
    ul.appendChild(li);
  });
}

function moveDraft(i, d) {
  const j = i + d;
  if (j < 0 || j >= draft.songs.length) return;
  [draft.songs[i], draft.songs[j]] = [draft.songs[j], draft.songs[i]];
  renderDraft();
}

function saveSetlistDraft() {
  const name = $("slName").value.trim();
  if (!name) { toast("Give the setlist a name"); $("slName").focus(); return; }
  const data = { name, date: $("slDate").value, songs: draft.songs.slice() };
  let id = draft.id;
  if (id) Object.assign(getSetlist(id), data);
  else { id = newId(); setlists.push({ id, ...data }); }
  saveSetlists();
  toast("Setlist saved");
  go("setlist/" + id);
}

/* ---------- MANAGE ---------- */
function renderManage() {
  const has = !!lastImport;
  $("undoBtn").disabled = !has;
  $("undoNote").textContent = has
    ? `${lastImport.added.length} added, ${lastImport.updated.length} replaced`
    : "Nothing to undo";

  const ul = $("manageList");
  ul.innerHTML = "";
  if (!songs.length) { ul.appendChild(el("li", "", "No songs yet. Add your first song above.")); return; }

  songs.slice().sort(byTitle).forEach(s => {
    const li = el("li");
    li.appendChild(el("span", "grow", s.title));
    if (s.key) li.appendChild(el("span", "key", s.key));
    const b = el("button", "mini", "Edit");
    b.onclick = () => go("edit/" + s.id);
    li.appendChild(b);
    ul.appendChild(li);
  });
}

/* ---------- ADD / EDIT / DELETE ONE SONG ---------- */
function openEditor(id) {
  const s = songs.find(x => x.id === id);
  if (id && !s) { go("manage"); return; }

  editingId = s ? s.id : null;
  $("editHeading").textContent = s ? "Edit song" : "Add song";
  $("fTitle").value = s ? s.title : "";
  $("fKey").value = s ? s.key : "";
  $("fNote").value = s ? (s.note || "") : "";
  $("fBody").value = s ? s.body : "";
  $("delBtn").classList.toggle("hidden", !s);
  page("editView");
}

function saveSong() {
  const title = $("fTitle").value.trim();
  if (!title) { toast("Title is required"); $("fTitle").focus(); return; }

  let s = songs.find(x => x.id === editingId);
  if (!s) { s = { id: Date.now().toString() }; songs.push(s); }

  s.title = title;
  s.key = normKey($("fKey").value);
  s.note = $("fNote").value.trim();
  s.body = $("fBody").value;

  persist();
  toast("Song saved");
  go("song/" + s.id);
}

async function deleteSong() {
  if (!(await ask("Delete this song? This can't be undone.", "Delete"))) return;
  songs = songs.filter(s => s.id !== editingId);
  recent = recent.filter(id => id !== editingId);
  persist(); pruneSetlists(); saveRecent();
  toast("Song deleted");
  go("manage");
}

/* ---------- SELECT TO DELETE ---------- */
function startDelete() {
  delIds = new Set();
  page("deleteView");
  renderDelete();
}

function renderDelete() {
  const ul = $("deleteList");
  ul.innerHTML = "";

  songs.slice().sort(byTitle).forEach(s => {
    const li = el("li");
    const lab = el("label", "check-row");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = delIds.has(s.id);
    cb.onchange = () => { cb.checked ? delIds.add(s.id) : delIds.delete(s.id); updateDeleteBtn(); };
    lab.appendChild(cb);
    lab.appendChild(el("span", "grow", s.key ? `${s.title} (${s.key})` : s.title));
    li.appendChild(lab);
    ul.appendChild(li);
  });
  updateDeleteBtn();
}

function updateDeleteBtn() {
  $("deleteSelectedBtn").textContent = `Delete selected (${delIds.size})`;
  $("deleteSelectedBtn").disabled = delIds.size === 0;
}

function selectAllSongs() { delIds = new Set(songs.map(s => s.id)); renderDelete(); }

async function deleteSelectedSongs() {
  if (!delIds.size) return;
  const n = delIds.size;
  if (!(await ask(`Delete ${n} selected song${n === 1 ? "" : "s"}? This can't be undone.`, "Delete"))) return;

  songs = songs.filter(s => !delIds.has(s.id));
  recent = recent.filter(id => !delIds.has(id));
  persist(); pruneSetlists(); saveRecent();

  toast(`${n} song${n === 1 ? "" : "s"} deleted`);
  go("manage");
}

/* ---------- ADD MULTIPLE SONGS (import) ---------- */
function parseSongs(text) {
  const out = [];
  let cur = null;
  let gap = false;                               // was there a blank line since the last section?
  const SEC = new RegExp("^(" + NAMES_ALL + ")\\s*(\\d*)\\s*:\\s*(.*)$", "i");
  const SPLIT = new RegExp("[ \\t]*\\b(?:" + NAMES_ALL + ")[ \\t]*\\d*[ \\t]*:", "gi");

  text.replace(/\r\n?/g, "\n").replace(SPLIT, "\n$&").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) { gap = true; return; }

    const km = line.match(/^key(?:\s+of)?\s*[:\-]?\s*([A-Ga-g][#b]?m?)$/i);
    if (km && cur) { cur.key = normKey(km[1]); return; }

    const m = line.match(SEC);

    if (!m) {
      const t = tokenize(line);
      const onlyChords = t.every(isTok) && t.some(isChordTok);

      if (cur && !gap && cur.body.length && onlyChords) {      // chords on a new line, same section
        if (cur.body[cur.body.length - 1] === "") cur.body.pop();
        cur.body.push(t.map(fmtTok).join(" "), "");
        return;
      }
      cur = { id: "", title: line, key: "", body: [] };         // otherwise: a new song title
      out.push(cur);
      gap = false;
      return;
    }
    if (!cur) return;

    const toks = tokenize(m[3]);
    const label = m[1].toUpperCase()
      .replace(/^(VERSE|BRIDGE)S$/, "$1")
      .replace(/^PRE[- ]?CHORUS$/, "PRE-CHORUS") + (m[2] ? " " + m[2] : "") + ":";
    cur.body.push(label);

    if (toks.length && toks.every(isTok)) {
      cur.body.push(toks.map(fmtTok).join(" "));
      const first = toks.find(isChordTok);
      if (!cur.key && first) cur.key = normKey(first.split(/[\/-]/)[0]);
    } else if (toks.length) {
      cur.body.push(toks.join(" "));
    }
    cur.body.push("");
    gap = false;
  });
  return out;
}

function importSongs() {
  const found = parseSongs($("importBox").value);
  const replace = $("replaceBox").checked;
  const byName = new Map(songs.map(s => [s.title.toLowerCase(), s]));
  const undo = { added: [], updated: [] };
  let added = 0, updated = 0, skipped = 0;

  found.forEach(s => {
    if (!s.body.length) { skipped++; return; }
    const body = s.body.join("\n").trim();
    const old = byName.get(s.title.toLowerCase());

    if (old) {
      if (replace) {
        undo.updated.push({ id: old.id, body: old.body, key: old.key });   // remember the old version
        old.body = body;
        old.key = s.key || old.key;
        updated++;
      } else skipped++;
      return;
    }
    s.id = Date.now().toString() + added;
    s.body = body;
    songs.push(s);
    byName.set(s.title.toLowerCase(), s);
    undo.added.push(s.id);
    added++;
  });

  if (added || updated) { lastImport = undo; saveUndo(); }
  persist();
  $("importBox").value = "";
  toast(`Added ${added}, updated ${updated}, skipped ${skipped}`);
  go("manage");
}

async function undoImport() {
  if (!lastImport) return;
  const msg = `Undo the last import? ${lastImport.added.length} added song(s) will be removed and ${lastImport.updated.length} replaced song(s) restored.`;
  if (!(await ask(msg, "Undo import"))) return;

  songs = songs.filter(s => !lastImport.added.includes(s.id));
  [...lastImport.updated].reverse().forEach(u => {
    const s = songs.find(x => x.id === u.id);
    if (s) { s.body = u.body; s.key = u.key; }
  });
  lastImport = null;
  persist(); pruneSetlists(); saveUndo();
  toast("Import undone");
  renderManage();
}

/* ---------- BACKUP / RESTORE ---------- */
function exportBackup() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ songs, setlists }, null, 1)], { type: "application/json" }));
  a.download = "chordify-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup downloaded");
}

function restoreBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      const incoming = Array.isArray(d) ? d : d.songs;
      if (!Array.isArray(incoming)) throw new Error("bad file");

      const ids = new Set(songs.map(s => s.id));
      let added = 0;
      incoming.forEach(s => {
        if (s && s.id && s.title && !ids.has(s.id)) { songs.push(s); ids.add(s.id); added++; }
      });
      persist();

      let addedSets = 0;
      const have = new Set(setlists.map(l => l.id));
      if (Array.isArray(d.setlists)) {
        d.setlists.forEach(l => {
          if (l && l.id && l.name && Array.isArray(l.songs) && !have.has(l.id)) {
            setlists.push({ id: l.id, name: l.name, date: l.date || "", songs: l.songs.filter(id => ids.has(id)) });
            have.add(l.id); addedSets++;
          }
        });
      } else if (Array.isArray(d.setlist) && d.setlist.length) {      // backup from the old single-setlist version
        setlists.push({ id: newId(), name: "Imported setlist", date: "", songs: d.setlist.filter(id => ids.has(id)) });
        addedSets++;
      }
      saveSetlists();
      toast(`Restored ${added} song${added === 1 ? "" : "s"}` + (addedSets ? ` and ${addedSets} setlist${addedSets === 1 ? "" : "s"}` : ""));
      renderManage();
    } catch (e) {
      toast("That file is not a backup");
    }
    input.value = "";
  };
  r.readAsText(file);
}

/* ---------- LYRICS TO PPTX (4 lines max per slide) ---------- */
function newPptx() {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_16x9";
  return p;
}

function addSongSlides(pptx, song) {
  const cover = pptx.addSlide();
  cover.background = { color: "000000" };
  cover.addText(song.title, { x: 0.5, y: 0.5, w: 9, h: 4.5, fontSize: 44, bold: true, color: "FFFFFF", align: "center", valign: "middle" });

  stripChords(song.body).split(/\n\s*\n/).forEach(block => {
    const lines = block.split("\n").map(l => l.trim()).filter(l => l && !SECTION_LINE.test(l));
    for (let i = 0; i < lines.length; i += 4) {
      const slide = pptx.addSlide();
      slide.background = { color: "000000" };
      slide.addText(lines.slice(i, i + 4).join("\n"), { x: 0.5, y: 0.5, w: 9, h: 4.5, fontSize: 36, color: "FFFFFF", align: "center", valign: "middle", fit: "shrink" });
    }
  });
}

async function exportPptx() {
  try {
    if (typeof PptxGenJS === "undefined") throw new Error("PPTX library not loaded. Check your internet or turn Brave Shields down.");
    const p = newPptx();
    addSongSlides(p, current);
    await p.writeFile({ fileName: current.title + ".pptx" });
  } catch (e) {
    toast("PPTX failed: " + e.message);
  }
}

async function exportSetlistPptx() {
  const l = getSetlist(viewId);
  if (!l || !l.songs.length) { toast("This setlist has no songs"); return; }
  try {
    if (typeof PptxGenJS === "undefined") throw new Error("PPTX library not loaded. Check your internet or turn Brave Shields down.");
    const p = newPptx();
    const cover = p.addSlide();
    cover.background = { color: "000000" };
    cover.addText(l.name + (l.date ? "\n" + fmtDate(l.date) : ""), { x: 0.5, y: 0.5, w: 9, h: 4.5, fontSize: 48, bold: true, color: "FFFFFF", align: "center", valign: "middle", fit: "shrink" });
    l.songs.forEach(id => { const s = songs.find(x => x.id === id); if (s) addSongSlides(p, s); });
    await p.writeFile({ fileName: (l.name.replace(/[\\/:*?"<>|]/g, "") || "Setlist") + ".pptx" });
  } catch (e) {
    toast("PPTX failed: " + e.message);
  }
}

/* ---------- ROUTER (page changes use the address bar, so Back works) ---------- */
const VIEWS = ["homeView", "songsView", "songView", "setlistsView", "setView", "setEditView", "manageView", "editView", "importView", "deleteView"];
const MANAGE_GROUP = ["manage", "edit", "import", "delete"];
let currentView = "homeView";

const go = path => { location.hash = "#/" + path; };

function show(name) {
  VIEWS.forEach(v => $(v).classList.toggle("hidden", v !== name));
  currentView = name;
  document.body.dataset.view = name;                // lets CSS hide the top search bar on pages with the big one
}

function page(name) {
  show(name);
  window.scrollTo(0, 0);
}

function showHome(section) {
  const wasHome = currentView === "homeView";
  show("homeView");
  renderHome();

  const smooth = wasHome && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (section === "about") $("about").scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  else window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

function setNav(a) {
  const isHome = !a || a === "home" || a === "about" || !VIEWS_ROUTES.includes(a);
  if (!isHome) {
    $("navHome").setAttribute("aria-current", "false");
    $("navAbout").setAttribute("aria-current", "false");
  }
  $("navManage").setAttribute("aria-current", MANAGE_GROUP.includes(a) ? "page" : "false");
  $("navSongs").setAttribute("aria-current", SONG_GROUP.includes(a) ? "page" : "false");
}
const SONG_GROUP = ["songs", "song", "setlists", "setlist", "newsetlist", "editsetlist"];
const VIEWS_ROUTES = [...SONG_GROUP, "manage", "edit", "import", "delete"];

function route() {
  const [a, b, c] = location.hash.replace(/^#\/?/, "").split("/");
  stopScroll();
  setNav(a);

  switch (a) {
    case "songs":
      page("songsView");
      renderSongs();
      if (wantSearchFocus) { wantSearchFocus = false; focusEnd($("songsSearch")); }
      break;
    case "song": {
      const s = songs.find(x => x.id === b);
      if (!s) { go("songs"); return; }
      openSong(s, c);
      break;
    }
    case "setlists": page("setlistsView"); renderSetlists(); break;
    case "setlist": page("setView"); renderSetlistView(b); break;
    case "newsetlist": openSetlistEditor(null); break;
    case "editsetlist": openSetlistEditor(b); break;
    case "manage": page("manageView"); renderManage(); break;
    case "edit": openEditor(b); break;
    case "import": page("importView"); break;
    case "delete": startDelete(); break;
    default: showHome(a === "about" ? "about" : "home"); spy();
  }
}

window.addEventListener("hashchange", route);

/* every [data-go] link or button changes page (and still scrolls if you are already there) */
document.addEventListener("click", e => {
  const a = e.target.closest("[data-go]");
  if (!a) return;
  e.preventDefault();
  const target = "#/" + a.dataset.go;
  if (location.hash === target || (!location.hash && target === "#/home")) route();
  else location.hash = target;
});

/* top search box (Home, About, Songs of a setlist...): typing sends you to the All songs page,
   where the big search bar in the middle takes over */
let wantSearchFocus = false;
const focusEnd = input => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); };

function sendToSongsSearch() {
  $("songsSearch").value = $("searchBox").value;
  $("searchBox").value = "";
  wantSearchFocus = true;
  if (currentView === "songsView") { renderSongs(); focusEnd($("songsSearch")); wantSearchFocus = false; }
  else { go("songs"); route(); }                    // switch right now so fast typing is not lost
}
$("searchBox").addEventListener("input", sendToSongsSearch);
$("searchBox").addEventListener("keydown", e => { if (e.key === "Enter") sendToSongsSearch(); });
$("songsSearch").addEventListener("input", renderSongs);
$("pickSearch").addEventListener("input", () => { if (draft) renderPicker(); });

/* highlight Home / About us while scrolling, and tint the nav once you scroll */
let spyQueued = false;
function spy() {
  $("nav").classList.toggle("scrolled", window.scrollY > 8);
  if (currentView !== "homeView") return;
  const onAbout = $("about").getBoundingClientRect().top < window.innerHeight * 0.45;
  $("navHome").setAttribute("aria-current", onAbout ? "false" : "page");
  $("navAbout").setAttribute("aria-current", onAbout ? "page" : "false");
  $("navSongs").setAttribute("aria-current", "false");
}
window.addEventListener("scroll", () => {
  if (spyQueued) return;
  spyQueued = true;
  requestAnimationFrame(() => { spyQueued = false; spy(); });
}, { passive: true });

/* paste into the editor: bold text becomes chords, labels and chords get tidied */
$("fBody").addEventListener("paste", e => {
  e.preventDefault();
  let text = tidy(e.clipboardData.getData("text/plain"));            // plain text keeps the line breaks
  const html = e.clipboardData.getData("text/html");
  if (!/\[[^\]]+\]/.test(text) && html) {                            // no chord lines found: try bold text
    text = tidy(htmlToChordText(new DOMParser().parseFromString(html, "text/html").body));
  }
  e.target.setRangeText(text, e.target.selectionStart, e.target.selectionEnd, "end");
});

/* ---------- HOME DEMO CARD ---------- */
const DEMO_LINES = [
  [["G","Amazing"],["C","grace,"],["G","how"],["G","sweet"],["D","the"],["G","sound"]],
  [["G","that"],["C","saved"],["G","a"],["Em","wretch"],["D","like"],["G","me"]]
];
let demoShift = 0;
function renderDemo() {
  const body = document.getElementById("demoBody");
  if (!body) return;
  const flats = flatsFor("G", demoShift);
  body.innerHTML = DEMO_LINES.map(line =>
    line.map(([c, w]) => `<span class="seg"><i>${transposeChord(c, demoShift, flats)}</i>${w}</span>`).join("")
  ).join('<div style="flex-basis:100%;height:0"></div>');
  document.getElementById("demoKey").textContent = transposeChord("G", demoShift, flats);
}
function demoMove(n) { demoShift = ((demoShift + n) % 12 + 12) % 12; renderDemo(); }
document.getElementById("demoUp").addEventListener("click", () => demoMove(1));
document.getElementById("demoDown").addEventListener("click", () => demoMove(-1));
renderDemo();

/* ---------- OFFLINE (service worker) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.ready.then(() => {
      if (!load("chordify_offline_note", false)) {
        save("chordify_offline_note", true);
        toast("Saved for offline use");
      }
    }).catch(() => {});
  });
}

/* ---------- START ---------- */
syncThemeBtn();
route();
