# OratO — AI-Powered Transcription Assistant

OratO is a cross-platform mobile/web app that turns audio recordings into text, and then turns that
text into study material. You upload one or more audio files, the app transcribes them locally with
OpenAI Whisper, merges the results into a single body of text, and can then generate either a bullet
point **summary** (optionally steered by your own instructions) or a 5-question multiple-choice
**knowledge check quiz**. Both outputs can be copied to the clipboard or exported as a PDF.

The project is split into two independently-run pieces:

| Piece | Path | Stack |
|---|---|---|
| Mobile/web client | repo root (`App.js`, `screens/`) | React Native 0.79 + Expo SDK 53, React 19 |
| API server | `transcription-backend/` | FastAPI, Whisper (local), OpenAI GPT-4 |

The client does no AI work itself — it is a thin UI over three HTTP endpoints. All transcription and
generation happens on the backend, which must be running and reachable from the device before the app
can do anything useful.

---

## Table of contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Backend setup](#backend-setup)
- [Frontend setup](#frontend-setup)
- [Connecting the app to the backend](#connecting-the-app-to-the-backend)
- [API reference](#api-reference)
- [Project structure](#project-structure)
- [Frontend internals](#frontend-internals)
- [Design system](#design-system)
- [Troubleshooting](#troubleshooting)
- [Known issues and limitations](#known-issues-and-limitations)
- [Contributing notes](#contributing-notes)

---

## Architecture

```
┌─────────────────────────────┐
│  Expo client (iOS/Android/  │
│  web) — DashboardScreen.js  │
└──────────────┬──────────────┘
               │ HTTPS (SERVER_URL)
               │
   ┌───────────┴────────────┐
   │  ngrok tunnel (dev)    │   ← exposes localhost:8000 to phones
   └───────────┬────────────┘
               │
┌──────────────┴──────────────────────────────────┐
│  FastAPI (transcription-backend/main.py)        │
│                                                 │
│  POST /transcribe    → Whisper "medium" (local) │
│  POST /summarize     → OpenAI GPT-4             │
│  POST /generate-quiz → OpenAI GPT-4             │
└─────────────────────────────────────────────────┘
```

**Data flow.** Files picked with `expo-document-picker` are POSTed one at a time to `/transcribe` as
`multipart/form-data`. Each response is stored in a `transcriptions` array. A `useEffect` watches that
array, filters out entries whose text starts with `Error:`, and joins the rest with `\n\n` into
`combinedText`. That single string is what gets sent to `/summarize` and `/generate-quiz` — the AI
features are therefore only available once at least one file has transcribed successfully.

Nothing is persisted. State lives in React component state and is wiped whenever you pick a new set
of files.

---

## Prerequisites

**Backend**

- **Python 3.10** — the checked-in venv was built with 3.10.11. Whisper's dependency chain (torch,
  numba, llvmlite) is version-sensitive, so avoid very new Python releases.
- **ffmpeg on your `PATH`** — Whisper shells out to it to decode audio. Without it every transcription
  fails with a `FileNotFoundError`-style message.
  - Windows: `choco install ffmpeg` or `winget install ffmpeg`
  - macOS: `brew install ffmpeg`
  - Debian/Ubuntu: `sudo apt install ffmpeg`
- **An OpenAI API key** with GPT-4 access — needed for `/summarize` and `/generate-quiz` only.
  `/transcribe` runs entirely offline.
- **~5 GB free disk** and ideally 8 GB+ RAM. The `medium` Whisper model is ~1.5 GB and torch is large.

**Frontend**

- **Node.js 18+** and npm.
- **Expo Go** on your phone, or an Android emulator / iOS simulator, or just a browser for web.

---

## Backend setup

```bash
cd transcription-backend

# create and activate a virtualenv
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# install dependencies (see the note below — requirements.txt is incomplete)
pip install fastapi uvicorn openai-whisper python-multipart openai python-dotenv
```

> **Important:** `requirements.txt` currently lists `whisper`, which is an unrelated PyPI package, and
> omits `openai` and `python-dotenv`. Installing it verbatim produces a server that crashes on import.
> Use the explicit `pip install` line above until the file is fixed. The correct contents are:
>
> ```
> fastapi
> uvicorn
> openai-whisper
> python-multipart
> openai
> python-dotenv
> ```

Then create your environment file:

```bash
cp .env.example .env
# edit .env and set your real key
```

`.env`:

```
OPENAI_API_KEY=sk-...
```

`.env` is gitignored — never commit a real key.

Start the server:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The **first run downloads the Whisper `medium` weights (~1.5 GB)** to `~/.cache/whisper`. Startup
blocks until that finishes, and the model is loaded into memory at import time, so expect a slow
first boot. Subsequent starts take a few seconds.

Verify it's alive:

```bash
curl -X POST http://localhost:8000/summarize \
  -H "Content-Type: application/json" \
  -d '{"text":"Water boils at 100 degrees Celsius at sea level."}'
```

Interactive docs are at `http://localhost:8000/docs`.

### Exposing the backend to a phone

A physical device can't reach `localhost` on your machine. The repo ships `ngrok.exe` in
`transcription-backend/` (gitignored via `*.exe`) for this:

```bash
./ngrok http 8000
```

Copy the `https://....ngrok-free.app` forwarding URL — you'll need it in the next section.

Alternatives: use your machine's LAN IP (`http://192.168.x.x:8000`) if the phone is on the same
Wi-Fi, or deploy the backend somewhere permanent.

---

## Frontend setup

From the repo root:

```bash
npm install
npm start           # Expo dev server + QR code
```

Platform-specific shortcuts:

```bash
npm run android     # expo start --android
npm run ios         # expo start --ios
npm run web         # expo start --web
```

Scan the QR code with Expo Go, or press `a` / `i` / `w` in the terminal.

---

## Connecting the app to the backend

**This is the one step that always needs doing.** The backend URL is hardcoded:

```js
// screens/DashboardScreen.js:11
const SERVER_URL = 'https://8736-41-62-86-194.ngrok-free.app';
```

That value is a dead ngrok tunnel from a previous session. Replace it with your own ngrok URL, LAN
address, or deployed host. Free ngrok tunnels get a **new URL every restart**, so this needs updating
each time you restart ngrok. If the app reports network errors on every action, this is almost
certainly why.

For web builds you can point it at `http://localhost:8000` directly.

---

## API reference

Base URL: whatever `SERVER_URL` points at. CORS is wide open (`allow_origins=["*"]`), which is fine
for development and should be tightened before any real deployment.

### `POST /transcribe`

Transcribes a single audio file with the local Whisper model.

- **Body:** `multipart/form-data` with a `file` field.
- **Accepted audio:** anything ffmpeg can decode. The client's MIME guesser covers `mp3`, `wav`,
  `m4a`, `aac`, `flac` and defaults to `audio/mpeg`.

**Response `200`**

```json
{ "text": "Transcribed contents of the audio…" }
```

Note that failures are also returned with a `200` — either as `{"error": "..."}` or as a `text` field
whose value begins with `Transcription failed:`. Check the payload, not just the status code.

The upload is written to `transcription-backend/temp/<original filename>` and deleted after
transcription.

### `POST /summarize`

Summarizes text with GPT-4.

**Request**

```json
{
  "text": "Full transcript to summarize (required, non-empty, ≤ 100000 chars)",
  "prompt": "Optional custom system prompt that replaces the default"
}
```

If `prompt` is empty, the server uses a built-in prompt that asks for concise bullet points (`•`).
If `prompt` is supplied it becomes the **entire** system message — the bullet point default is not
appended, so a custom prompt fully controls the output format. Capped at `max_tokens=500`.

**Response `200`**

```json
{ "summary": "• Point one\n• Point two" }
```

**Errors:** `400` empty `text`, `413` `text` longer than 100 000 characters, `500` upstream/OpenAI
failure. All error bodies are `{"error": "..."}`.

### `POST /generate-quiz`

Generates a 5-question multiple-choice quiz from the text with GPT-4.

**Request**

```json
{ "text": "Full transcript (required, non-empty, ≤ 100000 chars)" }
```

**Response `200`**

```json
{ "quiz": "Question 1: …\nA. …\nB. …\nC. …\nD. …\nAnswer: B\n\n…" }
```

The quiz is plain text in a fixed shape (`Question N:`, options `A`–`D`, then `Answer: X`). The
client's PDF exporter relies on that shape via regex, so changing the prompt's format will silently
degrade the exported PDF. Capped at `max_tokens=1000`. Same `400` / `413` / `500` behaviour as
`/summarize`.

---

## Project structure

```
.
├── App.js                          # Root component — SafeAreaView wrapping DashboardScreen
├── index.js                        # Expo entry point (registerRootComponent)
├── app.json                        # Expo config: name, icons, splash, platform settings
├── package.json                    # JS dependencies and npm scripts
├── assets/
│   ├── OratO.png                   # In-app logo shown at the top of the dashboard
│   ├── logo.png                    # App icon / splash / favicon
│   ├── icon.png
│   ├── splash-icon.png
│   └── favicon.png
├── screens/
│   └── DashboardScreen.js          # The entire UI and all client logic (~900 lines)
└── transcription-backend/
    ├── main.py                     # FastAPI app: /transcribe, /summarize, /generate-quiz
    ├── requirements.txt            # Python deps (incomplete — see backend setup)
    ├── .env.example                # Template for OPENAI_API_KEY
    ├── .env                        # Your real key (gitignored)
    ├── ngrok.exe                   # Tunnel binary for local dev (gitignored)
    ├── temp/                       # Scratch space for uploads, cleaned per request
    └── venv/                       # Local virtualenv (gitignored)
```

There is no navigation library — the app is a single scrolling screen.

---

## Frontend internals

Everything lives in `screens/DashboardScreen.js`. Worth knowing before you edit it:

**State**

| State | Purpose |
|---|---|
| `files` | Picked audio files (`{uri, name, type}`) |
| `transcriptions` | Per-file results (`{fileName, text}`) |
| `combinedText` | Derived: successful transcripts joined with `\n\n` |
| `customPrompt` | User-supplied system prompt for summarization |
| `summary` / `quiz` | Generated text |
| `isLoading` / `isSummarizing` / `isGeneratingQuiz` | Per-operation spinners |
| `summaryVisible` / `quizVisible` | Drive the "pop" highlight styling after generation |
| `copiedSummary` / `copiedQuiz` | 2-second clipboard confirmation |
| `showCombinedText` | Toggles the merged-transcript panel |

**Platform-specific upload handling.** `handleTranscribe` branches on `Platform.OS`. On web it
`fetch`es the blob URI and wraps it in a real `File` object; on native it appends the React Native
`{uri, name, type}` shape that Metro's `FormData` understands. If you touch upload logic, test both.

**Sequential transcription.** Files are transcribed in a `for…of` loop, one request at a time. This is
deliberate — the backend holds a single Whisper model in memory and parallel requests would contend
for it. Long queues take a while; there is no per-file progress indicator.

**PDF export** uses `expo-print` to render an HTML string to PDF, then `expo-sharing` to hand it off
to the OS share sheet. `react-native-html-to-pdf` is in `package.json` but is **not** used anywhere.

**Layout quirk.** Summary and quiz cards render *above* the upload card, not below the transcripts.
The `scrollToSummary` / `scrollToQuiz` helpers scroll to `y: 0` for that reason. `scrollToResults`
scrolls to a hardcoded `y: 500`.

**Icons** come from `@expo/vector-icons` (bundled with `expo`), using the `Ionicons` and
`MaterialIcons` sets. `react-native-vector-icons` is listed as a dependency but isn't imported.

---

## Design system

A dark crimson theme, applied inline via `StyleSheet` — there is no theme file or token layer.

| Role | Colour |
|---|---|
| App background | `#3D0000` |
| Card surface | `#5C0000`, `#500000` (summary), `#4A0000` (quiz, inputs) |
| Card border | `#7A0000` |
| Upload gradient | `#8B0000` → `#A52A2A` |
| Transcribe gradient | `#DC143C` → `#B22222` |
| Summary gradient | `#CD5C5C` → `#C71585` |
| Quiz gradient | `#B22222` → `#8B0000` |
| Primary text | `#FFFFFF` / `#F5F5F5` |
| Accent text | `#FFC0CB`, `#FFB6C1` |
| Success | `#4CAF50` |

Gradients use `expo-linear-gradient`; cards are rounded (14–24 px) with subtle elevation/shadow.

---

## Troubleshooting

**Every action fails with a network error.**
`SERVER_URL` in `screens/DashboardScreen.js:11` is stale, or the backend/ngrok isn't running. Confirm
the URL loads in the phone's browser first.

**Backend won't start: `ModuleNotFoundError: No module named 'whisper'` (or `openai`, or `dotenv`).**
You installed `requirements.txt` as-is. Install the corrected dependency list from
[Backend setup](#backend-setup).

**Transcription returns `Transcription failed: …`.**
Usually ffmpeg is missing from `PATH`, or the audio file is corrupt / an unsupported container.
Verify with `ffmpeg -version`.

**Backend startup hangs for minutes.**
First run downloading the ~1.5 GB `medium` model. Watch the terminal for download progress. To trade
accuracy for speed during development, change `whisper.load_model("medium")` in `main.py:16` to
`"base"` or `"small"`.

**Summary/quiz returns a 500.**
Check the server log — it prints a full traceback. Most often an invalid `OPENAI_API_KEY`, no GPT-4
access on the account, or a rate limit.

**413 Text is too large.**
The transcript exceeded 100 000 characters. Transcribe fewer files at once, or raise the limit in
`main.py` (and be mindful of GPT-4's context window).

**Filename collisions.** Two files with the same name uploaded in one session write to the same
`temp/` path. Rename before uploading.

---

## Known issues and limitations

These are real characteristics of the current code, not speculation — worth knowing before you build
on top of it.

- **`requirements.txt` is wrong** (`whisper` instead of `openai-whisper`; `openai` and `python-dotenv`
  missing). Fixing it is a good first PR.
- **`SERVER_URL` is hardcoded** rather than read from an env var or app config, so it must be edited
  in source for every environment change.
- **No persistence.** Transcripts, summaries and quizzes vanish on reload; picking new files clears
  everything.
- **`/transcribe` returns `200` on failure**, embedding the error in the response body. Clients must
  inspect the payload.
- **CORS is fully open** and there is no authentication, rate limiting, or file-size cap on any
  endpoint. Do not expose this backend publicly as-is.
- **Single in-memory Whisper model** means the server handles one transcription at a time; concurrent
  users will queue or contend.
- **GPT-4 is hardcoded** in both generation endpoints, as are `max_tokens` (500 / 1000) and the
  100 000-character input cap.
- **Quiz PDF export is regex-driven** against the exact prompt output format; prompt changes can break
  the PDF layout without any error.
- **Unused dependencies:** `react-native-html-to-pdf`, `react-native-vector-icons`, `mime-types`.
- **`load_dotenv()` is called twice** in `main.py` (harmless, but redundant), and duplicate imports
  exist at the top of the file.
- **Uncommitted line-ending churn:** `DashboardScreen.js`, `main.py` and `requirements.txt` currently
  show as modified purely because of CRLF/LF differences. Consider adding a `.gitattributes` with
  `* text=auto` to stop this recurring.

---

## Contributing notes

- The repo has a single commit and no CI, tests, or linter configured. Adding any of those is welcome.
- Keep new UI consistent with the crimson palette above and the existing `StyleSheet` approach, unless
  you're deliberately introducing a theme layer.
- If you add a backend endpoint, mirror the existing shape: a Pydantic request model, empty-input and
  size validation, `JSONResponse` with an explicit `status_code`, and a `traceback.print_exc()` in the
  handler so failures are diagnosable from the terminal.
- Never commit `.env`, `venv/`, `node_modules/`, or `ngrok.exe` — all are already gitignored.

---
