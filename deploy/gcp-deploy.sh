#!/usr/bin/env bash
# Deploy no Google Cloud: Cloud Run (app) + Cloud SQL (PostgreSQL 16) + Secret Manager.
# Uso: ./deploy/gcp-deploy.sh <PROJECT_ID> [REGION]
# Requer: gcloud autenticado (gcloud auth login) e faturamento ativo no projeto (os créditos gratuitos contam).
# É seguro rodar de novo: recursos que já existem são reaproveitados e o app é reimplantado.
set -Eeuo pipefail
trap 'echo "ERRO: falhou na linha $LINENO: $BASH_COMMAND" >&2' ERR

PROJECT_ID="${1:?Uso: $0 <PROJECT_ID> [REGION]}"
REGION="${2:-southamerica-east1}"   # São Paulo
SQL_INSTANCE="leilao-db"
DB_NAME="leilao"
DB_USER="leilao"
SERVICE="casa-de-leiloes"
cd "$(dirname "$0")/.."

g() { gcloud --project "$PROJECT_ID" "$@"; }
exists_secret() { g secrets describe "$1" >/dev/null 2>&1; }
# Gera N caracteres hexadecimais. (Não usar `tr ... | head`: com pipefail o SIGPIPE derrubava o script em silêncio.)
rand() { head -c "$(( ${1:-40} / 2 ))" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

echo "==> Habilitando APIs"
g services enable run.googleapis.com sqladmin.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

echo "==> Cloud SQL ($SQL_INSTANCE) — a criação leva alguns minutos"
if ! g sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  g sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=ENTERPRISE \
    --tier=db-f1-micro --region="$REGION" --storage-size=10GB --availability-type=zonal
fi
g sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 \
  || g sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

echo "==> Segredos"
if ! exists_secret leilao-database-url; then
  DB_PASS="$(rand 32)"
  # listagem em vez de `describe` (subcomando ausente em versões antigas do gcloud); sem pipe para não cair em SIGPIPE
  EXISTING_USERS=" $(g sql users list --instance="$SQL_INSTANCE" --format='value(name)' | tr '\n' ' ') "
  if [[ "$EXISTING_USERS" == *" $DB_USER "* ]]; then
    g sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS"
  else
    g sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASS"
  fi
  CONN="$(g sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
  printf 'postgres://%s:%s@/%s?host=/cloudsql/%s' "$DB_USER" "$DB_PASS" "$DB_NAME" "$CONN" \
    | g secrets create leilao-database-url --data-file=-
fi
exists_secret leilao-jwt-secret  || rand 48 | g secrets create leilao-jwt-secret --data-file=-
# ATENÇÃO: trocar o HASH_SECRET invalida a auditoria dos lances já gravados. Não recrie depois de ter dados.
exists_secret leilao-hash-secret || rand 48 | g secrets create leilao-hash-secret --data-file=-

PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in leilao-database-url leilao-jwt-secret leilao-hash-secret; do
  g secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUN_SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done
# cloudsql.client: o app conecta no banco. cloudbuild.builds.builder: em projetos novos o `run deploy --source`
# faz o build com esta conta e ela não vem com permissão de build.
for role in roles/cloudsql.client roles/cloudbuild.builds.builder; do
  g projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role="$role" >/dev/null
done

echo "==> Build e deploy no Cloud Run (usa o Dockerfile da raiz)"
# --no-cpu-throttling + --min-instances=1: o job que liquida os leilões roda em segundo plano
#   e precisa de CPU mesmo sem requisições.
# --max-instances=1: o barramento de eventos (SSE) é em memória.
# --timeout=3600: conexões SSE longas (o navegador reconecta sozinho).
g run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated \
  --add-cloudsql-instances "$(g sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')" \
  --set-secrets "DATABASE_URL=leilao-database-url:latest,JWT_SECRET=leilao-jwt-secret:latest,HASH_SECRET=leilao-hash-secret:latest" \
  --min-instances=1 --max-instances=1 --no-cpu-throttling --cpu=1 --memory=512Mi \
  --timeout=3600 --concurrency=80

URL="$(g run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "OK: No ar: $URL"
echo "  Teste: curl $URL/api/health"
