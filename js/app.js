/* ============================================================
   OFFLINE E-READER
   All PDF parsing happens locally via the bundled pdf.js — no
   network requests are ever made. Books come only from js/books.js.

   Pagination model: each app "page" is exactly one PDF page's
   content — nothing reflows across page boundaries, and font-size
   changes never move content to a different page. If a page's text
   doesn't fit at a larger font size, that page scrolls instead.
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = "js/pdf.worker.min.js";

// ---------- persisted state ----------
const PREFS_KEY = "reader.prefs";
const bookmarkKey = (id) => `reader.bookmark.${id}`;

function loadPrefs() {
  try {
    return { fontSize: 19, theme: "paper", ...JSON.parse(localStorage.getItem(PREFS_KEY)) };
  } catch { return { fontSize: 19, theme: "paper" }; }
}
function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

let prefs = loadPrefs();
document.documentElement.style.setProperty("--reader-font-size", prefs.fontSize + "px");

function applyTheme() {
  document.body.dataset.theme = prefs.theme;
}
applyTheme();

// ---------- elements ----------
const libraryView = document.getElementById("library-view");
const readerView = document.getElementById("reader-view");
const shelfEl = document.getElementById("shelf");
const emptyState = document.getElementById("empty-state");
const noResultsEl = document.getElementById("no-results");
const searchInput = document.getElementById("search-input");
const themeToggle = document.getElementById("theme-toggle");

const readerBar = document.getElementById("reader-bar");
const readerTitle = document.getElementById("reader-title");
const backBtn = document.getElementById("back-btn");
const pageLoading = document.getElementById("page-loading");
const pageEl = document.getElementById("page");
const pageContentEl = document.getElementById("page-content");
const pageNumberTop = document.getElementById("page-number-top");
const progressFill = document.getElementById("progress-fill");
const locationLabel = document.getElementById("location-label");
const percentLabel = document.getElementById("percent-label");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");
const fontSmaller = document.getElementById("font-smaller");
const fontLarger = document.getElementById("font-larger");

// ---------- reader session state ----------
let currentBook = null;   // entry from LIBRARY
let pages = [];           // array of per-PDF-page block arrays — pages[i] = PDF page i+1
let pageIndex = 0;

// ============================================================
// LIBRARY VIEW
// ============================================================

const COVER_PALETTE = ["#5b6b73", "#7a5c4f", "#4f5d47", "#6b5a72", "#8a6a3f", "#3f5a63"];

function coverColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COVER_PALETTE[h % COVER_PALETTE.length];
}

function renderShelf(filterText = "") {
  shelfEl.innerHTML = "";

  if (!LIBRARY.length) {
    emptyState.hidden = false;
    noResultsEl.hidden = true;
    return;
  }
  emptyState.hidden = true;

  const q = filterText.trim().toLowerCase();
  const books = q
    ? LIBRARY.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.author || "").toLowerCase().includes(q)
      )
    : LIBRARY;

  noResultsEl.hidden = books.length > 0;

  books.forEach((book) => {
    const tile = document.createElement("div");
    tile.className = "book-tile";
    tile.innerHTML = `
      <div class="book-cover" style="background:${coverColor(book.id)}">
        <span class="cover-title">${escapeHtml(book.title)}</span>
      </div>
      <div class="book-meta">
        <span class="t">${escapeHtml(book.title)}</span>
        <span class="a">${escapeHtml(book.author || "")}</span>
      </div>`;
    tile.addEventListener("click", () => openBook(book));
    shelfEl.appendChild(tile);
  });
}

// ============================================================
// TEXT EXTRACTION — one block list per PDF page (no cross-page merging)
// ============================================================

function buildBlocksForPage(lines) {
  const blocks = [];
  let prevLine = null;
  let typicalWidth = 0;
  let typicalX = null;
  let paraText = "";
  let paraIsHeading = false;

  const widths = lines.map((l) => l.width).filter((w) => w > 20);
  typicalWidth = widths.length ? Math.max(...widths) : 0;
  const bodyFontSizes = lines.map((l) => l.fontSize).sort((a, b) => a - b);
  const medianFont = bodyFontSizes.length
    ? bodyFontSizes[Math.floor(bodyFontSizes.length / 2)]
    : 10;

  function flushPara() {
    const text = paraText.replace(/\s+/g, " ").trim();
    paraText = "";
    if (!text) return;
    if (/^[0-9ivxlcIVXLC]{1,5}$/.test(text)) return; // stray page number
    blocks.push({ type: paraIsHeading ? "heading" : "para", text });
  }

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    if (typicalX === null) typicalX = line.x;

    const isHeading = line.fontSize > medianFont * 1.25 && text.length < 90;
    const endedShort = prevLine && prevLine.width < typicalWidth * 0.82;
    const indented = line.x > typicalX + line.fontSize * 0.8;
    const bigGap = prevLine && Math.abs(line.y - prevLine.y) > line.fontSize * 2.2;

    const newPara =
      !prevLine || isHeading || paraIsHeading !== isHeading ||
      endedShort || indented || bigGap;

    if (newPara) {
      flushPara();
      paraIsHeading = isHeading;
      paraText = text;
    } else {
      paraText += " " + text;
    }
    prevLine = line;
  }
  flushPara();

  // fold a lone oversized drop-cap letter back onto the paragraph after it
  const merged = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    if (b.type === "heading" && b.text.length <= 2 && next && next.type === "para") {
      merged.push({ type: "para", text: b.text + next.text });
      i++;
    } else {
      merged.push(b);
    }
  }
  return merged;
}

async function extractPages(pdf) {
  const result = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items;

    const lines = [];
    let curLine = null;
    for (const item of items) {
      if (!item.str.trim() && !item.hasEOL) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const fontSize = Math.hypot(item.transform[2], item.transform[3]) || 10;
      if (!curLine || Math.abs(curLine.y - y) > fontSize * 0.4) {
        if (curLine) lines.push(curLine);
        curLine = { x, y, width: 0, fontSize, text: "", lastEndX: null };
      }
      if (curLine.lastEndX !== null && x - curLine.lastEndX > fontSize * 0.22) {
        curLine.text += " ";
      }
      curLine.text += item.str;
      curLine.lastEndX = x + item.width;
      curLine.width = Math.max(curLine.width, x + item.width - curLine.x);
      curLine.fontSize = Math.max(curLine.fontSize, fontSize);
      if (item.hasEOL) { lines.push(curLine); curLine = null; }
    }
    if (curLine) lines.push(curLine);

    result.push(buildBlocksForPage(lines));
  }
  return result;
}

// ============================================================
// RENDERING
// ============================================================

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function blockHtml(b) {
  if (b.type === "heading") return `<div class="heading">${escapeHtml(b.text)}</div>`;
  return `<p>${escapeHtml(b.text)}</p>`;
}

function renderBlocksHtml(arr) { return arr.map(blockHtml).join(""); }

// ============================================================
// READER RENDERING / NAVIGATION
// ============================================================

function renderPage() {
  const pg = pages[pageIndex] || [];
  pageContentEl.innerHTML = renderBlocksHtml(pg);
  pageContentEl.scrollTop = 0;
  pageNumberTop.textContent = String(pageIndex + 1);
  const pct = pages.length > 1
    ? Math.round((pageIndex / (pages.length - 1)) * 100)
    : 100;
  progressFill.style.width = pct + "%";
  locationLabel.textContent = `Page ${pageIndex + 1} / ${pages.length}`;
  percentLabel.textContent = `${pct}%`;
  prevBtn.disabled = pageIndex === 0;
  nextBtn.disabled = pageIndex === pages.length - 1;
  saveBookmark();
}

function saveBookmark() {
  if (!currentBook) return;
  localStorage.setItem(bookmarkKey(currentBook.id), String(pageIndex));
}

function loadBookmarkPageIndex() {
  if (!currentBook) return 0;
  const raw = localStorage.getItem(bookmarkKey(currentBook.id));
  if (raw == null) return 0;
  const idx = Number(raw);
  if (!Number.isFinite(idx) || idx < 0 || idx >= pages.length) return 0;
  return idx;
}

function goNext() {
  if (pageIndex < pages.length - 1) { pageIndex++; renderPage(); }
}
function goPrev() {
  if (pageIndex > 0) { pageIndex--; renderPage(); }
}

function toggleBar() { readerBar.classList.toggle("visible"); }

// ============================================================
// OPEN / CLOSE BOOK
// ============================================================

async function openBook(book) {
  currentBook = book;
  libraryView.hidden = true;
  readerView.hidden = false;
  readerTitle.textContent = book.title;
  pageLoading.hidden = false;
  pageContentEl.innerHTML = "";
  readerBar.classList.remove("visible");

  try {
    const loadingTask = pdfjsLib.getDocument({ url: book.file });
    const pdf = await loadingTask.promise;
    pages = await extractPages(pdf);
    pageIndex = loadBookmarkPageIndex();
    pageLoading.hidden = true;
    renderPage();
  } catch (err) {
    pageLoading.textContent = "Couldn't open this book. Check the file path in js/books.js.";
    console.error(err);
  }
}

function closeBook() {
  saveBookmark();
  readerView.hidden = true;
  libraryView.hidden = false;
  currentBook = null;
  pages = [];
}

// ============================================================
// EVENTS
// ============================================================

searchInput.addEventListener("input", (e) => renderShelf(e.target.value));

themeToggle.addEventListener("click", () => {
  prefs.theme = prefs.theme === "sepia" ? "paper" : "sepia";
  savePrefs(prefs);
  applyTheme();
});

backBtn.addEventListener("click", closeBook);
nextBtn.addEventListener("click", goNext);
prevBtn.addEventListener("click", goPrev);
pageEl.addEventListener("click", toggleBar);

// swipe left/right to turn pages (mobile). Only fires on a mostly-horizontal
// drag so it never fights with vertical scrolling inside a page.
let touchStartX = 0, touchStartY = 0;
pageEl.addEventListener("touchstart", (e) => {
  touchStartX = e.changedTouches[0].clientX;
  touchStartY = e.changedTouches[0].clientY;
}, { passive: true });

pageEl.addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    if (dx < 0) goNext(); else goPrev();
  }
}, { passive: true });

document.addEventListener("keydown", (e) => {
  if (readerView.hidden) return;
  if (e.key === "ArrowRight" || e.key === " ") goNext();
  else if (e.key === "ArrowLeft") goPrev();
  else if (e.key === "Escape") closeBook();
});

// font size only changes how big the text renders — it never changes which
// content is on which page. If it no longer fits, the page scrolls.
function changeFontSize(delta) {
  prefs.fontSize = Math.max(14, Math.min(28, prefs.fontSize + delta));
  savePrefs(prefs);
  document.documentElement.style.setProperty("--reader-font-size", prefs.fontSize + "px");
}
fontSmaller.addEventListener("click", () => changeFontSize(-1));
fontLarger.addEventListener("click", () => changeFontSize(1));

// ---------- boot ----------
renderShelf();
