#!/usr/bin/env bash
# Imports the Azure Monitor-flavored CL-IDP dashboards (infra/grafana/azure-dashboards/)
# into the Azure Managed Grafana instance provisioned by infra/main.bicep
# (modules/grafana.bicep). ARM/Bicep cannot provision Grafana dashboard
# *content* directly, so this is a separate, idempotent post-deploy step —
# safe to re-run any time the dashboard JSON changes (uses --overwrite).
#
# What it does:
#   1. Resolves the Log Analytics workspace and Application Insights
#      resource IDs for the resource group (the dashboards' KQL queries
#      target these by resource ID, substituted in at import time rather
#      than hardcoded, since both are only known after deployment).
#   2. Substitutes those resource IDs into a staged copy of each dashboard
#      JSON (the committed files use literal placeholders so they stay
#      environment-agnostic in source control).
#   3. Imports each dashboard into the named Grafana instance's "CL-IDP"
#      folder via `az grafana dashboard create --overwrite true`.
#
# Usage: infra/scripts/import-grafana-dashboards.sh [resource-group] [grafana-name] [name-prefix]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${1:-rg-cl-idp-prod-eus2}"
NAME_PREFIX="${3:-clidpprod}"
GRAFANA_NAME="${2:-${NAME_PREFIX}-grafana}"
LOG_ANALYTICS_WORKSPACE_NAME="${NAME_PREFIX}-law"
APP_INSIGHTS_NAME="${NAME_PREFIX}-appi"

az extension add --name amg --upgrade --only-show-errors >/dev/null 2>&1 || true

echo "Resolving workspace/App Insights resource IDs in '${RESOURCE_GROUP}'..."
WORKSPACE_ID="$(az monitor log-analytics workspace show \
  --resource-group "${RESOURCE_GROUP}" \
  --workspace-name "${LOG_ANALYTICS_WORKSPACE_NAME}" \
  --query id -o tsv)"
APP_INSIGHTS_ID="$(az monitor app-insights component show \
  --resource-group "${RESOURCE_GROUP}" \
  --app "${APP_INSIGHTS_NAME}" \
  --query id -o tsv)"

if [[ -z "${WORKSPACE_ID}" || -z "${APP_INSIGHTS_ID}" ]]; then
  echo "Could not resolve workspace/App Insights resource IDs — is the stack deployed?" >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGING_DIR}"' EXIT

az grafana folder create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${GRAFANA_NAME}" \
  --title "CL-IDP" \
  --only-show-errors \
  -o none 2>/dev/null || true # idempotent: errors if the folder already exists, which is fine

for dashboard in cl-idp-ops cl-idp-finops; do
  SRC="${REPO_ROOT}/infra/grafana/azure-dashboards/${dashboard}.json"
  DEST="${STAGING_DIR}/${dashboard}.json"
  sed \
    -e "s#__LOG_ANALYTICS_WORKSPACE_RESOURCE_ID__#${WORKSPACE_ID}#g" \
    -e "s#__APP_INSIGHTS_RESOURCE_ID__#${APP_INSIGHTS_ID}#g" \
    "${SRC}" > "${DEST}"

  echo "Importing ${dashboard} into Grafana '${GRAFANA_NAME}'..."
  az grafana dashboard create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${GRAFANA_NAME}" \
    --folder "CL-IDP" \
    --definition "${DEST}" \
    --overwrite true \
    --only-show-errors \
    -o none
done

echo "Done. Dashboards are in the 'CL-IDP' folder of https://${GRAFANA_NAME}.<region>.grafana.azure.com"
