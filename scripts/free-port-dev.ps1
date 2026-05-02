# Libera puertos TCP en escucha (por defecto 5000 y 5001) para evitar backends
# viejos (python, backend.exe) al arrancar el entorno de desarrollo.
#
# Uso (desde la raíz del repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/free-port-dev.ps1
#   powershell ... -File scripts/free-port-dev.ps1 -WhatIf   # solo listar
#   powershell ... -File scripts/free-port-dev.ps1 -Ports 5000

param(
    [int[]]$Ports = @(5000, 5001),
    [switch]$WhatIf
)

function Get-ListenPids {
    param([int]$Port)
    $pids = [System.Collections.Generic.HashSet[int]]::new()
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            ForEach-Object { [void]$pids.Add($_.OwningProcess) }
    } catch {
        netstat -ano | ForEach-Object {
            if ($_ -match ":$Port\s+.*LISTENING\s+(\d+)\s*$") {
                [void]$pids.Add([int]$Matches[1])
            }
        }
    }
    return @($pids)
}

foreach ($port in $Ports) {
    $pids = Get-ListenPids -Port $port
    if ($pids.Count -eq 0) {
        Write-Host "[free-port] $port : (libre)"
        continue
    }
    $list = ($pids | Sort-Object) -join ", "
    Write-Host "[free-port] $port : PIDs $list"
    if ($WhatIf) { continue }
    foreach ($pid in ($pids | Sort-Object)) {
        try {
            $proc = Get-Process -Id $pid -ErrorAction Stop
            Write-Host "  -> Stop-Process -Id $pid ($($proc.ProcessName))"
            Stop-Process -Id $pid -Force -ErrorAction Stop
        } catch {
            Write-Warning "  -> No se pudo terminar PID ${pid}: $_"
        }
    }
}

if ($WhatIf) {
    Write-Host "[free-port] WhatIf: no se ha terminado ningún proceso."
}
