param([switch]$OpenBrowser)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$browserJob = $null
$priorFeishuId = $env:WORKBENCH_FEISHU_APP_ID
$priorFeishuSecret = $env:WORKBENCH_FEISHU_APP_SECRET
$priorAiBase = $env:WORKBENCH_AI_BASE_URL
$priorAiModel = $env:WORKBENCH_AI_MODEL
$priorAiKey = $env:WORKBENCH_AI_KEY
$priorAiSearchModel = $env:WORKBENCH_AI_SEARCH_MODEL
$priorAiVisionModel = $env:WORKBENCH_AI_VISION_MODEL
$priorAiVisionKey = $env:WORKBENCH_AI_VISION_KEY
$priorProxyHost = $env:WORKBENCH_PROXY_HOST
$priorProxyPort = $env:WORKBENCH_PROXY_PORT
$priorProxyUser = $env:WORKBENCH_PROXY_USER
$priorProxyPassword = $env:WORKBENCH_PROXY_PASSWORD
try {
    . (Join-Path $PSScriptRoot 'proxy.ps1')
    $java = Join-Path $PSScriptRoot '.local\jdk\bin\java.exe'
    $release = 'backend-build'
    $current = Join-Path $PSScriptRoot '.local\backend-current.txt'
    if (Test-Path -LiteralPath $current) {
        $release = [IO.File]::ReadAllText($current).Trim()
        if ($release -notmatch '^backend-build-[a-f0-9]{32}$') {
            throw 'Invalid local build pointer. Run setup.bat again.'
        }
    }
    $jar = Join-Path $PSScriptRoot ".local\$release\workbench-0.1.0.jar"
    if (!(Test-Path $java) -or !(Test-Path $jar) -or !(Test-Path 'frontend/dist/index.html')) {
        throw 'Local build missing. Run the installation BAT first.'
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($jar)
    try {
        if (!$archive.GetEntry('BOOT-INF/classes/local/workbench/Interruptions.class')) {
            throw 'The backend build is out of date. Close the running workbench, run setup.bat, then run run.bat.'
        }
    } finally {
        $archive.Dispose()
    }
    $feishuConfig = Join-Path $PSScriptRoot '.local\feishu-config.json'
    if (!$priorFeishuId -and !$priorFeishuSecret -and (Test-Path -LiteralPath $feishuConfig)) {
        try {
            $config = [IO.File]::ReadAllText($feishuConfig) | ConvertFrom-Json
            if ($config.appId -notmatch '^cli_[a-zA-Z0-9]+$' -or !$config.protectedSecret) {
                throw 'Invalid saved Feishu configuration.'
            }
            $password = ConvertTo-SecureString -String $config.protectedSecret
            $credential = [pscredential]::new($config.appId, $password)
            $env:WORKBENCH_FEISHU_APP_SECRET = $credential.GetNetworkCredential().Password
            $env:WORKBENCH_FEISHU_APP_ID = $config.appId
        } catch {
            Write-Warning 'Cannot open saved Feishu configuration for this Windows user. Run setup-feishu.bat again.'
        }
    } elseif ([bool]$priorFeishuId -ne [bool]$priorFeishuSecret) {
        Write-Warning 'Set both Feishu environment variables, or clear both to use the saved configuration.'
    }
    $aiConfig = Join-Path $PSScriptRoot '.local\ai-config.json'
    if (!$priorAiBase -and !$priorAiModel -and !$priorAiKey -and (Test-Path -LiteralPath $aiConfig)) {
        try {
            $config = [IO.File]::ReadAllText($aiConfig) | ConvertFrom-Json
            if (!$config.baseUrl -or !$config.model -or !$config.protectedKey) { throw 'Invalid saved AI configuration.' }
            $key = ConvertTo-SecureString -String $config.protectedKey
            $env:WORKBENCH_AI_KEY = [pscredential]::new('workbench-ai',$key).GetNetworkCredential().Password
            $env:WORKBENCH_AI_BASE_URL = $config.baseUrl
            $env:WORKBENCH_AI_MODEL = $config.model
            if (!$priorAiSearchModel) { $env:WORKBENCH_AI_SEARCH_MODEL = $config.searchModel }
            if (!$priorAiVisionModel -and $config.visionModel) { $env:WORKBENCH_AI_VISION_MODEL = $config.visionModel }
            if ($config.protectedVisionKey) {
                $visionKey = ConvertTo-SecureString -String $config.protectedVisionKey
                $env:WORKBENCH_AI_VISION_KEY = [pscredential]::new('workbench-ai',$visionKey).GetNetworkCredential().Password
            }
        } catch {
            Write-Warning 'Cannot open the saved AI configuration. Run setup-ai.bat again.'
        }
    }
    if (!(Test-DirectOutbound)) {
        $proxy = Read-ProxyConfig
        if ($proxy) {
            $env:WORKBENCH_PROXY_HOST = $proxy.host
            $env:WORKBENCH_PROXY_PORT = $proxy.port
            $env:WORKBENCH_PROXY_USER = $proxy.user
            $env:WORKBENCH_PROXY_PASSWORD = $proxy.password
        } else {
            Write-Warning 'Direct internet access is unavailable and no proxy is configured. AI and Feishu features will not work. Run setup-proxy.bat, then restart.'
        }
    }
    if ($OpenBrowser) {
        $browserJob = Start-Job -ScriptBlock {
            $url = 'http://127.0.0.1:8080'
            for ($attempt = 0; $attempt -lt 60; $attempt++) {
                try {
                    $day = Get-Date -Format 'yyyy-MM-dd'
                    $result = Invoke-WebRequest -Uri "$url/api/interruptions/$day" -UseBasicParsing -TimeoutSec 1
                    if ($result.StatusCode -eq 200) {
                        Start-Process $url
                        break
                    }
                } catch {}
                Start-Sleep -Milliseconds 500
            }
        }
        Write-Host 'Open http://127.0.0.1:8080. Keep this window open while using the workbench.'
    }
    & $java -jar $jar
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
    $env:WORKBENCH_AI_BASE_URL = $priorAiBase
    $env:WORKBENCH_AI_MODEL = $priorAiModel
    $env:WORKBENCH_AI_KEY = $priorAiKey
    $env:WORKBENCH_AI_SEARCH_MODEL = $priorAiSearchModel
    $env:WORKBENCH_AI_VISION_MODEL = $priorAiVisionModel
    $env:WORKBENCH_AI_VISION_KEY = $priorAiVisionKey
    $env:WORKBENCH_PROXY_HOST = $priorProxyHost
    $env:WORKBENCH_PROXY_PORT = $priorProxyPort
    $env:WORKBENCH_PROXY_USER = $priorProxyUser
    $env:WORKBENCH_PROXY_PASSWORD = $priorProxyPassword
    $env:WORKBENCH_FEISHU_APP_ID = $priorFeishuId
    $env:WORKBENCH_FEISHU_APP_SECRET = $priorFeishuSecret
    if ($browserJob) { Remove-Job -Job $browserJob -Force }
    Pop-Location
}
