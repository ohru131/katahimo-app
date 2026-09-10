param([Parameter(Mandatory=$true)][string]$Pptx, [Parameter(Mandatory=$true)][string]$OutDir)
# pptx の各スライドを PNG に書き出す(見た目の確認用。PowerPoint COM を使う)
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$app = New-Object -ComObject PowerPoint.Application
$pres = $app.Presentations.Open((Resolve-Path $Pptx).Path, $true, $false, $false)
$pres.SaveCopyAs((Join-Path $OutDir "slide.png"), 18)
$n = $pres.Slides.Count
$pres.Close()
$app.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
Write-Output "exported $n slides"
Get-ChildItem -Recurse $OutDir -File | ForEach-Object { $_.FullName }
