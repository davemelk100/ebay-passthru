#!/usr/bin/env bash
# One-shot GCP project bootstrap. Idempotent — re-running on an existing
# project skips what's already created. Inputs come from env vars at the top
# so the script reads top-down with no prompts.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your GCP project ID}"
: "${REGION:=us-central1}"
: "${SERVICE_NAME:=ebay-bestoffer-automation}"
: "${ARTIFACT_REPO:=app-images}"
: "${SVC_ACCOUNT_RUN:=${SERVICE_NAME}-run}"
: "${SVC_ACCOUNT_SCHED:=${SERVICE_NAME}-scheduler}"
: "${SQL_INSTANCE:=automation-db}"
: "${SQL_DB:=automation}"
: "${SQL_USER:=automation}"
: "${SQL_TIER:=db-f1-micro}"   # cheapest non-shared for v0; bump for prod

echo "→ Setting active project to $PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "→ Enabling APIs (idempotent)"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  vpcaccess.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com

echo "→ Creating Artifact Registry repository ($ARTIFACT_REPO)"
gcloud artifacts repositories create "$ARTIFACT_REPO" \
  --location="$REGION" \
  --repository-format=docker \
  --description="Cloud Run images" \
  2>/dev/null || echo "  (already exists)"

echo "→ Creating service accounts"
for SA in "$SVC_ACCOUNT_RUN" "$SVC_ACCOUNT_SCHED"; do
  gcloud iam service-accounts create "$SA" \
    --display-name="$SA" \
    2>/dev/null || echo "  ($SA already exists)"
done

RUN_SA_EMAIL="${SVC_ACCOUNT_RUN}@${PROJECT_ID}.iam.gserviceaccount.com"
SCHED_SA_EMAIL="${SVC_ACCOUNT_SCHED}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "→ Granting runtime SA the roles it needs"
for ROLE in \
  roles/secretmanager.secretAccessor \
  roles/cloudsql.client \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$RUN_SA_EMAIL" \
    --role="$ROLE" \
    --condition=None >/dev/null
done

echo "→ Granting scheduler SA permission to invoke Cloud Run"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SCHED_SA_EMAIL" \
  --role="roles/run.invoker" \
  --condition=None >/dev/null

echo "→ Creating Cloud SQL instance ($SQL_INSTANCE, tier=$SQL_TIER)"
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_15 \
  --tier="$SQL_TIER" \
  --region="$REGION" \
  --availability-type=ZONAL \
  2>/dev/null || echo "  ($SQL_INSTANCE already exists)"

echo "→ Creating database ($SQL_DB)"
gcloud sql databases create "$SQL_DB" --instance="$SQL_INSTANCE" \
  2>/dev/null || echo "  ($SQL_DB already exists)"

echo "→ Creating SQL user ($SQL_USER)"
SQL_PASSWORD=$(openssl rand -base64 32 | tr -d '+/=' | cut -c1-24)
gcloud sql users create "$SQL_USER" --instance="$SQL_INSTANCE" --password="$SQL_PASSWORD" \
  2>/dev/null || echo "  ($SQL_USER already exists — password not rotated)"

echo
echo "✓ Bootstrap complete"
echo "  Project:        $PROJECT_ID"
echo "  Region:         $REGION"
echo "  Runtime SA:     $RUN_SA_EMAIL"
echo "  Scheduler SA:   $SCHED_SA_EMAIL"
echo "  Cloud SQL:      $SQL_INSTANCE / db=$SQL_DB / user=$SQL_USER"
echo "  Image registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}"
echo
echo "Next: store secrets via Secret Manager (TODO: infra/gcloud/secrets.sh),"
echo "      then run ./infra/gcloud/deploy.sh"
