#!/usr/bin/env bash
# Build the container, push to Artifact Registry, deploy to Cloud Run.
# Tags the image with the short git SHA so rollbacks point at known commits.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your GCP project ID}"
: "${REGION:=us-central1}"
: "${SERVICE_NAME:=ebay-bestoffer-automation}"
: "${ARTIFACT_REPO:=app-images}"
: "${SVC_ACCOUNT_RUN:=${SERVICE_NAME}-run}"
: "${SQL_INSTANCE:=automation-db}"
: "${SQL_DB:=automation}"
: "${SQL_USER:=automation}"

RUN_SA_EMAIL="${SVC_ACCOUNT_RUN}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/${SERVICE_NAME}:${GIT_SHA}"

echo "→ Building image $IMAGE via Cloud Build"
gcloud builds submit --tag "$IMAGE" .

echo "→ Deploying Cloud Run service $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$RUN_SA_EMAIL" \
  --platform=managed \
  --add-cloudsql-instances="$SQL_CONNECTION" \
  --update-env-vars="NODE_ENV=production" \
  --update-env-vars="DATABASE_URL=postgresql://${SQL_USER}@localhost/${SQL_DB}?host=/cloudsql/${SQL_CONNECTION}" \
  --set-secrets="EBAY_APP_ID=ebay-app-id:latest" \
  --set-secrets="EBAY_DEV_ID=ebay-dev-id:latest" \
  --set-secrets="EBAY_CERT_ID=ebay-cert-id:latest" \
  --set-secrets="EBAY_REFRESH_TOKEN=ebay-refresh-token:latest" \
  --set-secrets="ADMIN_BEARER_TOKEN=admin-bearer-token:latest" \
  --memory=512Mi \
  --cpu=1 \
  --timeout=300 \
  --max-instances=10 \
  --allow-unauthenticated

echo
echo "✓ Deployed. URL:"
gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)'
echo
echo "Smoke test:"
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)')
echo "  curl ${SERVICE_URL}/healthz"
