
const $ = id => document.getElementById(id);

/* ---------- STORAGE (browser localStorage, ~1 KB per song) ---------- */
const sample = {
  id: "1", title: "Amazing Grace", key: "G",
  body: "[G]Amazing [C]grace, how [G]sweet the [D]sound\n[G]That saved a [Em]wretch like [D]me\n\n[G]I once was [C]lost, but [G]now am [D]found\n[G]Was blind but [D]now I [G]see"
};

let songs;
try {
  const saved = localStorage.getItem("sipra_songs");
  songs = saved ? JSON.parse(saved) : [sample];
} catch (e) { songs = [sample]; }

const persist = () => localStorage.setItem("sipra_songs", JSON.stringify(songs));

let setlist;
try { setlist = JSON.parse(localStorage.getItem("sipra_setlist")) || []; } catch (e) { setlist = []; }
const saveSetlist = () => localStorage.setItem("sipra_setlist", JSON.stringify(setlist));

const btn = (text, fn) => {
  const b = document.createElement("button");
  b.textContent = text;
  b.style.float = "right";
  b.onclick = e => { e.stopPropagation(); fn(); };
  return b;
};

/* ---------- STATE ---------- */
let current = null;
let steps = 0;
let chordsMode = false;
let editingId = null;

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
  return text.replace(/\[([^\]]+)\]/g, (_, c) => `[${transposeChord(c, n, useFlats)}]`);
}

function flatsFor(key, n) {
  return key ? FLAT_KEYS.includes(transposeChord(key, n, true)) : false;
}

/* ---------- HELPERS ---------- */
const stripChords = t => t.replace(/\[[^\]]*\]/g, "");

function showView(name) {
  ["listView", "songView", "editView", "importView", "setView"].forEach(v =>
    $(v).classList.toggle("hidden", v !== name)
  );
  window.scrollTo(0, 0);
}

/* ---------- LIST + SEARCH ---------- */
function showList() {
  stopScroll();
  showView("listView");
  renderList();
}

function renderList() {
  const q = $("searchBox").value.trim().toLowerCase();
  const ul = $("results");
  ul.innerHTML = "";

  const found = songs
    .filter(s => (s.title + " " + stripChords(s.body)).toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (!found.length) { ul.innerHTML = "<li>No songs found</li>"; return; }

  found.forEach(s => {
    const li = document.createElement("li");
    li.textContent = s.key ? `${s.title} (${s.key})` : s.title;
    li.onclick = () => openSong(s.id);
    li.appendChild(btn(setlist.includes(s.id) ? "✓ In setlist" : "+ Setlist", () => { toggleSet(s.id); renderList(); }));
    ul.appendChild(li);
  });
}

/* ---------- SONG VIEW ---------- */
function openSong(id) {
  stopScroll();
  current = songs.find(s => s.id === id);
  steps = 0;
  chordsMode = false;
  showView("songView");
  render();
}

function render() {
  const k = normKey(current.key);
  const t = transposeSong(current.body, steps, flatsFor(k, steps));
  $("songTitle").textContent = current.title;
  paint(chordsMode ? chordsOnly(t) : chordsAbove(t));
  $("keyLabel").textContent = "Key: " + (k ? transposeChord(k, steps, flatsFor(k, steps)) : "-");
  $("modeBtn").textContent = chordsMode ? "Full song" : "Chords only";
}

// "VERSE 1:" -> "[Verse 1]"
const labelText = l => "[" + l.replace(/:$/, "").toLowerCase().replace(/(^|[ -])\w/g, c => c.toUpperCase()) + "]";

// draws rows: chord (bold), lyric, label, blank
function paint(rows) {
  const box = $("out");
  box.innerHTML = "";

  rows.forEach(r => {
    const d = document.createElement("div");
    d.className = r.t;
    d.textContent = r.s || "\u00a0";
    box.appendChild(d);
  });
}

function shift(n) {
  steps += n;
  render();
}

function toggleMode() {
  chordsMode = !chordsMode;
  render();
}

/* ---------- AUTO SCROLL ---------- */
let scrolling = false, speed = 30, pos = 0, lastTime = 0;

function tick(time) {
  if (!scrolling) return;

  if (lastTime) {
    pos += speed * (time - lastTime) / 1000;
    window.scrollTo(0, pos);
  }

  lastTime = time;

  if (pos >= document.body.scrollHeight - window.innerHeight) {
    stopScroll();
    return;
  }

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

function toggleScroll() {
  scrolling ? stopScroll() : startScroll();
}

function setSpeed(v) {
  speed = Number(v);
}

/* ---------- KEEP SCREEN AWAKE WHILE SCROLLING ---------- */
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

/* ---------- ADD / EDIT / DELETE ---------- */
function openEditor(id) {
  stopScroll();
  editingId = id || null;

  const s = songs.find(x => x.id === id);

  $("editHeading").textContent = s ? "Edit song" : "New song";
  $("fTitle").value = s ? s.title : "";
  $("fKey").value = s ? s.key : "";
  $("fBody").value = s ? s.body : "";
  $("delBtn").classList.toggle("hidden", !s);

  showView("editView");
}

function saveSong() {
  const title = $("fTitle").value.trim();

  if (!title) {
    alert("Title is required");
    return;
  }

  let s = songs.find(x => x.id === editingId);

  if (!s) {
    s = { id: Date.now().toString() };
    songs.push(s);
  }

  s.title = title;
  s.key = normKey($("fKey").value);
  s.body = $("fBody").value;

  persist();
  openSong(s.id);
}

function deleteSong() {
  if (!confirm("Delete this song?")) return;

  songs = songs.filter(s => s.id !== editingId);
  persist();
  showList();
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
    alert("PPTX failed: " + e.message);
  }
}

async function exportSetlistPptx() {
  if (!setlist.length) { alert("Setlist is empty"); return; }
  try {
    if (typeof PptxGenJS === "undefined") throw new Error("PPTX library not loaded. Check your internet or turn Brave Shields down.");
    const p = newPptx();
    setlist.forEach(id => { const s = songs.find(x => x.id === id); if (s) addSongSlides(p, s); });
    await p.writeFile({ fileName: "Setlist.pptx" });
  } catch (e) {
    alert("PPTX failed: " + e.message);
  }
}

/* ---------- START ---------- */
showList();

/* ---------- PASTE: BOLD TEXT BECOMES CHORDS ---------- */
const CHORD = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#)?\d+)*(?:\/[A-G][#b]?)?$/;

function markChords(text) {
  const tokens = text.match(/\S+/g);
  if (!tokens) return text;

  const last = tokens[tokens.length - 1];
  const mt = tokens.length > 1 && (last.match(/^\(?(\d+)x\)?$/i) || last.match(/^x(\d+)$/i));   // 4x, (2x), x4
  if (mt) tokens.pop();

  if (!tokens.every(t => CHORD.test(t))) return text;

  if (mt) {                                   // repeat the chords, drop the "4x"
    const times = Math.min(+mt[1], 16);
    return [].concat(...Array(times).fill(tokens)).map(c => `[${c}]`).join(" ");
  }
  return text.replace(/\S+/g, t => `[${t}]`);
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

    if (node.tagName === "BR") {
      out += "\n";
      return;
    }

    node.childNodes.forEach(c => walk(c, bold));

    if (BLOCK.test(node.tagName)) out += "\n";
  })(root, false);

  return out.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
}

