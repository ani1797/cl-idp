// Function App (Python, Linux, Consumption) hosting the queue-triggered
// pipeline worker — the async job consumer that today runs as
// `apps/api/app/worker/main.py`. In Azure this becomes a queue-triggered
// function bound to the `jobs` queue on the shared storage account, so the
// trigger endpoint (App Service API) and the worker scale and fail
// independently, per the "worker in Function App" requirement.
param location string
param tags object
param name string
param appInsightsConnectionString string
param logAnalyticsWorkspaceId string
@secure()
param storageAccountConnectionString string
param appSettings array = []

@description('Optional subnet resource ID for regional VNet integration (outbound), needed when the worker must reach a private authenticated mail relay (or any other private endpoint). Leave empty (default) for no VNet integration. NOTE: the default Y1/Dynamic Consumption plan does not support regional VNet integration on Linux — set `planSkuName`/`planTier` to an Elastic Premium plan (e.g. EP1/ElasticPremium) whenever this is non-empty.')
param vnetIntegrationSubnetId string = ''

@description('Function App hosting plan SKU name. Default Y1 (Consumption) has no VNet integration support; use an Elastic Premium SKU (e.g. EP1) when `vnetIntegrationSubnetId` is set.')
param planSkuName string = 'Y1'

@description('Function App hosting plan tier, paired with `planSkuName` (Dynamic for Y1, ElasticPremium for EPn).')
param planTier string = 'Dynamic'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  sku: {
    name: planSkuName
    tier: planTier
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: empty(vnetIntegrationSubnetId) ? null : vnetIntegrationSubnetId
    siteConfig: {
      linuxFxVersion: 'Python|3.12'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: concat(appSettings, [
        {
          name: 'AzureWebJobsStorage'
          value: storageAccountConnectionString
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'python'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageAccountConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(name)
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
      ])
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: functionApp
  name: 'diag-${name}'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        category: 'FunctionAppLogs'
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

output principalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName
output functionAppName string = functionApp.name
