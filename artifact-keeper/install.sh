#!/usr/bin/env bash
#
# Artifact Keeper — one-line installer for Linux home labs.
#
#   curl -fsSL https://raw.githubusercontent.com/tanujdargan/tdslabs/main/artifact-keeper/install.sh | sudo bash
#
# Overridable via environment variables:
#   AK_REPO      Git repo to install from   (default: https://github.com/tanujdargan/tdslabs)
#   AK_REF       Branch or tag to install   (default: main)
#   AK_PREFIX    Install directory          (default: /opt/artifact-keeper)
#   AK_DATA_DIR  Data directory             (default: /var/lib/artifact-keeper)
#   AK_PORT      HTTP port                  (default: 8787)
#   AK_USER      Service user               (default: artifactkeeper)
#   AK_NO_BROWSER=1   Skip Chromium install (fetch-only clones)
#
set -euo pipefail

AK_REPO="${AK_REPO:-https://github.com/tanujdargan/tdslabs}"
AK_REF="${AK_REF:-main}"
AK_PREFIX="${AK_PREFIX:-/opt/artifact-keeper}"
AK_DATA_DIR="${AK_DATA_DIR:-/var/lib/artifact-keeper}"
AK_PORT="${AK_PORT:-8787}"
AK_USER="${AK_USER:-artifactkeeper}"
AK_SUBDIR="artifact-keeper"
ENV_FILE="/etc/artifact-keeper.env"
SERVICE_FILE="/etc/systemd/system/artifact-keeper.service"
PW_BROWSERS_DIR="$AK_DATA_DIR/.pw-browsers"

c_blue='\033[1;34m'; c_green='\033[1;32m'; c_yellow='\033[1;33m'; c_red='\033[1;31m'; c_reset='\033[0m'
log()  { echo -e "${c_blue}==>${c_reset} $*"; }
ok()   { echo -e "${c_green}==>${c_reset} $*"; }
warn() { echo -e "${c_yellow}==>${c_reset} $*"; }
die()  { echo -e "${c_red}error:${c_reset} $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Please run as root (e.g. pipe into 'sudo bash')."
[ "$(uname -s)" = "Linux" ] || die "This installer supports Linux only."

# --- package manager detection --------------------------------------------
PM=""
for c in apt-get dnf yum pacman zypper apk; do
  if command -v "$c" >/dev/null 2>&1; then PM="$c"; break; fi
done
[ -n "$PM" ] || warn "No known package manager found; will rely on existing tooling."

pm_install() {
  case "$PM" in
    apt-get) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf)     dnf install -y "$@" ;;
    yum)     yum install -y "$@" ;;
    pacman)  pacman -Sy --noconfirm "$@" ;;
    zypper)  zypper install -y "$@" ;;
    apk)     apk add "$@" ;;
    *)       return 1 ;;
  esac
}

# --- prerequisites: git, curl ---------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  log "Installing git..."
  [ "$PM" = "apt-get" ] && apt-get update -y >/dev/null 2>&1 || true
  pm_install git || die "Could not install git automatically. Install it and re-run."
fi

# --- Node.js (>= 18) -------------------------------------------------------
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; }
if ! node_ok; then
  log "Installing Node.js 20 LTS..."
  case "$PM" in
    apt-get)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || warn "NodeSource setup failed; trying distro node."
      pm_install nodejs || true ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || warn "NodeSource setup failed; trying distro node."
      pm_install nodejs || true ;;
    pacman) pm_install nodejs npm || true ;;
    zypper) pm_install nodejs20 npm20 || pm_install nodejs npm || true ;;
    apk)    pm_install nodejs npm || true ;;
  esac
fi
node_ok || die "Node.js >= 18 is required but could not be installed automatically. Install it and re-run."
command -v npm >/dev/null 2>&1 || pm_install npm || die "npm is required."
ok "Using $(node -v) / npm $(npm -v)"

# --- service user ----------------------------------------------------------
if ! id "$AK_USER" >/dev/null 2>&1; then
  log "Creating service user '$AK_USER'..."
  useradd --system --home-dir "$AK_DATA_DIR" --shell /usr/sbin/nologin "$AK_USER" 2>/dev/null \
    || useradd --system --home-dir "$AK_DATA_DIR" --shell /bin/false "$AK_USER"
fi

# --- fetch source ----------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
log "Downloading Artifact Keeper ($AK_REPO @ $AK_REF)..."
git clone --depth 1 --branch "$AK_REF" "$AK_REPO" "$TMP/src" >/dev/null 2>&1 \
  || die "Failed to clone $AK_REPO (ref: $AK_REF)."
[ -d "$TMP/src/$AK_SUBDIR" ] || die "Subdirectory '$AK_SUBDIR' not found in repo."

