# WhatsApp Group Monitor

Reads the latest messages from one WhatsApp group and can send messages to it, by driving WhatsApp Web in a browser. The target group is set in the code.

There are two independent versions that do the same job. You only need one.

| Version | Files | What you get |
|---|---|---|
| Node | `index.js` | A web dashboard at `http://localhost:3000` plus a small HTTP API |
| Python | `whatsapp.py`, `main.py`, `status.py` | A reusable `WhatsAppClient` class and two command-line scripts |

## Node version

Requires Node.js and Google Chrome.

```bash
npm install
node index.js
```

On first run, scan the QR code printed in the terminal (or shown at `http://localhost:3000`) from WhatsApp on your phone: Settings → Linked Devices → Link a Device. After that the login is remembered.

Chrome is found automatically on macOS, Windows and Linux. If yours is installed somewhere unusual, set the `CHROME_PATH` environment variable to the full path of the Chrome executable.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Dashboard showing the last 30 messages, refreshed every 10 seconds |
| GET | `/api/chakavak/messages?limit=30` | Latest messages as JSON |
| POST | `/api/chakavak/send` | Send a message. Body: `{"text": "..."}` with `Content-Type: application/json` |

The server only accepts connections from the same computer (`127.0.0.1`).

## Python version

Tested with Python 3.14.

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

Windows:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

Then:

```bash
python main.py     # opens a browser window, prints recent chats and the group's messages
python status.py   # quick headless check that the login is still valid
```

On first run, scan the QR code in the browser window that opens.

## Changing the target group

- Node: edit `TARGET_GROUP_ID` and `TARGET_KEYWORD` at the top of `index.js`.
- Python: change the keyword passed to `get_messages(...)` in `main.py` and `status.py`.

## What is not in this repo

These are created on each computer and are listed in `.gitignore`:

- `.wwebjs_auth/`, `.wwebjs_cache/`, `whatsapp_session_py/`: your logged-in WhatsApp session. Treat these like a password; anyone who has them can use your WhatsApp account.
- `node_modules/`, `.venv/`: installed dependencies, rebuilt by the commands above.

## Caveats

- This relies on undocumented internals of WhatsApp Web, so a WhatsApp update can break it without warning.
- It is unofficial automation that WhatsApp does not support; heavy or spammy use risks the account being restricted.
