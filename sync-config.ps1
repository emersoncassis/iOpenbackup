# Script para aplicar alterações feitas no arquivo config/config.yaml no container
Write-Host "Copiando config/config.yaml para o container icloud..." -ForegroundColor Cyan
docker cp config/config.yaml icloud:/config/config.yaml

if ($LASTEXITCODE -eq 0) {
    Write-Host "Reiniciando container para carregar novas configuracoes..." -ForegroundColor Cyan
    docker restart icloud
    Write-Host "Sucesso! Container reiniciado. Acesse http://localhost:8080 para verificar." -ForegroundColor Green
} else {
    Write-Host "Erro ao copiar arquivo. Verifique se o container icloud esta em execucao." -ForegroundColor Red
}
