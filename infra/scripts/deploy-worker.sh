#!/usr/bin/env bash
# Packages and deploys the Azure Functions worker (apps/worker) to the
# clidpprod-worker Function App.
#
# The worker Function App reuses the API's job-processing logic
# (apps/api/app/worker/main.py) rather than duplicating it, so this script
# stages a temporary deploy directory containing:
#   - apps/worker/function_app.py + host.json  (the Functions-specific glue)
#   - apps/worker/requirements.txt              (azure-functions + API deps)
#   - apps/api/app/                             (the actual job-handling code)
# then zip-deploys that staging directory via `az functionapp deployment
# source config-zip`. Oryx (Azure's build service) installs
# requirements.txt server-side during the deploy.
#
# Usage: infra/scripts/deploy-worker.sh [resource-group] [function-app-name]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOURCE_GROUP="${1:-rg-cl-idp-prod-eus2}"
FUNCTION_APP_NAME="${2:-clidpprod-worker}"

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGING_DIR}"' EXIT

echo "Staging worker deploy package in ${STAGING_DIR}..."
cp "${REPO_ROOT}/apps/worker/function_app.py" "${STAGING_DIR}/"
cp "${REPO_ROOT}/apps/worker/host.json" "${STAGING_DIR}/"
cp "${REPO_ROOT}/apps/worker/requirements.txt" "${STAGING_DIR}/"
cp -R "${REPO_ROOT}/apps/api/app" "${STAGING_DIR}/app"
# Drop bytecode caches / local artifacts that shouldn't ship.
find "${STAGING_DIR}/app" -name "__pycache__" -type d -prune -exec rm -rf {} +

ZIP_PATH="${STAGING_DIR}.zip"
python3 - "${STAGING_DIR}" "${ZIP_PATH}" <<'PYEOF'
import os
import sys
import zipfile

src_dir, zip_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _dirs, files in os.walk(src_dir):
        for name in files:
            full_path = os.path.join(root, name)
            arcname = os.path.relpath(full_path, src_dir)
            zf.write(full_path, arcname)
PYEOF

echo "Deploying to Function App '${FUNCTION_APP_NAME}' in resource group '${RESOURCE_GROUP}'..."
az functionapp deployment source config-zip \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${FUNCTION_APP_NAME}" \
  --src "${ZIP_PATH}" \
  --build-remote true

rm -f "${ZIP_PATH}"
echo "Worker deployment complete."
