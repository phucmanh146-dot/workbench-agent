$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'proxy.ps1')
$previousJava = $env:JAVA_HOME
$previousPath = $env:Path
$proxySettings = $null
try {
    $local = Join-Path $PSScriptRoot '.local'
    $env:JAVA_HOME = Join-Path $local 'jdk'
    if (Test-Path "$local\node\npm.cmd") { $env:Path = "$local\node;$env:Path" }
    $maven = Join-Path $local 'apache-maven-3.9.11\bin\mvn.cmd'
    if (!(Test-Path "$env:JAVA_HOME\bin\javac.exe") -or !(Test-Path $maven)) {
        throw 'Place JDK 21+ and Maven 3.9.11 in .local/jdk and .local/apache-maven-3.9.11.'
    }
    & npm.cmd --prefix frontend --cache "$local\npm" ci --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    $release = 'backend-build-' + [guid]::NewGuid().ToString('N')
    $output = Join-Path $local $release
    $proxySettings = $null
    if (!(Test-DirectOutbound)) {
        $proxy = Read-ProxyConfig
        if (!$proxy) {
            throw 'Direct internet access is unavailable. Run setup-proxy.bat once, then rerun.'
        }
        $proxySettings = Write-MavenSettings $proxy
        Write-Host 'Company network detected. Maven will use the saved proxy.'
    }
    $mavenArgs = @("-Dmaven.repo.local=$local\m2", "-Dworkbench.build.directory=$output", "-f", 'backend/pom.xml', 'package')
    if ($proxySettings) { $mavenArgs += @('-s', $proxySettings) }
    & $maven $mavenArgs
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    [IO.File]::WriteAllText((Join-Path $local 'backend-current.txt'), $release)
} finally {
    if ($proxySettings -and (Test-Path -LiteralPath $proxySettings)) {
        Remove-Item -LiteralPath $proxySettings -Force
    }
    $env:JAVA_HOME = $previousJava
    $env:Path = $previousPath
    Pop-Location
}
