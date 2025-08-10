#!/usr/bin/env bash
set -euo pipefail

RAW_JS_URL="https://raw.githubusercontent.com/BobHasNoSoul/Jellyfin-PauseScreen/refs/heads/main/pausescreen.js"

# Candidate webroot paths (common on Debian/Ubuntu/Fedora and some variations)
CANDIDATES=(
  "/usr/share/jellyfin/web"
  "/usr/lib/jellyfin/web"
  "/usr/lib/jellyfin/bin/jellyfin-web"
  "/opt/jellyfin/web"
  "/var/lib/jellyfin/web"
)

echo "Detecting Jellyfin webroot..."
WEBROOT=""

# If Jellyfin logs are available, try to parse web path (best effort)
if [[ -r /var/log/jellyfin/jellyfin*.log || -r /var/lib/jellyfin/log/jellyfin*.log ]]; then
  LOG_FILE="$(ls -t /var/log/jellyfin/jellyfin*.log /var/lib/jellyfin/log/jellyfin*.log 2>/dev/null | head -n1 || true)"
  if [[ -n "${LOG_FILE}" ]]; then
    echo "Checking logs: ${LOG_FILE}"
    # Example line: Web resources path: "/usr/share/jellyfin/web"
    FOUND_PATH="$(grep -m1 -oE 'Web resources path: \"[^\"]+\"' "$LOG_FILE" | sed -E 's/.*: \"(.*)\"/\1/')"
    if [[ -n "${FOUND_PATH:-}" && -d "$FOUND_PATH" ]]; then
      CANDIDATES=("$FOUND_PATH" "${CANDIDATES[@]}")
    fi
  fi
fi

for d in "${CANDIDATES[@]}"; do
  if [[ -f "$d/index.html" ]]; then
    WEBROOT="$d"
    break
  fi
done

if [[ -z "$WEBROOT" ]]; then
  echo "Could not find Jellyfin webroot (index.html)."
  echo "Try checking your Jellyfin logs for 'Web resources path' or look under /usr/share/jellyfin/web." 
  exit 1
fi

echo "Found webroot: $WEBROOT"

INDEX="$WEBROOT/index.html"
BACKUP="$WEBROOT/index-old.html"

# Backup index.html (avoid overwriting an existing backup)
if [[ -e "$BACKUP" ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  BACKUP="${WEBROOT}/index-old-${TS}.html"
fi

cp -p "$INDEX" "$BACKUP"
echo "Backed up index.html → $(basename "$BACKUP")"

# Inject the script tag if not already present
if grep -q 'pausescreen.js' "$INDEX"; then
  echo "Script tag already present; skipping injection."
else
  # Insert right before </head>
  sed -i '/<\/head>/i \    <script defer src="pausescreen.js"><\/script>' "$INDEX"
  echo "Injected <script defer src=\"pausescreen.js\"></script> before </head>"
fi

# Download pausescreen.js into the same directory
echo "Downloading pausescreen.js ..."
curl -fsSL -o "${WEBROOT}/pausescreen.js" "$RAW_JS_URL"
echo "Saved ${WEBROOT}/pausescreen.js"

echo
echo "Do you want the DISC version (1) or DISCLESS version (0)?"
read -rp "[1/0]: " CHOICE

echo
echo "Copy the block below into: Dashboard → General → Custom CSS"
echo "────────────────────────────────────────────────────────────"
if [[ "$CHOICE" == "1" ]]; then
  cat <<'CSS'
### With Disc, best version

    #overlay-disc {
      position: absolute !important;  
      top: calc(50 vh - (26 vw / 2)) !important;
      right: 7% !important;
      width: 26 vw !important;
      height: auto !important;
      display: block !important;
      animation: 30 s linear infinite spin !important;
      z-index: -1 !important;
      filter: brightness(80%) !important;
    }
    #overlay-plot {
      top: 61% !important;
      max-width: 54% !important;
      height: 50 vh !important;
      display: block !important;
      right: 41 vw !important;
      position: absolute !important;
      font-size: 21 px !important;
    }
    #overlay-logo {
        position: absolute !important;
        max-width: 50 vw !important; /* Max width is half the viewport width */
        max-height: 23 vh !important; /* Limits the height */
        width: auto !important; /* Ensures no forced stretching */
        height: auto !important; /* Preserves aspect ratio */
        top: 25 vh !important; /* Places it at a quarter of the viewport height */
        left: 19 vw !important; /* Centers within the left half */
        transform: translateX(-50%) !important; /* Ensures true centering */
        display: block !important;
    	margin-left: 12 vw !important;
        object-fit: contain; /* Prevents cropping/stretching */
    }
CSS
else
  cat <<'CSS'
### Discless

    #overlay-disc {
      position: absolute !important;  
      top: calc(50 vh - (26 vw / 2)) !important;
      right: 7% !important;
      width: 26 vw !important;
      height: auto !important;
      display: none !important;
      animation: 30 s linear infinite spin !important;
      z-index: -1 !important;
      filter: brightness(80%) !important;
    }
    #overlay-plot {
      top: 61% !important;
      max-width: 54% !important;
      height: 50 vh !important;
      display: block !important;
      right: 41 vw !important;
      position: absolute !important;
      font-size: 21 px !important;
      pointer-events: none;
    }
    #overlay-logo {
        position: absolute !important;
        pointer-events: none;
        max-width: 50 vw !important; /* Max width is half the viewport width */
        max-height: 23 vh !important; /* Limits the height */
        width: auto !important; /* Ensures no forced stretching */
        height: auto !important; /* Preserves aspect ratio */
        top: 25 vh !important; /* Places it at a quarter of the viewport height */
        left: 19 vw !important; /* Centers within the left half */
        transform: translateX(-50%) !important; /* Ensures true centering */
        display: block !important;
    	margin-left: 12 vw !important;
        object-fit: contain; /* Prevents cropping/stretching */
    }
    #overlay-details {
      pointer-events: none;
    }
CSS
fi
echo "────────────────────────────────────────────────────────────"
echo "Done. If you don't see changes, disable cache in DevTools and refresh or hit Ctrl+Shift+R on your client."
