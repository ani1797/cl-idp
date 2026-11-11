#!/usr/bin/env bash
# Run after deploying api-private-connectivity.bicep and publishing an
# identity-capable API image. Only the API App Service is reconfigured.
set -euo pipefail

SUBSCRIPTION="${1:?Usage: $0 SUBSCRIPTION IMAGE [RESOURCE_GROUP] [NAME_PREFIX]}"
IMAGE="${2:?Provide the full registry/image:unique-tag reference}"
RESOURCE_GROUP="${3:-rg-cl-idp-prod-eus2}"
NAME_PREFIX="${4:-clidpprod}"
APP_NAME="${NAME_PREFIX}-api"
AZ_ARGS=(--subscription "${SUBSCRIPTION}" --resource-group "${RESOURCE_GROUP}" --only-show-errors)

az network private-endpoint list "${AZ_ARGS[@]}" \
  --query '[].{name:name,status:privateLinkServiceConnections[0].privateLinkServiceConnectionState.status}' \
  -o json | python3 -c '
import json, sys
endpoints = {item["name"]: item["status"] for item in json.load(sys.stdin)}
for service in ("vault", "mongo", "blob", "queue"):
    name = f"{sys.argv[1]}-api-{service}-pep"
    if endpoints.get(name) != "Approved":
        raise SystemExit(f"Private endpoint {name} is missing or not Approved")
print("All four dependency private endpoints are Approved")
' "${NAME_PREFIX}"

CURRENT_SUBNET="$(az webapp show "${AZ_ARGS[@]}" --name "${APP_NAME}" \
  --query virtualNetworkSubnetId -o tsv)"
SUBNET_ID="/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Network/virtualNetworks/${NAME_PREFIX}-api-vnet/subnets/snet-api-integration"
if [[ -n "${CURRENT_SUBNET}" && "${CURRENT_SUBNET,,}" != "${SUBNET_ID,,}" ]]; then
  echo "API already uses another subnet; refusing to replace its integration." >&2
  exit 1
fi

az webapp vnet-integration add "${AZ_ARGS[@]}" --name "${APP_NAME}" \
  --vnet "${NAME_PREFIX}-api-vnet" --subnet snet-api-integration -o none
az webapp config appsettings set "${AZ_ARGS[@]}" --name "${APP_NAME}" \
  --settings "AZURE_STORAGE_ACCOUNT_NAME=${NAME_PREFIX}st" -o none
az webapp config appsettings delete "${AZ_ARGS[@]}" --name "${APP_NAME}" \
  --setting-names AZURITE_BLOB_CONNECTION_STRING AZURITE_QUEUE_CONNECTION_STRING -o none
az webapp config set "${AZ_ARGS[@]}" --name "${APP_NAME}" \
  --always-on true --linux-fx-version "DOCKER|${IMAGE}" \
  --generic-configurations '{"vnetRouteAllEnabled":true,"healthCheckPath":"/healthz"}' -o none

APP_ID="$(az webapp show "${AZ_ARGS[@]}" --name "${APP_NAME}" --query id -o tsv)"
REFRESHED=false
for attempt in {1..12}; do
  # App Service can return 409 while the configuration update refreshes references.
  if az rest --method post \
    --url "https://management.azure.com${APP_ID}/config/configreferences/appsettings/refresh?api-version=2024-04-01" \
    --only-show-errors -o none; then
    REFRESHED=true
    break
  fi
  sleep 10
done
if [[ "${REFRESHED}" != true ]]; then
  echo "Key Vault reference refresh failed; inspect App Service configuration operations." >&2
  exit 1
fi

az rest --method get \
  --url "https://management.azure.com${APP_ID}/config/configreferences/appsettings?api-version=2024-04-01" \
  --query 'value[].{setting:name,status:properties.status}' -o table

HOST="$(az webapp show "${AZ_ARGS[@]}" --name "${APP_NAME}" --query defaultHostName -o tsv)"
for attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 20 "https://${HOST}/healthz"; then
    printf '\nAPI private-dependency health check passed.\n'
    exit 0
  fi
  sleep 10
done
echo "API did not become healthy; inspect Key Vault reference status and startup logs." >&2
exit 1
