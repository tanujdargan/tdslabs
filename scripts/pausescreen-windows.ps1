#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$RawJsUrl = 'https://raw.githubusercontent.com/BobHasNoSoul/Jellyfin-PauseScreen/refs/heads/main/pausescreen.js'

Write-Host "Detecting Jellyfin webroot on Windows..."

# Try to read the latest Jellyfin log for "Web resources path", else fall back to default install path
$logDirCandidates = @(
  'C:\ProgramData\Jellyfin\Server\log',
  'C:\ProgramData\Jellyfin\Server\logs'
) | Where-Object { Test-Path $_ }

$webroot = $null
if ($logDirCandidates.Count -gt 0) {
  $latestLog = Get-ChildItem -Path $logDirCandidates -Recurse -Filter jellyfin*.log -ErrorAction SilentlyContinue |
               Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latestLog) {
    $line = Select-String -Path $latestLog.FullName -Pattern 'Web resources path:\s*"([^"]+)"' -SimpleMatch:$false | Select-Object -First 1
    if ($line) {
      $m = [Regex]::Match($line.Line, 'Web resources path:\s*"([^"]+)"')
      if ($m.Success) { $webroot = $m.Groups[1].Value }
    }
  }
}

if (-not $webroot) {
  $webroot = 'C:\Program Files\Jellyfin\Server\jellyfin-web'
}

$index = Join-Path $webroot 'index.html'
if (-not (Test-Path $index)) {
  Throw "Could not find index.html. Checked: $index"
}

Write-Host "Found webroot: $webroot"

# Backup
$backup = Join-Path $webroot 'index-old.html'
if (Test-Path $backup) {
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $webroot "index-old-$ts.html"
}
Copy-Item $index $backup -Force
Write-Host "Backed up index.html → $(Split-Path $backup -Leaf)"

# Inject script tag if missing
$indexContent = Get-Content $index -Raw
if ($indexContent -match 'pausescreen\.js') {
  Write-Host "Script tag already present; skipping injection."
} else {
  $indexContent = $indexContent -replace '</head>', '    <script defer src="pausescreen.js"></script>' + [Environment]::NewLine + '</head>'
  Set-Content -Path $index -Value $indexContent -Encoding UTF8
  Write-Host "Injected <script defer src=""pausescreen.js""></script> before </head>"
}

# Download JS
$jsPath = Join-Path $webroot 'pausescreen.js'
Write-Host "Downloading pausescreen.js ..."
Invoke-WebRequest -Uri $RawJsUrl -OutFile $jsPath -UseBasicParsing
Write-Host "Saved $jsPath"

# Ask for disc vs discless and print exact README CSS
Write-Host ""
$choice = Read-Host "Disc version = 1, Discless = 0 [1/0]"
Write-Host ""
Write-Host "Copy the block below into: Dashboard → General → Custom CSS"
Write-Host "────────────────────────────────────────────────────────────"

if ($choice -eq '1') {
@'
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
'@ | Write-Host
} else {
@'
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
'@ | Write-Host
}

Write-Host "────────────────────────────────────────────────────────────"
Write-Host "Done. If you don't see changes, disable cache in DevTools and refresh."
