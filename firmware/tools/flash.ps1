# Met à jour l'AK820 Pro (QMK « Cadran ») depuis Windows, sans toucher au clavier.
#
#   powershell -ExecutionPolicy Bypass -File flash.ps1 -Bin ak820pro-cadran-v1.bin
#
# Il faut dans le même dossier (ou -Tools <dossier>) :
#   ak820-maj.exe          (firmware/tools/build-windows.sh)
#   sonixflasher-hid.exe   (SonixFlasherC + firmware/tools/sonixflasher/hidapi-windows.patch)
#   ak820ctl.exe           (facultatif, remet l'horloge à l'heure du PC)
param(
    [Parameter(Mandatory = $true)] [string]$Bin,
    [string]$Tools = $PSScriptRoot,
    [int]$WaitSeconds = 120
)
$ErrorActionPreference = 'Stop'

function Test-Usb([string]$Id) {
    [bool](Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -match "VID_0C45&PID_$Id" })
}
function Wait-Usb([string]$Id, [int]$Seconds) {
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        if (Test-Usb $Id) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

if (-not (Test-Path $Bin)) { throw "Fichier introuvable : $Bin" }

if (-not (Test-Usb '7140')) {
    Write-Host 'Redémarrage du clavier en mode flash...'
    & "$Tools\ak820-maj.exe" boot
    if (-not (Wait-Usb '7140' 15)) {
        Write-Host "Le clavier ne répond pas à la commande : appuyez sur Fn+Échap (attente $WaitSeconds s)."
        if (-not (Wait-Usb '7140' $WaitSeconds)) { throw 'Mode flash non détecté (0c45:7140).' }
    }
}

Start-Sleep -Seconds 1
Write-Host 'Écriture du micrologiciel...'
& "$Tools\sonixflasher-hid.exe" --vid-pid 0c45/7140 --file $Bin
$flashCode = $LASTEXITCODE
# Le bootloader redémarre parfois le clavier dès l'écriture vérifiée : la toute
# dernière somme de contrôle échoue alors que le flash est bon. On juge sur
# le redémarrage et sur la version renvoyée par le clavier.
if (-not (Wait-Usb '8009' 30)) {
    throw "Échec du flash (code $flashCode). Le clavier reste en mode flash : relancer le script."
}
if ($flashCode -ne 0) { Write-Host "Avertissement : le flasheur a renvoyé le code $flashCode, vérification par la version." }
Start-Sleep -Seconds 3
& "$Tools\ak820-maj.exe" version
if (Test-Path "$Tools\ak820ctl.exe") { & "$Tools\ak820ctl.exe" clock }
Write-Host 'Terminé. Éteindre et rallumer le clavier pour finir.'
