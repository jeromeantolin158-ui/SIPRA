
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
  ["listView", "songView", "editView"].forEach(v =>
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

  if (!found.length) {
    ul.innerHTML = "<li>No songs found</li>";
    return;
  }

  found.forEach(s => {
    const li = document.createElement("li");
    li.textContent = s.key ? `${s.title} (${s.key})` : s.title;
    li.onclick = () => openSong(s.id);
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
  const t = transposeSong(current.body, steps, flatsFor(current.key, steps));
  $("songTitle").textContent = current.title;
  paint(chordsMode ? chordsOnly(t) : chordsAbove(t));
  $("keyLabel").textContent = "Key: " + (current.key ? transposeChord(current.key, steps, flatsFor(current.key, steps)) : "-");
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
  requestAnimationFrame(tick);
}

function stopScroll() {
  scrolling = false;
  $("scrollBtn").textContent = "Start scroll";
}

function toggleScroll() {
  scrolling ? stopScroll() : startScroll();
}

function setSpeed(v) {
  speed = Number(v);
}

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
  s.key = $("fKey").value.trim();
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
function exportPptx() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const cover = pptx.addSlide();
  cover.background = { color: "000000" };

  cover.addText(current.title, {
    x: 0.5, y: 0.5, w: 9, h: 4.5,
    fontSize: 44, bold: true, color: "FFFFFF",
    align: "center", valign: "middle"
  });

  stripChords(current.body).split(/\n\s*\n/).forEach(block => {
    const lines = block.split("\n").map(l => l.trim()).filter(l => l && !SECTION_LINE.test(l));

    for (let i = 0; i < lines.length; i += 4) {
      const slide = pptx.addSlide();
      slide.background = { color: "000000" };

      slide.addText(lines.slice(i, i + 4).join("\n"), {
        x: 0.5, y: 0.5, w: 9, h: 4.5,
        fontSize: 36, color: "FFFFFF",
        align: "center", valign: "middle", fit: "shrink"
      });
    }
  });

  pptx.writeFile({ fileName: current.title + ".pptx" });
}

/* ---------- START ---------- */
showList();

/* ---------- PASTE: BOLD TEXT BECOMES CHORDS ---------- */
const CHORD = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#)?\d+)*(?:\/[A-G][#b]?)?$/;

function markChords(text) {
  const tokens = text.match(/\S+/g);

  if (!tokens || !tokens.every(t => CHORD.test(t))) return text;

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

const NAMES = "pre[- ]?chorus|post[- ]?chorus|chorus|verses?|bridges?|refrain|intro|outro|interlude|instrumental";

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