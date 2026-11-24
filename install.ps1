$ErrorActionPreference = 'Stop'
$local = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $local | Out-Null

function Install-ZipTool($Name, $Url, $Folder, $Executable, $SingleTopDirectory) {
    $destination = Join-Path $local $Folder
    if (Test-Path (Join-Path $destination $Executable) -PathType Leaf) { return }
    if (Test-Path $destination) {
        throw "Incomplete tool folder: $destination. Rename it and rerun the installer."
    }

    $staging = Join-Path $local ("install-$Name-" + [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $staging 'tool.zip'
    $unpacked = Join-Path $staging 'unpacked'
    New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
    Write-Host "Downloading $Name ..."
    & curl.exe --fail --location --retry 2 --output $archive $Url
    if ($LASTEXITCODE) { throw "$Name download failed." }
    & tar.exe -xf $archive -C $unpacked
    if ($LASTEXITCODE) { throw "$Name extraction failed." }

    $source = $unpacked
    if ($SingleTopDirectory -and !(Test-Path (Join-Path $source $Executable))) {
        $folders = @(Get-ChildItem -LiteralPath $unpacked -Directory)
        if ($folders.Count -ne 1) { throw "Unexpected layout in the $Name archive." }
        $source = $folders[0].FullName
    }
    if (!(Test-Path (Join-Path $source $Executable) -PathType Leaf)) {
        throw "Expected executable missing from the $Name archive."
    }

    Move-Item -LiteralPath $source -Destination $destination
    Remove-Item -LiteralPath $archive -Force
}

Install-ZipTool 'JDK' 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip' 'jdk' 'bin\javac.exe' $true
Install-ZipTool 'Maven' 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip' 'apache-maven-3.9.11' 'bin\mvn.cmd' $true

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeSupported = $false
if ($node -and (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    $versionText = & $node.Source --version
    if ($LASTEXITCODE -eq 0 -and $versionText -match '^v(\d+\.\d+\.\d+)') {
        $version = [version]$Matches[1]
        $nodeSupported = ($version.Major -eq 20 -and $version -ge [version]'20.19.0') -or
            ($version -ge [version]'22.12.0')
    }
}
if (!$nodeSupported) {
    Install-ZipTool 'Node.js' 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip' 'node' 'npm.cmd' $true
}

Write-Host 'Building the workbench ...'
& (Join-Path $PSScriptRoot 'build.ps1')
if ($LASTEXITCODE) { exit $LASTEXITCODE }
