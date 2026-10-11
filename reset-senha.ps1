# Script PowerShell para resetar a senha mestra do administrador
$authFile = Join-Path $PSScriptRoot "dashboard\data\auth.json"

if (Test-Path $authFile) {
    Remove-Item $authFile -Force
    Write-Host "[SUCESSO] Credenciais do administrador resetadas com sucesso!" -ForegroundColor Green
} else {
    Write-Host "[INFO] O sistema ja esta no modo de primeiro acesso." -ForegroundColor Cyan
}

Write-Host "Abra o navegador em: http://localhost:8000 para definir seu novo usuario e senha." -ForegroundColor Yellow
