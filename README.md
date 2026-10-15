# holodeck-samples

Sample source sets for **the fold** (holodeck) demo at
https://scores-patch-points.github.io/holodeck/ — the app carries only a
pointer (`samples.json` in the holodeck repo); this repo carries the
**readings**, and the content lives where it lives.

## What is here, and what is not

- `titanic-1912/readings.json` — **the readings**: each source already read
  down to its passages, as the app installs them (title, type, the reading's
  own html, provenance). Nothing is parsed or OCR'd in a visitor's browser.
- **No content here.** The recordings and the newspaper scan are served from
  the VM (`https://watch.hyphae.social/samples/titanic-1912/`); the book texts
  live at their archives, cited in each reading's `url`. The app points at
  them and fetches only what a person opens.

## titanic-1912 — one night, several accounts

Sources that describe the same real thing and do not fully agree:

| source | where the reading comes from | rights |
|---|---|---|
| Hon. William Alden Smith, speech presenting the Senate Commerce Committee's findings, May 28, 1912 | Internet Archive item `titanicdisasters00smit` (scan-derived text, lightly normalized) | public domain (US Government) |
| *Loss of the Steamship "Titanic": Report of a Formal Investigation* (Board of Trade, 1912) | Project Gutenberg #39415 (excerpt) | public domain |
| Lawrence Beesley, *The Loss of the S. S. Titanic* (1912) | Project Gutenberg #6675 (excerpt) | public domain |
| the report's own "Numbers saved" table | transcribed from the report | public domain |
| New-York Tribune front page, April 15, 1912 — the scan and what OCR read in it | Library of Congress scan; machine OCR (tesseract) | public domain |
| *Die Katastrophe der Titanic* (1912), 90 s, with captions read from the film's title cards | Internet Archive `silent-die-katastrophe-der-titanic`; clip + captions on the VM | public domain |
| Titanic genuine footage (1911–12), 64 s, no transcript yet | Internet Archive `titanic-disaster-genuine-footage-1911-1912`; clip on the VM | public domain |
| "Stand To Your Post" — a 1912 tribute record | Internet Archive `stand-to-your-post`; mp3 on the VM | public domain (pre-1923 recording) |

Machine-derived readings (the Senate speech, the front page, the film's
captions) say so in their notes. The long reports are excerpted to what the
demo needs; the full sources are at the cited addresses.

