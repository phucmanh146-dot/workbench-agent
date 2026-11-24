# Shared helpers for company networks that require an authenticated web proxy.
# Java (Maven, Spring Boot) does not read Windows PAC or proxy settings, so the
# scripts detect when direct outbound fails and route through the saved proxy.

function Test-DirectOutbound {
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $async = $tcp.BeginConnect('repo.maven.apache.org', 443, $null, $null)
        if ($async.AsyncWaitHandle.WaitOne(4000) -and $tcp.Connected) { return $true }
    } catch {} finally { $tcp.Close() }
    return $false
}

function Read-ProxyConfig {
    $path = Join-Path $PSScriptRoot '.local\proxy-config.json'
    if (!(Test-Path -LiteralPath $path)) { return $null }
    try {
        $config = [IO.File]::ReadAllText($path) | ConvertFrom-Json
        if (!$config.host -or !$config.port -or !$config.user -or !$config.protectedPassword) { return $null }
        $secure = ConvertTo-SecureString -String $config.protectedPassword
        $credential = [pscredential]::new($config.user, $secure)
        return @{
            host = $config.host
            port = [int]$config.port
            user = $config.user
            password = $credential.GetNetworkCredential().Password
        }
    } catch {
        Write-Warning 'Cannot open the saved proxy configuration. Run setup-proxy.bat again.'
        return $null
    }
}

function Get-WorkbenchProxy {
    if (Test-DirectOutbound) { return $null }
    return (Read-ProxyConfig)
}

function Write-MavenSettings($proxy) {
    $path = Join-Path $PSScriptRoot '.local\maven-settings.xml'
    $xml = @"
<settings>
  <proxies>
    <proxy>
      <id>company-network</id>
      <active>true</active>
      <protocol>https</protocol>
      <host>$($proxy.host)</host>
      <port>$($proxy.port)</port>
      <username>$($proxy.user)</username>
      <password>$($proxy.password)</password>
      <nonProxyHosts>localhost|127.0.0.1</nonProxyHosts>
    </proxy>
    <proxy>
      <id>company-network-http</id>
      <active>true</active>
      <protocol>http</protocol>
      <host>$($proxy.host)</host>
      <port>$($proxy.port)</port>
      <username>$($proxy.user)</username>
      <password>$($proxy.password)</password>
      <nonProxyHosts>localhost|127.0.0.1</nonProxyHosts>
    </proxy>
  </proxies>
</settings>
"@
    [IO.File]::WriteAllText($path, $xml)
    return $path
}
