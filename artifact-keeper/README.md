# 📦 Artifact Keeper

A small, self-hosted app for your home lab that **mirrors public Claude
artifacts**. Give it a public artifact link and it will:

1. **Render & clone** the page (headless Chromium) into a single, self-contained
   HTML file and host it locally at `/a/<slug>`.
2. **Snapshot on change** — a background scheduler re-checks each artifact on an
   interval and keeps a new snapshot only when the content actually changes.
3. **Stay behind login** — a simple local username/password protects the
   dashboard; individual artifacts can be public or private.

It's a single Node.js process with an embedded SQLite database — no external
services to run.

---

## Quick install (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/tanujdargan/tdslabs/main/artifact-keeper/install.sh | sudo bash
```

Then open `http://<server-ip>:8787` and create your admin account.

The installer:

- installs Node.js 20 (if missing) and Chromium (for full-fidelity clones),
- creates a dedicated `artifactkeeper` system user,
- installs the app to `/opt/artifact-keeper` with data in `/var/lib/artifact-keeper`,
- writes config to `/etc/artifact-keeper.env`,
- and registers a hardened `systemd` service that starts on boot.

> Installing a pre-merge branch? Override the ref:
> `curl -fsSL .../install.sh | sudo AK_REF=claude/artifact-server-self-hosted-u5v8c3 bash`

### Installer options (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `AK_REF` | `main` | Git branch/tag to install |
| `AK_PREFIX` | `/opt/artifact-keeper` | Install directory |
| `AK_DATA_DIR` | `/var/lib/artifact-keeper` | Database + snapshots |
| `AK_PORT` | `8787` | HTTP port |
| `AK_USER` | `artifactkeeper` | Service user |
| `AK_NO_BROWSER` | _(unset)_ | Set to `1` to skip Chromium (fetch-only clones) |

---

## Run manually (Docker-free, for development)

```bash
git clone https://github.com/tanujdargan/tdslabs
cd tdslabs/artifact-keeper
npm install
npx playwright-core install chromium   # optional but recommended
cp .env.example .env                    # tweak as desired
npm start
```

Open `http://localhost:8787`.

---

## How cloning works

- **Browser mode (default):** the page is loaded in headless Chromium, the
  artifact's rendered DOM is captured — including the sandboxed iframe that
  Claude renders artifacts in — and all CSS / JS / images / fonts are inlined
  as data URIs so the stored file is fully self-contained and offline-capable.
- **Fetch fallback:** if no browser is available, the raw HTML is fetched and a
  `<base>` tag is injected so relative assets still resolve from the origin.
  This is less faithful but requires no dependencies.

Change detection hashes a whitespace-normalised copy of the captured HTML, so
trivial reformatting won't spam new snapshots.

---

## Configuration

All settings are environment variables (see [`.env.example`](.env.example)).
Common ones:

| Variable | Default | Notes |
| --- | --- | --- |
| `ARTIFACT_KEEPER_PORT` | `8787` | Listen port |
| `ARTIFACT_KEEPER_DATA_DIR` | `./data` | DB + snapshot storage |
| `ARTIFACT_KEEPER_DEFAULT_INTERVAL` | `360` | Default re-check interval (minutes) |
| `ARTIFACT_KEEPER_SCHEDULER_CRON` | `*/5 * * * *` | Scheduler wake frequency |
| `ARTIFACT_KEEPER_SECURE_COOKIE` | `false` | Set `true` behind HTTPS |
| `ARTIFACT_KEEPER_BASE_URL` | _(empty)_ | Public URL used in share links |
| `ARTIFACT_KEEPER_ARTIFACT_HOST` | _(empty)_ | Dedicated cookie-free host for cloned artifacts (see below) |
| `ARTIFACT_KEEPER_CHROMIUM_PATH` | auto | Explicit Chromium binary |
| `ARTIFACT_KEEPER_ADMIN_USER` / `_PASSWORD` | _(empty)_ | Seed admin for unattended installs |

### Serving storage-using artifacts (dedicated artifact host)

Cloned pages are sandboxed so their scripts can't reach the dashboard's session.
By default that sandbox uses an **opaque origin** — maximally safe, but it also
denies `localStorage`, `IndexedDB`, and cookies, so an artifact that uses those
(many Claude artifacts do) renders blank.

To let those work without weakening isolation, serve artifacts from a **second,
cookie-free hostname** pointed at the same app:

```ini
ARTIFACT_KEEPER_ARTIFACT_HOST=view.example.com
```

With this set:

- Public artifacts are served **only** on `view.example.com`, with same-origin
  storage enabled. Links on the dashboard redirect there automatically.
- The dashboard, login, and session cookie stay on your main host. That host is
  never served on `view.example.com` (login/dashboard there return 404), so the
  artifact host carries no cookie — a cloned page there has nothing to steal.
- Private artifacts remain on the main host (they need your session) and keep
  the strict opaque sandbox.

Point both hostnames at the app (same reverse proxy / tunnel, same
`127.0.0.1:8787`). This mirrors how GitHub serves user content from
`raw.githubusercontent.com`.

### Behind a reverse proxy (recommended)

Terminate TLS at Caddy / Nginx / Traefik and proxy to `127.0.0.1:8787`. Set
`ARTIFACT_KEEPER_SECURE_COOKIE=true` and `ARTIFACT_KEEPER_BASE_URL=https://…`.

Example Caddyfile:

```
artifacts.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

### Cloudflare Tunnel

A tunnel terminates TLS at Cloudflare and forwards plain HTTP to the app over
localhost, so there's no port to open on your router. Two things matter:

1. **Bind to localhost only** — the tunnel is the only thing that needs to reach
   the app. In `/etc/artifact-keeper.env`:

   ```ini
   ARTIFACT_KEEPER_HOST=127.0.0.1
   ARTIFACT_KEEPER_SECURE_COOKIE=true
   ARTIFACT_KEEPER_BASE_URL=https://artifacts.example.com
   ```

   `SECURE_COOKIE=true` is required: Cloudflare serves the site over HTTPS, and
   the app already trusts the `X-Forwarded-Proto` header `cloudflared` sends, so
   the login cookie is set correctly. Then
   `sudo systemctl restart artifact-keeper`.

2. **Point the tunnel ingress at `http://127.0.0.1:8787`.**

**Dashboard (Zero Trust) route:** create a tunnel, add a public hostname
`artifacts.example.com` → service `HTTP` → `127.0.0.1:8787`. Done.

**Config-file route** (`cloudflared` installed on the same host):

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-uuid>
credentials-file: /root/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: artifacts.example.com
    service: http://127.0.0.1:8787
  # Optional second hostname for storage-using artifacts (same service):
  - hostname: view.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <tunnel-name> artifacts.example.com
cloudflared tunnel route dns <tunnel-name> view.example.com   # if using an artifact host
cloudflared service install   # run as a systemd service
```

If you set `ARTIFACT_KEEPER_ARTIFACT_HOST=view.example.com`, both hostnames point
at the same service — the app routes by `Host` header.

Notes:

- **Caching:** public artifacts are served with `Cache-Control: no-cache` so a
  freshly captured snapshot is never served stale; private artifacts use
  `no-store`. Leave Cloudflare's default caching as-is (it won't cache HTML) —
  don't add a "Cache Everything" rule unless you accept a delay after updates.
- **Auth:** the app has its own login, so you don't need Cloudflare Access. If
  you add Access anyway, keep `/health` public if you want external uptime
  checks, or protect everything — your call.
- **Large clones:** snapshots inline assets as data URIs and can be a few MB;
  that's well within Cloudflare's response limits.

---

## Managing the service

```bash
sudo systemctl status artifact-keeper
sudo systemctl restart artifact-keeper
journalctl -u artifact-keeper -f
```

Upgrade in place by re-running the installer — your data and config are
preserved.

### Uninstall

```bash
sudo systemctl disable --now artifact-keeper
sudo rm /etc/systemd/system/artifact-keeper.service /etc/artifact-keeper.env
sudo rm -rf /opt/artifact-keeper /var/lib/artifact-keeper
sudo userdel artifactkeeper
```

---

## Endpoints

| Route | Auth | Description |
| --- | --- | --- |
| `/` | required | Dashboard: add / list artifacts |
| `/artifacts/:id` | required | Artifact detail, settings, snapshots |
| `/a/:slug` | public\* | Latest hosted snapshot |
| `/a/:slug/v/:snapshotId` | public\* | A specific historical snapshot |
| `/health` | none | JSON health check |

\* Private artifacts require an authenticated session.

---

## Notes & limitations

- Designed for a **trusted home-lab LAN**. Put it behind HTTPS + a reverse proxy
  before exposing it publicly.
- Cloned pages execute their own inline JavaScript when viewed — only mirror
  artifacts you trust.
- Deeply nested cross-origin iframes inside an artifact are not recursively
  inlined (one level of artifact iframe is handled, which covers Claude's
  public artifact layout).

## License

MIT — see [LICENSE](LICENSE).