/* ---------- MERGE CHORD LINES ---------- */

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

/* ---------- TIDY: labels on their own line + chords above lyrics ---------- */

const NAMES = "pre[- ]?chorus|chorus|verses?|bridges?|refrain|intro|outro|interlude|instrumental|medley";

const LABEL_RE = new RegExp(
  "(?:[\\[(]\\s*(?:" + NAMES + ")\\s*\\d*\\s*[\\])]\\s*:?" +
  "|\\b(?:" + NAMES + ")\\s*(?:\\d+\\s*:?|:)" +
  "|^[ \\t]*(?:" + NAMES + ")\\b[ \\t]*\\d*[ \\t]*:?)[ \\t]*\\n?",
  "gim"
);

const SECTION_LINE = new RegExp("^(?:" + NAMES + ")(?:\\s*\\d+)?:?$", "i");

function tidy(text) {
  text = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(LABEL_RE, m => {
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

function normKey(k) {                       // "a" -> "A", "bbm" -> "Bbm"
  k = (k || "").trim();
  return k ? k[0].toUpperCase() + k.slice(1) : "";
}

function tidyBox() {
  $("fBody").value = tidy($("fBody").value);
}

/* ---------- SHOW CHORDS ABOVE LYRICS ---------- */

function maxChars() {
  const probe = document.createElement("span");
  probe.style.cssText = "font:18px monospace;position:absolute;visibility:hidden";
  probe.textContent = "0".repeat(10);
  document.body.appendChild(probe);
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

    if (SECTION_LINE.test(trimmed)) {
      rows.push({ t: "label", s: labelText(trimmed) });
      return;
    }

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

// "C G Am F C G Am F" -> "C G Am F 2x"
function foldRepeats(chords) {
  const n = chords.length;
  for (let p = 1; p <= n / 2; p++) {
    if (n % p) continue;
    if (chords.every((c, i) => c === chords[i % p])) {
      return chords.slice(0, p).join(" ") + " " + (n / p) + "x";
    }
  }
  return chords.join(" ");
}

const chordsOnly = t => {
  const sections = [];
  let cur = { name: "", chords: [] };
  t.split("\n").forEach(l => {
    const line = l.trim();
    if (SECTION_LINE.test(line)) {
      sections.push(cur);
      cur = { name: labelText(line).slice(1, -1) + ":", chords: [] };
      return;
    }
    (l.match(/\[([^\]]+)\]/g) || []).forEach(c => cur.chords.push(c.slice(1, -1)));
  });
  sections.push(cur);
  return sections
    .filter(s => s.chords.length)
        .map(s => ({ t: "chord", s: (s.name ? s.name + " " : "") + foldRepeats(s.chords) }));
};

/* ---------- IMPORT MANY SONGS ---------- */
const isMul = t => /^\(?\d+x\)?$/i.test(t) || /^x\d+$/i.test(t);      // 2x, (2x), x2
const isChordTok = t => t.split("-").every(c => CHORD.test(c));        // Em, C#m-Bm, G-A-Bm-C

function parseSongs(text) {
  const out = [];
  let cur = null;
  const SEC = new RegExp("^(" + NAMES + ")\\s*(\\d*)\\s*:\\s*(.*)$", "i");

  text.replace(/\r\n?/g, "\n").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) return;

    const km = line.match(/^key(?:\s+of)?\s*[:\-]?\s*([A-Ga-g][#b]?m?)$/i);
    if (km && cur) { cur.key = normKey(km[1]); return; }

    const m = line.match(SEC);
    if (!m) {                                   // not a section line -> new song title
      cur = { id: "", title: line, key: "", body: [] };
      out.push(cur);
      return;
    }
    if (!cur) return;

    const toks = m[3].split(/\s+/).filter(Boolean);
    const label = m[1].toUpperCase()
      .replace(/^(VERSE|BRIDGE)S$/, "$1")
      .replace(/^PRE[- ]?CHORUS$/, "PRE-CHORUS") + (m[2] ? " " + m[2] : "") + ":";
    cur.body.push(label);

    if (toks.length && toks.every(t => isChordTok(t) || isMul(t))) {
      cur.body.push(toks.map(t => isMul(t) ? `[${t.replace(/\D/g, "")}x]` : `[${t}]`).join(" "));
      const first = toks.find(isChordTok);
      if (!cur.key && first) cur.key = normKey(first.split(/[\/-]/)[0]);
    } else {
      cur.body.push(toks.join(" "));
    }
    cur.body.push("");
  });
  return out;
}

function importSongs() {
  const found = parseSongs($("importBox").value);
  const replace = $("replaceBox").checked;
  const byTitle = new Map(songs.map(s => [s.title.toLowerCase(), s]));
  let added = 0, updated = 0, skipped = 0;

  found.forEach(s => {
    if (!s.body.length) { skipped++; return; }
    const body = s.body.join("\n").trim();
    const old = byTitle.get(s.title.toLowerCase());

    if (old) {
      if (replace) { old.body = body; old.key = s.key || old.key; updated++; }
      else skipped++;
      return;
    }
    s.id = Date.now().toString() + added;
    s.body = body;
    songs.push(s);
    byTitle.set(s.title.toLowerCase(), s);
    added++;
  });

  persist();
  $("importBox").value = "";
  alert(`Added ${added}, updated ${updated}, skipped ${skipped}`);
  showList();
}
/* ---------- SETLIST ---------- */
function toggleSet(id) {
  const i = setlist.indexOf(id);
  i === -1 ? setlist.push(id) : setlist.splice(i, 1);
  saveSetlist();
}

function openSetlist() {
  setlist = setlist.filter(id => songs.some(s => s.id === id));   // drop deleted songs
  saveSetlist();
  showView("setView");
  renderSetlist();
}

function renderSetlist() {
  const ul = $("setItems");
  ul.innerHTML = "";
  if (!setlist.length) { ul.innerHTML = '<li>Empty. Use "+ Setlist" on a song in the list.</li>'; return; }

  setlist.forEach((id, i) => {
    const s = songs.find(x => x.id === id);
    const li = document.createElement("li");
    li.textContent = `${i + 1}. ${s.title}${s.key ? " (" + s.key + ")" : ""}`;
    li.onclick = () => openSong(id);
    li.appendChild(btn("✕", () => { setlist.splice(i, 1); saveSetlist(); renderSetlist(); }));
    li.appendChild(btn("↓", () => moveSet(i, 1)));
    li.appendChild(btn("↑", () => moveSet(i, -1)));
    ul.appendChild(li);
  });
}

function moveSet(i, d) {
  const j = i + d;
  if (j < 0 || j >= setlist.length) return;
  [setlist[i], setlist[j]] = [setlist[j], setlist[i]];
  saveSetlist();
  renderSetlist();
}

function clearSetlist() {
  if (!confirm("Clear the setlist?")) return;
  setlist = [];
  saveSetlist();
  renderSetlist();
}

/* ---------- BACKUP / RESTORE ---------- */
function exportBackup() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ songs, setlist }, null, 1)], { type: "application/json" }));
  a.download = "sipra-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
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

      if (Array.isArray(d.setlist)) {
        d.setlist.forEach(id => { if (ids.has(id) && !setlist.includes(id)) setlist.push(id); });
        saveSetlist();
      }
      alert(`Restored ${added} song(s)`);
      showList();
    } catch (e) {
      alert("That file is not a SIPRA backup");
    }
    input.value = "";
  };
  r.readAsText(file);
}