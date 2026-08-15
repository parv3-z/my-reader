// ============================================================
// BOOK LIBRARY CONFIG  —  this is the whole "backend"
// ============================================================
// To add a book:
//   1. Drop the PDF file into the /books folder.
//   2. Copy one block below, paste it above the closing "];",
//      and fill in the four fields.
//   3. Refresh the page (or, if hosted on GitHub Pages, commit
//      and wait ~a minute for it to redeploy).
//
// Fields:
//   id     — must be unique, no spaces (used to remember your
//            reading position for this book)
//   file   — path to the PDF inside /books
//   title  — shown on the shelf
//   author — shown on the shelf
// ============================================================

const LIBRARY = [

  {
    id: "white-nights",
    file: "books/white-nights-dostoyevsky.pdf",
    title: "White Nights",
    author: "Fyodor Dostoyevsky"
  },

  // ---- copy from here down to add another book ----
  // {
  //   id: "unique-id",
  //   file: "books/your-file.pdf",
  //   title: "Book Title",
  //   author: "Author Name"
  // },

];
