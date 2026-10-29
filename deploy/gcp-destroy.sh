#!/usr/bin/env bash
# Remove TUDO que o gcp-deploy.sh criou (para parar de gastar créditos). Apaga o banco e os dados!
# Uso: ./deploy/gcp-destroy.sh <PROJECT_ID> [REGION]
set -Eeuo pipefail
trap 'echo "ERRO: falhou na linha $LINENO: $BASH_COMMAND" >&2' ERR
PROJECT_ID="${1:?Uso: $0 <PROJECT_ID> [REGION]}"
REGION="${2:-southamerica-east1}"
read -r -p "Isto APAGA o serviço, o banco e os segredos do projeto $PROJECT_ID. Digite o ID do projeto para confirmar: " ok
[ "$ok" = "$PROJECT_ID" ] || { echo "Cancelado."; exit 1; }
g() { gcloud --project "$PROJECT_ID" "$@"; }
g run services delete casa-de-leiloes --region "$REGION" --quiet || true
g sql instances delete leilao-db --quiet || true
for s in leilao-database-url leilao-jwt-secret leilao-hash-secret; do g secrets delete "$s" --quiet || true; done
echo "OK: Removido."
