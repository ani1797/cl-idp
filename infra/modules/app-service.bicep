// Generic Linux App Service (plan + web app) with a system-assigned managed
// identity. Used twice — once for the Next.js web tier, once for the FastAPI
// API tier — each with its own plan so the two scale independently.
param location string
param tags object
param name string
param skuName string = 'B1'
param linuxFxVersion string
param appSettings array = []
param appInsightsConnectionString string
param logAnalyticsWorkspaceId string

@description('Container registry login server to pull from (e.g. myacr.azurecr.io). Leave empty for code-based (Oryx) deployment.')
param containerRegistryLoginServer string = ''

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      alwaysOn: skuName != 'F1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      acrUseManagedIdentityCreds: !empty(containerRegistryLoginServer)
      appSettings: concat(appSettings, [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'WEBSITE_HTTPLOGGING_RETENTION_DAYS'
          value: '7'
        }
      ], empty(containerRegistryLoginServer) ? [] : [
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${containerRegistryLoginServer}'
        }
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
      ])
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: site
  name: 'diag-${name}'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        category: 'AppServiceHTTPLogs'
        enabled: true
      }
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output principalId string = site.identity.principalId
output defaultHostName string = site.properties.defaultHostName
output siteName string = site.name
output siteId string = site.id
