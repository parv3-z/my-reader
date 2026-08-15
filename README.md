# Reader

A fully offline, Kindle-style e-reader. No install, no account, no
network calls — everything (pdf.js included) is bundled locally in
`/js`.

## Running it

Browsers block workers/fetch on the bare `file://` protocol, so you
need a tiny local server (this does **not** need internet — it just
serves the files on your own machine):

```bash
cd reader
python3 -m http.server 8123
```

Then open **http://localhost:8123** in your browser. Once it's
loaded you can go offline entirely — nothing here ever calls out to
the internet.

If you'd rather not use Python, any static server works
(`npx serve`, VS Code's "Live Server" extension, etc).

## Features

- **Search** — the box at the top of the shelf filters by title or
  author as you type.
- **Reading mode** — the small circle button next to the font-size
  controls (top bar, tap the page to reveal it) switches between the
  default paper tone and a warm sepia/yellowish tone. Your choice is
  remembered.

## Adding books

There is no upload button on purpose. To add a book:

1. Drop the PDF into the `books/` folder.
2. Open `js/books.js` and add an entry:

```js
{
  id: "unique-id",
  file: "books/your-file.pdf",
  title: "Book Title",
  author: "Author Name"
}
```

3. Refresh the page. It'll show up on the shelf.

A demo entry (`sample-book.pdf`) is included so you can see it
working immediately — delete that entry and the file once you've
added your own books.

## How it works

- **Extraction** — `js/app.js` reads each PDF page with pdf.js,
  groups text items into lines by position, then groups lines into
  paragraphs/headings using indentation, line-width, and font-size
  heuristics (since a PDF has no native paragraph markup).
- **Pagination** — text is reflowed into reader-sized "pages" by
  measuring against an invisible off-screen element, the same way
  reflowable e-readers work — so it adapts to font size and screen
  size rather than showing the PDF's fixed print layout.
- **Progress** — each book's last position and your font-size
  preference are saved in `localStorage`, so they persist between
  sessions with no server or account.

## Notes / limitations

- Works best on text-based PDFs. Scanned/image-only PDFs have no
  extractable text layer, so nothing will render for those.
- Paragraph detection is heuristic — most novels/prose PDFs come out
  clean, but complex layouts (multi-column, textbooks with lots of
  figures) may occasionally merge or split a paragraph oddly.
