// Grants the Azure Managed Grafana managed identity read access to query
// and visualize data from the shared Log Analytics workspace (which also
// backs Application Insights, since it's provisioned workspace-based —
// IngestionMode: LogAnalytics in modules/log-analytics.bicep). Two roles are
// required because they cover different planes:
//   - Monitoring Reader: resource-group scoped, lets Grafana's built-in
//     Azure Monitor data source discover/read Azure platform *metrics*
//     (App Service/Function App/Cosmos/etc.) across every resource here.
//   - Log Analytics Reader: scoped to the workspace itself, grants the
//     actual KQL query permission needed to read *logs/traces* (AppTraces,
//     AppRequests, AppDependencies, AppExceptions, customMetrics) — this is
//     distinct from (and not implied by) Monitoring Reader.
// No API keys/connection strings: Grafana authenticates as its own
// first-party managed identity.
param logAnalyticsWorkspaceName string

@description('Principal ID of the Azure Managed Grafana system-assigned managed identity.')
param grafanaPrincipalId string

var monitoringReaderRoleId = '43d0d8ad-25c7-4714-9337-8ba259a9fe05'
var logAnalyticsReaderRoleId = '73c42c96-874c-492b-b04d-ab87d138a893'

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource monitoringReaderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, grafanaPrincipalId, monitoringReaderRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringReaderRoleId)
    principalId: grafanaPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource logAnalyticsReaderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(logAnalyticsWorkspace.id, grafanaPrincipalId, logAnalyticsReaderRoleId)
  scope: logAnalyticsWorkspace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', logAnalyticsReaderRoleId)
    principalId: grafanaPrincipalId
    principalType: 'ServicePrincipal'
  }
}
