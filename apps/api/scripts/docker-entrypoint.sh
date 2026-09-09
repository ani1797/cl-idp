#!/bin/sh
set -eu

host_azure_dir="${CL_IDP_AZURE_HOST_CONFIG_DIR:-/azure-host/.azure}"
azure_config_dir="${AZURE_CONFIG_DIR:-${HOME:-/root}/.azure}"

if [ -d "$host_azure_dir" ]; then
  mkdir -p "$azure_config_dir"
  cp -a "$host_azure_dir"/. "$azure_config_dir"/
fi

exec "$@"
