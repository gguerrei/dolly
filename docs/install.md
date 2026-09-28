# Install dolly

The standalone CLI includes its runtime and the local GUI. The npm package requires Bun >= 1.2. Desktop installers are available from the [latest release](https://github.com/gguerrei/dolly/releases/latest).

## macOS with Apple silicon

```sh
brew install gguerrei/dolly/dolly
dolly --version
```

For a manual installation, the release includes `dolly-macos-arm64` and `SHA256SUMS`. The desktop app is available as a `.dmg`.

## Linux x64

Download the CLI and checksum file into a temporary directory:

```sh
dolly_download_dir="$(mktemp -d)"
curl -fL https://github.com/gguerrei/dolly/releases/latest/download/dolly-linux-x64 \
  -o "$dolly_download_dir/dolly-linux-x64"
curl -fL https://github.com/gguerrei/dolly/releases/latest/download/SHA256SUMS \
  -o "$dolly_download_dir/SHA256SUMS"
(cd "$dolly_download_dir" && sha256sum --check --ignore-missing SHA256SUMS)
```

After verification reports `dolly-linux-x64: OK`, install it for your user:

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 "$dolly_download_dir/dolly-linux-x64" "$HOME/.local/bin/dolly"
export PATH="$HOME/.local/bin:$PATH"
dolly --version
```

Add `$HOME/.local/bin` to your shell's PATH if it is not already there. The desktop app is also packaged as `.deb` and `.rpm` files.

## Windows x64

Run this in PowerShell to download and verify the CLI:

```powershell
$dollyDownloadDir = Join-Path $env:TEMP ("dolly-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $dollyDownloadDir | Out-Null
Invoke-WebRequest https://github.com/gguerrei/dolly/releases/latest/download/dolly-windows-x64.exe -OutFile "$dollyDownloadDir\dolly.exe"
Invoke-WebRequest https://github.com/gguerrei/dolly/releases/latest/download/SHA256SUMS -OutFile "$dollyDownloadDir\SHA256SUMS"
$dollyExpectedHash = ((Get-Content "$dollyDownloadDir\SHA256SUMS" | Where-Object { $_ -match '\s+dolly-windows-x64\.exe$' }) -split '\s+')[0]
$dollyActualHash = (Get-FileHash "$dollyDownloadDir\dolly.exe" -Algorithm SHA256).Hash
if (-not $dollyExpectedHash -or $dollyActualHash -ne $dollyExpectedHash) { throw "Checksum verification failed" }
Write-Output "dolly.exe: OK"
```

After verification succeeds, install it for your user:

```powershell
$dollyInstallDir = Join-Path $env:LOCALAPPDATA "dolly\bin"
New-Item -ItemType Directory -Force -Path $dollyInstallDir | Out-Null
Copy-Item "$dollyDownloadDir\dolly.exe" "$dollyInstallDir\dolly.exe"
$env:PATH = "$dollyInstallDir;$env:PATH"
dolly --version
```

Add `%LOCALAPPDATA%\dolly\bin` to your user PATH in Windows Environment Variables to use it in future terminals. The desktop app has a setup `.exe` and an `.msi` installer.

## With Bun

```sh
bun add -g dollysheep
dolly --version
```

`npm install -g dollysheep` also installs the package, but running `dolly` still requires Bun >= 1.2 on your PATH. Use a standalone binary if you want the included runtime.

## Open the interface

```sh
dolly serve --open
```

This opens the included GUI in your browser. The desktop app uses the same interface in a native window.

## Use the engine in code

```sh
bun add @dollysheep/core
```

See the [library README](../packages/core/README.md) for an example.
