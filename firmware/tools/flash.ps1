# Met à jour l'AK820 Pro (QMK « Cadran ») depuis Windows, sans toucher au clavier.
#
#   powershell -ExecutionPolicy Bypass -File flash.ps1 -Bin ak820pro-cadran-v1.bin
#
# Il faut dans le même dossier (ou -Tools <dossier>) :
#   ak820-maj.exe          (firmware/tools/build-windows.sh)
#   sonixflasher-hid.exe   (firmware/tools/sonixflasher/build.sh : SonixFlasherC + correctifs)
#   ak820ctl.exe           (facultatif, remet l'horloge à l'heure du PC)
param(
    [Parameter(Mandatory = $true)] [string]$Bin,
    [string]$Tools = $PSScriptRoot,
    [int]$WaitSeconds = 120,
    # Efface toute la puce, EEPROM comprise (réglages, keymap, couleurs par touche).
    [switch]$FullErase
)
$ErrorActionPreference = 'Stop'

function Test-Usb([string]$Id) {
    [bool](Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.InstanceId -match "VID_0C45&PID_$Id" })
}
# Lance un outil et affiche sa sortie. Sa sortie d'erreur ne doit pas arrêter le script :
# avec une redirection (*> journal), PowerShell 5 la transforme en erreur, et avec
# ErrorActionPreference = Stop le flasheur était coupé avant l'écriture (21/11/2026).
function Invoke-Tool([string]$Exe, [string[]]$Arguments) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $old
    }
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
    $null = Invoke-Tool "$Tools\ak820-maj.exe" @('boot')
    if (-not (Wait-Usb '7140' 15)) {
        Write-Host "Le clavier ne répond pas à la commande : appuyez sur Fn+Échap (attente $WaitSeconds s)."
        if (-not (Wait-Usb '7140' $WaitSeconds)) { throw 'Mode flash non détecté (0c45:7140).' }
    }
}

Start-Sleep -Seconds 1
# Le flasheur efface toute la puce, et l'image .bin fait 256 Ko complets (zéros jusqu'au
# bout) : l'EEPROM émulée (réglages, keymap, couleurs par touche), tout en haut de la
# mémoire, était effacée puis écrasée à chaque mise à jour. Avec le flasheur corrigé
# (SF_ERASE_PAGES), on n'efface que les pages du micrologiciel et on n'écrit qu'elles ;
# l'indicateur de validité de l'image (4 octets tout au bout) reste celui du flash précédent.
# Un flasheur sans le correctif ignore la variable et efface tout, sans autre conséquence.
$File = $Bin
if ($FullErase) {
    Remove-Item Env:SF_ERASE_PAGES -ErrorAction SilentlyContinue
    Write-Host 'Effacement complet de la puce (EEPROM comprise).'
} else {
    $bytes = [IO.File]::ReadAllBytes($Bin)
    if ($bytes.Length -ne 262144) { throw "Image inattendue ($($bytes.Length) octets, 262144 attendus) : utiliser -FullErase." }
    $last = $bytes.Length - 5   # sans l'indicateur de fin d'image
    while ($last -ge 0 -and $bytes[$last] -eq 0) { $last-- }
    $pages = [int][math]::Ceiling(($last + 1) / 1024)
    if ($pages -lt 16 -or $pages -gt 230) { throw "Taille du micrologiciel douteuse ($pages Ko) : utiliser -FullErase." }
    $File = Join-Path $env:TEMP 'ak820-cadran-trim.bin'
    [IO.File]::WriteAllBytes($File, $bytes[0..($pages * 1024 - 1)])
    $env:SF_ERASE_PAGES = "$($pages + 2)"
    Write-Host "Écriture de $pages Ko seulement, effacement de $($pages + 2) pages : les réglages sont gardés."
}
Write-Host 'Écriture du micrologiciel...'
$flashCode = Invoke-Tool "$Tools\sonixflasher-hid.exe" @('--vid-pid', '0c45/7140', '--file', $File)
# Le bootloader redémarre parfois le clavier dès l'écriture vérifiée : la toute
# dernière somme de contrôle échoue alors que le flash est bon. On juge sur
# le redémarrage et sur la version renvoyée par le clavier.
if (-not (Wait-Usb '8009' 30)) {
    throw "Échec du flash (code $flashCode). Le clavier reste en mode flash : relancer le script."
}
if ($flashCode -ne 0) { Write-Host "Avertissement : le flasheur a renvoyé le code $flashCode, vérification par la version." }
Start-Sleep -Seconds 3
$null = Invoke-Tool "$Tools\ak820-maj.exe" @('version')
if (Test-Path "$Tools\ak820ctl.exe") { $null = Invoke-Tool "$Tools\ak820ctl.exe" @('clock') }
Write-Host 'Terminé. Éteindre et rallumer le clavier pour finir.'
