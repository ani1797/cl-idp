// Azure Managed Grafana — native dashboarding over the shared Log
// Analytics/Application Insights workspace provisioned by
// modules/log-analytics.bicep. Uses a system-assigned managed identity with
// the built-in Azure Monitor data source (no API keys/connection strings to
// manage); RBAC granting that identity read access to the workspace is
// wired separately in modules/rbac-grafana.bicep so this module stays
// focused on the Grafana resource itself.
param location string
param tags object

@description('Name of the Azure Managed Grafana workspace.')
param name string

@description('Grafana SKU: "Essential" (cheaper, dev/preview — no SLA, no private networking) or "Standard" (prod-ready: HA, private link, Azure Monitor alerting integration).')
@allowed(['Essential', 'Standard'])
param skuName string = 'Standard'

resource grafana 'Microsoft.Dashboard/grafana@2023-09-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    apiKey: 'Disabled'
    publicNetworkAccess: 'Enabled'
    deterministicOutboundIP: 'Disabled'
    zoneRedundancy: 'Disabled'
  }
}

output principalId string = grafana.identity.principalId
output grafanaName string = grafana.name
output grafanaEndpoint string = grafana.properties.endpoint
