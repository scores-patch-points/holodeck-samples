# holodeck-samples

Sample source sets for **the fold** (holodeck) demo at
https://scores-patch-points.github.io/holodeck/ — the app carries only a
pointer (`samples.json` in the holodeck repo); the content here is downloaded
when the demo opens.

## titanic-1912 — one night, several accounts

Sources that describe the same real thing and do not fully agree:

| file (in `titanic-1912/text/`) | source | rights |
|---|---|---|
| `beesley-loss-of-the-ss-titanic.txt` | Lawrence Beesley, *The Loss of the S. S. Titanic: Its Story and Its Lessons* (1912), Project Gutenberg #6675 | public domain |
| `british-report-loss-of-the-steamship-titanic.txt` | *Loss of the Steamship "Titanic": Report of a Formal Investigation* (British Board of Trade, 1912), Project Gutenberg #39415 | public domain |
| `senate-speech-smith-may-28-1912.txt` | Hon. William Alden Smith, speech presenting the Senate Commerce Committee's findings, May 28, 1912; Internet Archive item `titanicdisasters00smit` (scan-derived text) | public domain (US Government) |
| `ny-tribune-front-page-ocr.txt` | New-York Tribune front page, April 15, 1912; machine OCR (tesseract) of the scan from Library of Congress via tile.loc.gov | public domain (1912 newspaper) |
| `british-report-numbers-saved.csv` | the report's own "Numbers saved" table, transcribed | public domain |

Media (film clips, the record, the newspaper scan) is served from the VM:
https://watch.hyphae.social/samples/titanic-1912/

- `film/promenade-decks-and-captain-smith-1912.mp4` + `.vtt` — from
  *Die Katastrophe der Titanic* (1912, silent; Internet Archive item
  `silent-die-katastrophe-der-titanic`), trimmed to 90 s; the captions are a
  machine reading of the film's own title cards.
- `film/cqd-help-we-are-sinking-1912.mp4` — "Titanic Disaster Genuine
  Footage (1911–1912)" (Internet Archive item, CC public-domain mark),
  trimmed to 64 s; **no transcript shipped**.
- `audio/stand-to-your-post.mp3` — "Stand To Your Post", a 1912 tribute
  record; Internet Archive item `stand-to-your-post`. Pre-1923 sound
  recording, public domain in the US.
- `press/ny-tribune-1912-04-15-p1.jpg` — the front page as scanned (LoC).

The full originals are not kept here; each row names its archive item, so the
bytes are re-pullable and verifiable. Everything is public domain; the two
Project Gutenberg texts are carried as distributed, license included.

Notes on the machine-derived texts: the Senate speech and the Tribune front
page are scan-derived OCR readings, not the documents' own typesetting. The
speech was lightly normalized (hyphen line-breaks joined, OCR double-spacing
collapsed; wording untouched). The front-page text is tesseract's reading as
it came out. Both are disclosed as machine readings wherever they land.
