#!/usr/bin/env bash
# Autoriza o GitHub Actions a publicar no Cloud Run SEM chave de serviço (Workload Identity Federation / OIDC).
# Rode UMA vez, depois de ./deploy/gcp-deploy.sh.
# Uso: ./deploy/gcp-github-setup.sh <PROJECT_ID> <OWNER/REPO> [REGION]
set -Eeuo pipefail
trap 'echo "ERRO: falhou na linha $LINENO: $BASH_COMMAND" >&2' ERR

PROJECT_ID="${1:?Uso: $0 <PROJECT_ID> <OWNER/REPO> [REGION]}"
REPO="${2:?Uso: $0 <PROJECT_ID> <OWNER/REPO> [REGION]}"
REGION="${3:-southamerica-east1}"
SA_NAME="github-deployer"
POOL="github-pool"
PROVIDER="github-provider"

g() { gcloud --project "$PROJECT_ID" "$@"; }
PROJECT_NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Conta de serviço do deploy"
g iam service-accounts describe "$SA" >/dev/null 2>&1 || g iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer"
# Mínimo para `gcloud run deploy --source` (build no Cloud Build + publicação no Cloud Run).
for role in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer \
            roles/storage.admin roles/serviceusage.serviceUsageConsumer; do
  g projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$role" >/dev/null
done
g iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:$SA" \
  --role=roles/iam.serviceAccountUser >/dev/null

echo "==> Workload Identity (confiança restrita a $REPO)"
g iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || g iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub"
g iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 \
  || g iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global \
       --workload-identity-pool="$POOL" --issuer-uri="https://token.actions.githubusercontent.com" \
       --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
       --attribute-condition="assertion.repository=='${REPO}'"
g iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" >/dev/null

echo
echo "OK: Pronto. No GitHub: Settings > Secrets and variables > Actions > aba Variables > New repository variable:"
echo "  GCP_PROJECT_ID       = $PROJECT_ID"
echo "  GCP_REGION           = $REGION"
echo "  GCP_WIF_PROVIDER     = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "  GCP_SERVICE_ACCOUNT  = $SA"
