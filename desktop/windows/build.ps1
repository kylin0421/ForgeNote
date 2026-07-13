param(
    [string]$Version = "0.1.2",
    [switch]$SkipInstaller,
    [switch]$SkipDependencyInstall,
    [switch]$PortableZip,
    [switch]$ResumeAfterFreeze
)

$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$BuildRoot = Join-Path $ProjectRoot ".build\windows"
$DownloadCache = Join-Path $BuildRoot "downloads"
$PyInstallerWork = Join-Path $BuildRoot "pyinstaller"
$DistRoot = Join-Path $ProjectRoot "dist\windows"
$BundleDir = Join-Path $DistRoot "ZhiXue"

$NodeVersion = "22.23.1"
$NodeSha256 = "f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed"
$SurrealVersion = "2.6.5"
$SurrealSha256 = "dd9b6fa15edacbde96d490dd5727b49b5cf40df80f29074c7dc17acb974f509f"
$FfmpegVersion = "8.1.2"
$FfmpegSha256 = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"

function Assert-InProject([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $rootWithSeparator = $ProjectRoot.TrimEnd('\') + '\'
    if (-not $fullPath.StartsWith($rootWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the repository: $fullPath"
    }
}

function Reset-Directory([string]$Path) {
    Assert-InProject $Path
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Download-Verified(
    [string]$Uri,
    [string]$Destination,
    [string]$ExpectedSha256
) {
    if (Test-Path -LiteralPath $Destination) {
        $existingHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($existingHash -eq $ExpectedSha256) {
            Write-Host "Using cached $(Split-Path $Destination -Leaf)"
            return
        }
        Remove-Item -LiteralPath $Destination -Force
    }

    Write-Host "Downloading $Uri"
    $Curl = Get-Command "curl.exe" -ErrorAction SilentlyContinue
    if ($Curl) {
        & $Curl.Source --fail --location --retry 5 --retry-delay 2 --output $Destination $Uri
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Uri" }
    }
    else {
        Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
    }
    $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $ExpectedSha256) {
        Remove-Item -LiteralPath $Destination -Force
        throw "SHA-256 mismatch for $Uri. Expected $ExpectedSha256, got $actualHash"
    }
}

Set-Location $ProjectRoot
New-Item -ItemType Directory -Path $DownloadCache -Force | Out-Null
$StandaloneDir = Join-Path $ProjectRoot "frontend\.next\standalone"
$TiktokenCache = Join-Path $BuildRoot "tiktoken-cache"

if (-not $ResumeAfterFreeze) {
    Reset-Directory $PyInstallerWork
    Reset-Directory $DistRoot

    if (-not $SkipDependencyInstall) {
        Write-Host "Installing locked frontend dependencies..."
        Push-Location (Join-Path $ProjectRoot "frontend")
        try {
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
        }
        finally {
            Pop-Location
        }
    }

    Write-Host "Building Next.js standalone frontend..."
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Next.js build failed" }
    }
    finally {
        Pop-Location
    }

    New-Item -ItemType Directory -Path $TiktokenCache -Force | Out-Null
    $env:TIKTOKEN_CACHE_DIR = $TiktokenCache
    uv run --locked python -c "import tiktoken; tiktoken.get_encoding('o200k_base')"
    if ($LASTEXITCODE -ne 0) { throw "Failed to prepare the tiktoken cache" }

    Write-Host "Freezing the Python launcher and services..."
    uv run --locked --with pyinstaller==6.21.0 pyinstaller `
        --noconfirm `
        --clean `
        --distpath $DistRoot `
        --workpath $PyInstallerWork `
        (Join-Path $ProjectRoot "desktop\windows\zhixue.spec")
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed" }
}

if (-not (Test-Path (Join-Path $StandaloneDir "server.js"))) {
    throw "Next.js standalone server was not produced at $StandaloneDir"
}
if (-not (Test-Path (Join-Path $BundleDir "ZhiXue.exe"))) {
    throw "Frozen ZhiXue application was not found at $BundleDir"
}
if (-not (Test-Path $TiktokenCache)) {
    throw "Tiktoken cache was not found at $TiktokenCache"
}

$NodeExe = Join-Path $DownloadCache "node-v$NodeVersion-win-x64.exe"
$SurrealExe = Join-Path $DownloadCache "surreal-v$SurrealVersion.windows-amd64.exe"
$FfmpegArchive = Join-Path $DownloadCache "ffmpeg-$FfmpegVersion-essentials_build.zip"
Download-Verified `
    "https://nodejs.org/dist/v$NodeVersion/win-x64/node.exe" `
    $NodeExe `
    $NodeSha256
Download-Verified `
    "https://github.com/surrealdb/surrealdb/releases/download/v$SurrealVersion/surreal-v$SurrealVersion.windows-amd64.exe" `
    $SurrealExe `
    $SurrealSha256
Download-Verified `
    "https://github.com/GyanD/codexffmpeg/releases/download/$FfmpegVersion/ffmpeg-$FfmpegVersion-essentials_build.zip" `
    $FfmpegArchive `
    $FfmpegSha256

Write-Host "Assembling the portable application..."
$RuntimeDir = Join-Path $BundleDir "runtime"
Reset-Directory $RuntimeDir
New-Item -ItemType Directory -Path (Join-Path $RuntimeDir "node") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $RuntimeDir "surreal") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $RuntimeDir "ffmpeg\bin") -Force | Out-Null
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $RuntimeDir "node\node.exe")
Copy-Item -LiteralPath $SurrealExe -Destination (Join-Path $RuntimeDir "surreal\surreal.exe")