log "Installing to $AK_PREFIX ..."
mkdir -p "$AK_PREFIX"
# Preserve node_modules across upgrades where possible.
rsync -a --delete --exclude node_modules "$TMP/src/$AK_SUBDIR/" "$AK_PREFIX/" 2>/dev/null \
  || cp -a "$TMP/src/$AK_SUBDIR/." "$AK_PREFIX/"

# --- npm dependencies ------------------------------------------------------
log "Installing Node dependencies (this can take a minute)..."
( cd "$AK_PREFIX" && npm install --omit=dev --no-audit --no-fund )

# --- Chromium for full-fidelity clones ------------------------------------
CHROMIUM_PATH=""
if [ "${AK_NO_BROWSER:-0}" = "1" ]; then
  warn "AK_NO_BROWSER=1 set — skipping Chromium. Clones will use fetch-only mode."
else
  if command -v chromium >/dev/null 2>&1; then CHROMIUM_PATH="$(command -v chromium)";
  elif command -v chromium-browser >/dev/null 2>&1; then CHROMIUM_PATH="$(command -v chromium-browser)";
  elif command -v google-chrome >/dev/null 2>&1; then CHROMIUM_PATH="$(command -v google-chrome)";
  else
    log "Installing Chromium via Playwright..."
    mkdir -p "$PW_BROWSERS_DIR"
    if ( cd "$AK_PREFIX" && PLAYWRIGHT_BROWSERS_PATH="$PW_BROWSERS_DIR" npx --yes playwright-core install chromium >/dev/null 2>&1 ); then
      ok "Playwright Chromium installed into $PW_BROWSERS_DIR."
      # Resolved at runtime by playwright-core via PLAYWRIGHT_BROWSERS_PATH.
    else
      warn "Playwright install failed; trying distro Chromium package..."
      pm_install chromium || pm_install chromium-browser || warn "Could not install Chromium; falling back to fetch-only clones."
      command -v chromium >/dev/null 2>&1 && CHROMIUM_PATH="$(command -v chromium)"
    fi
  fi
fi

# --- environment file ------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  log "Writing $ENV_FILE ..."
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  {
    echo "# Artifact Keeper configuration"
    echo "NODE_ENV=production"
    echo "ARTIFACT_KEEPER_HOST=0.0.0.0"
    echo "ARTIFACT_KEEPER_PORT=$AK_PORT"
    echo "ARTIFACT_KEEPER_DATA_DIR=$AK_DATA_DIR"
    echo "ARTIFACT_KEEPER_SESSION_SECRET=$SECRET"
    echo "# Set when serving behind an HTTPS reverse proxy:"
    echo "# ARTIFACT_KEEPER_SECURE_COOKIE=true"
    echo "# ARTIFACT_KEEPER_BASE_URL=https://artifacts.example.com"
    [ -n "$CHROMIUM_PATH" ] && echo "ARTIFACT_KEEPER_CHROMIUM_PATH=$CHROMIUM_PATH"
    # Force fetch-only so a pre-existing system Chromium isn't picked up.
    [ "${AK_NO_BROWSER:-0}" = "1" ] && echo "ARTIFACT_KEEPER_DISABLE_BROWSER=true"
  } > "$ENV_FILE"
  chmod 640 "$ENV_FILE"
else
  warn "$ENV_FILE already exists — leaving it unchanged."
fi

# --- data directory + ownership -------------------------------------------
mkdir -p "$AK_DATA_DIR"
chown -R "$AK_USER:$AK_USER" "$AK_DATA_DIR" "$AK_PREFIX"
chown "$AK_USER" "$ENV_FILE" 2>/dev/null || true

# --- systemd service -------------------------------------------------------
if command -v systemctl >/dev/null 2>&1; then
  log "Installing systemd service..."
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Artifact Keeper — self-hosted Claude artifact mirror
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$AK_USER
Group=$AK_USER
WorkingDirectory=$AK_PREFIX
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $AK_PREFIX/src/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$AK_DATA_DIR
Environment=PLAYWRIGHT_BROWSERS_PATH=$PW_BROWSERS_DIR

[Install]
WantedBy=multi-user.target
EOF
  # Ensure Playwright's browser cache (if used) is writable by the service user.
  install -d -o "$AK_USER" -g "$AK_USER" "$PW_BROWSERS_DIR" 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable artifact-keeper >/dev/null 2>&1 || true
  systemctl restart artifact-keeper
  sleep 2
  if systemctl is-active --quiet artifact-keeper; then
    ok "Service is running."
  else
    warn "Service did not start cleanly. Check: journalctl -u artifact-keeper -e"
  fi
else
  warn "systemd not found. Start manually with:"
  echo "    cd $AK_PREFIX && env \$(grep -v '^#' $ENV_FILE | xargs) node src/server.js"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; IP="${IP:-localhost}"
echo
ok "Artifact Keeper installed!"
echo "   Open  http://$IP:$AK_PORT  in your browser to create the admin account."
echo "   Logs: journalctl -u artifact-keeper -f"
echo "   Config: $ENV_FILE"
echo "   Data:   $AK_DATA_DIR"
