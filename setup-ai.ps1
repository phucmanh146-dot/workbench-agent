$ErrorActionPreference = 'Stop'
Write-Host 'Choose a model provider:'
Write-Host '1. OpenAI'
Write-Host '2. DeepSeek'
Write-Host '3. Alibaba Cloud Model Studio (Qwen)'
Write-Host '4. Other OpenAI-compatible provider'
$provider = ([string](Read-Host 'Provider [1]')).Trim()
if (!$provider) { $provider = '1' }
$profile = switch ($provider) {
    '1' { @{base='https://api.openai.com/v1'; model='gpt-5.4-mini'} }
    '2' { @{base='https://api.deepseek.com'; model='deepseek-v4-flash'} }
    '3' { @{base='https://dashscope.aliyuncs.com/compatible-mode/v1'; model='qwen3.7-plus'} }
    '4' { @{base=''; model=''} }
    default { throw 'Choose 1, 2, 3 or 4.' }
}
if ($provider -eq '3') {
    Write-Host 'If your key uses a workspace or subscription endpoint, copy its Base URL from your Alibaba Cloud console.'
}
$base = ([string](Read-Host ("Base URL [" + $profile.base + "]"))).Trim()
if (!$base) { $base = $profile.base }
$uri = $null
if (![uri]::TryCreate($base, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or
    $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -match '/(chat/completions|responses)/?$') {
    throw 'Enter the HTTPS API base URL, including its version path, without an endpoint suffix.'
}
$model = ([string](Read-Host ("Model [" + $profile.model + "]"))).Trim()
if (!$model) { $model = $profile.model }
if (!$model) { throw 'Enter the exact model ID from your provider.' }
$searchModel = ''
if ($provider -ne '2') {
    Write-Host 'Web search requires the provider to support Responses with web_search.'
    $searchModel = ([string](Read-Host 'Search model [same as Model]')).Trim()
} else {
    Write-Host 'The DeepSeek profile uses the same DeepSeek API key for analysis and web search.'
}
$key = Read-Host 'API Key (hidden)' -AsSecureString
if ($key.Length -eq 0) { throw 'API Key cannot be empty.' }
$visionModel = ([string](Read-Host 'Vision model for images, e.g. Qwen-vlm [optional]')).Trim()
$visionProtected = $null
if ($visionModel) {
    $visionKey = Read-Host 'Vision model API Key [press Enter to reuse the key above]' -AsSecureString
    $visionProtected = if ($visionKey.Length -eq 0) {
        ConvertFrom-SecureString -SecureString $key
    } else {
        ConvertFrom-SecureString -SecureString $visionKey
    }
}

$local = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$config = @{
    baseUrl = $base.TrimEnd('/')
    model = $model
    searchModel = $searchModel
    visionModel = $visionModel
    protectedKey = ConvertFrom-SecureString -SecureString $key
    protectedVisionKey = $visionProtected
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $local 'ai-config.json'), $config)
Write-Host 'Configuration saved for this Windows user. Close the old workbench and double-click run.bat.'