$FfmpegExtract = Join-Path $BuildRoot "ffmpeg"
Reset-Directory $FfmpegExtract
Expand-Archive -LiteralPath $FfmpegArchive -DestinationPath $FfmpegExtract -Force
$FfmpegExe = Get-ChildItem -Path $FfmpegExtract -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $FfmpegExe) { throw "ffmpeg.exe was not found in the downloaded archive" }
Copy-Item -LiteralPath $FfmpegExe.FullName -Destination (Join-Path $RuntimeDir "ffmpeg\bin\ffmpeg.exe")
$BundledTiktokenCache = Join-Path $RuntimeDir "tiktoken-cache"
New-Item -ItemType Directory -Path $BundledTiktokenCache -Force | Out-Null
Copy-Item -Path (Join-Path $TiktokenCache "*") -Destination $BundledTiktokenCache -Recurse -Force

$FrontendDir = Join-Path $BundleDir "frontend"
Reset-Directory $FrontendDir
Copy-Item -Path (Join-Path $StandaloneDir "*") -Destination $FrontendDir -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $FrontendDir ".next\static") -Force | Out-Null
Copy-Item -Path (Join-Path $ProjectRoot "frontend\.next\static\*") -Destination (Join-Path $FrontendDir ".next\static") -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot "frontend\public") -Destination $FrontendDir -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot "prompts") -Destination $BundleDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $ProjectRoot "LICENSE") -Destination $BundleDir
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "THIRD_PARTY_NOTICES.md") -Destination $BundleDir

if ($PortableZip) {
    $PortableZipPath = Join-Path $DistRoot "ZhiXue-Portable-$Version.zip"
    Compress-Archive -Path (Join-Path $BundleDir "*") -DestinationPath $PortableZipPath -CompressionLevel Optimal
    Write-Host "Portable bundle: $PortableZipPath"
}

if (-not $SkipInstaller) {
    $InnoCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
        (Get-Command "ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $Iscc = $InnoCandidates | Select-Object -First 1
    if (-not $Iscc) {
        throw "Inno Setup 6 was not found. Install it with: winget install JRSoftware.InnoSetup"
    }

    & $Iscc `
        "/DAppVersion=$Version" `
        "/DSourceDir=$BundleDir" `
        "/DOutputDir=$DistRoot" `
        "/DProjectRoot=$ProjectRoot" `
        (Join-Path $PSScriptRoot "installer.iss")
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup build failed" }
}

Write-Host "Windows distribution build completed."
