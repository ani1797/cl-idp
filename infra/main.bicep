// Enterprise IDP — production-shaped Azure deployment.
//
// Topology (see docs/spec/TECHNOLOGY.md "Azure Production Architecture" and
// docs/architecture/canada-life-idp-azure-production-topology.excalidraw):
//   - web    -> Azure App Service (Linux, Node) — Next.js frontend
//   - api    -> Azure App Service (Linux, Python) — FastAPI trigger/query API
//   - worker -> Azure Function App (Linux, Python, queue-triggered) — pipeline worker
//   - db     -> Azure Cosmos DB for MongoDB (RU API) — same pymongo/mongodb://
//               code path as local dev (DB_BACKEND=mongo)
//   - Content Understanding / AI Foundry (account + project + model
//     deployment) is provisioned *inside this same resource group* —
//     the whole stack is self-sufficient and independently deployable,
//     with no cross-resource-group dependency on rg-cl-idp-dev.
//
// Deploy with:
//   az deployment sub create \
//     --location eastus2 \
//     --template-file infra/main.bicep \
//     --parameters infra/main.parameters.json
targetScope = 'subscription'

@description('Azure region for data/AI resources (Cosmos, Key Vault, Content Understanding, Log Analytics).')
param location string = 'eastus2'

@description('Azure region for App Service / Function App compute *and* the storage account (Functions require its content storage to be co-located). Separate from `location` because this subscription currently has zero App Service Plan / Function Consumption Plan quota in eastus2 (sponsorship/internal subscription default); canadaeast has quota. Both regions are still inside the single resource group below — this is a resource placement choice, not a second resource group.')
param computeLocation string = 'canadaeast'

@description('Short name prefix used to derive all resource names (letters/numbers only, keep short — storage/cosmos names have length limits).')
param namePrefix string = 'clidpprod'

@description('Name of the new resource group this stack is deployed into.')
param resourceGroupName string = 'rg-cl-idp-prod-eus2'

@description('Content Understanding completion model to deploy.')
param cuModelName string = 'gpt-4.1-mini'
param cuModelVersion string = '2025-04-14'

@description('App Service plan SKU for the web and api tiers.')
param appServicePlanSku string = 'B1'

@description('Container image tag deployed for the web App Service (built and pushed to the ACR module below by CI/deploy tooling).')
param webImageTag string = 'latest'

@description('Container image tag deployed for the api App Service (built and pushed to the ACR module below by CI/deploy tooling).')
param apiImageTag string = 'latest'

var tags = {
  application: 'enterprise-idp'
  environment: 'prod-demo'
  managedBy: 'bicep'
  // This tenant's MCAPSGov governance initiative runs Modify-effect policies
  // (StorageAccount_PublicNetwork_Modify, StorageAccount_DisableLocalAuth_Modify,
  // KeyVault_PublicNetwork_Modify, CosmosDB_PublicNetwork_Modify) that force
  // publicNetworkAccess=Disabled / allowSharedKeyAccess=false on every new
  // Storage, Key Vault, and Cosmos DB account, checked at either the resource
  // or (as here) the resource-group level. The Function App Consumption plan
  // cannot reach network-restricted storage, and App Service without VNet
  // integration cannot reach a private Key Vault/Cosmos endpoint, so this
  // demo genuinely needs public reachability. `SecurityControl: Ignore` is
  // the policy authors' own documented exemption tag for exactly this case —
  // not an ad hoc bypass. A production deployment with VNet integration and
  // private endpoints would omit this tag entirely.
  SecurityControl: 'Ignore'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module observability 'modules/log-analytics.bicep' = {
  name: 'observability'
  scope: rg
  params: {
    location: location
    tags: tags
    namePrefix: namePrefix
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'keyvault'
  scope: rg
  params: {
    location: location
    tags: tags
    namePrefix: namePrefix
    tenantId: subscription().tenantId
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    location: computeLocation
    tags: tags
    namePrefix: namePrefix
  }
}

module contentUnderstanding 'modules/content-understanding.bicep' = {
  name: 'content-understanding'
  scope: rg
  params: {
    location: location
    tags: tags
    namePrefix: namePrefix
    modelName: cuModelName
    modelVersion: cuModelVersion
  }
}

module containerRegistry 'modules/container-registry.bicep' = {
  name: 'container-registry'
  scope: rg
  params: {
    location: location
    tags: tags
    namePrefix: namePrefix
  }
}

module cosmosMongo 'modules/cosmos-mongo.bicep' = {
  name: 'cosmos-mongo'
  scope: rg
  params: {
    location: location
    tags: tags
    namePrefix: namePrefix
  }
}

// Persist the Mongo connection string as a Key Vault secret; app settings
// reference it via `@Microsoft.KeyVault(SecretUri=...)` rather than embedding
// it directly, so rotating it never requires an app redeploy.
module cosmosSecret 'modules/kv-secret.bicep' = {
  name: 'cosmos-secret'
  scope: rg
  params: {
    keyVaultName: keyVault.outputs.keyVaultName
    secretName: 'mongo-connection-string'
    secretValue: cosmosMongo.outputs.connectionString
  }
}

// Storage connection string (blob + queue) as a Key Vault secret too — the
// app/worker's blob and queue clients only support connection-string auth
// today (BlobServiceClient/QueueServiceClient.from_connection_string), the
// same code path used against Azurite in local dev, so production reuses it
// against the real storage account rather than requiring a DefaultAzureCredential
// rewrite. The Storage Blob/Queue Data Contributor RBAC grants below remain in
// place for the least-privilege data-plane path once that code path lands.
module storageSecret 'modules/kv-secret.bicep' = {
  name: 'storage-secret'
  scope: rg
  params: {
    keyVaultName: keyVault.outputs.keyVaultName
    secretName: 'storage-connection-string'
    secretValue: storage.outputs.connectionString
  }
}

var mongoSecretUri = '${keyVault.outputs.keyVaultUri}secrets/mongo-connection-string'
var storageSecretUri = '${keyVault.outputs.keyVaultUri}secrets/storage-connection-string'

module webApp 'modules/app-service.bicep' = {
  name: 'web-app'
  scope: rg
  params: {
    location: computeLocation
    tags: tags
    name: '${namePrefix}-web'
    skuName: appServicePlanSku
    linuxFxVersion: 'DOCKER|${containerRegistry.outputs.loginServer}/clidp-web:${webImageTag}'
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
    logAnalyticsWorkspaceId: observability.outputs.logAnalyticsWorkspaceId
    appSettings: [
      {
        name: 'API_BASE_URL'
        value: 'https://${namePrefix}-api.azurewebsites.net'
      }
    ]
  }
}

module apiApp 'modules/app-service.bicep' = {
  name: 'api-app'
  scope: rg
  params: {
    location: computeLocation
    tags: tags
    name: '${namePrefix}-api'
    skuName: appServicePlanSku
    linuxFxVersion: 'DOCKER|${containerRegistry.outputs.loginServer}/clidp-api:${apiImageTag}'
    containerRegistryLoginServer: containerRegistry.outputs.loginServer
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
    logAnalyticsWorkspaceId: observability.outputs.logAnalyticsWorkspaceId
    appSettings: [
      {
        name: 'DB_BACKEND'
        value: 'mongo'
      }
      {
        name: 'MONGO_CONNECTION_STRING'
        value: '@Microsoft.KeyVault(SecretUri=${mongoSecretUri})'
      }
      {
        name: 'AZURITE_BLOB_CONNECTION_STRING'
        value: '@Microsoft.KeyVault(SecretUri=${storageSecretUri})'
      }
      {
        name: 'AZURITE_QUEUE_CONNECTION_STRING'
        value: '@Microsoft.KeyVault(SecretUri=${storageSecretUri})'
      }
      {
        name: 'CU_ENDPOINT'
        value: contentUnderstanding.outputs.endpoint
      }
      {
        name: 'WEB_ORIGIN'
        value: 'https://${namePrefix}-web.azurewebsites.net'
      }
    ]
  }
}

module workerApp 'modules/function-app.bicep' = {
  name: 'worker-app'
  scope: rg
  params: {
    location: computeLocation
    tags: tags
    name: '${namePrefix}-worker'
    storageAccountConnectionString: storage.outputs.connectionString
    appInsightsConnectionString: observability.outputs.appInsightsConnectionString
    logAnalyticsWorkspaceId: observability.outputs.logAnalyticsWorkspaceId
    appSettings: [
      {
        name: 'DB_BACKEND'
        value: 'mongo'
      }
      {
        name: 'MONGO_CONNECTION_STRING'
        value: '@Microsoft.KeyVault(SecretUri=${mongoSecretUri})'
      }
      {
        name: 'AZURITE_BLOB_CONNECTION_STRING'
        value: '@Microsoft.KeyVault(SecretUri=${storageSecretUri})'
      }
      {
        name: 'AZURITE_QUEUE_CONNECTION_STRING'
        value: '@Microsoft.KeyVault(SecretUri=${storageSecretUri})'
      }
      {
        name: 'CU_ENDPOINT'
        value: contentUnderstanding.outputs.endpoint
      }
    ]
  }
}

// --- RBAC: local resource group (storage + Key Vault) -----------------------
module rbacLocal 'modules/rbac-local.bicep' = {
  name: 'rbac-local'
  scope: rg
  params: {
    storageAccountName: storage.outputs.storageAccountName
    keyVaultName: keyVault.outputs.keyVaultName
    dataPlanePrincipalIds: [
      apiApp.outputs.principalId
      workerApp.outputs.principalId
    ]
    secretsReaderPrincipalIds: [
      webApp.outputs.principalId
      apiApp.outputs.principalId
      workerApp.outputs.principalId
    ]
  }
}

// --- RBAC: shared Content Understanding account (now local to this RG) -----
module rbacCu 'modules/rbac-cognitive-services.bicep' = {
  name: 'rbac-cognitive-services'
  scope: rg
  params: {
    cognitiveServicesAccountName: contentUnderstanding.outputs.accountName
    callerPrincipalIds: [
      apiApp.outputs.principalId
      workerApp.outputs.principalId
    ]
  }
}

// --- RBAC: Container Registry (web + api pull images via managed identity) -
module rbacAcr 'modules/rbac-acr.bicep' = {
  name: 'rbac-acr'
  scope: rg
  params: {
    registryName: containerRegistry.outputs.registryName
    principalIds: [
      webApp.outputs.principalId
      apiApp.outputs.principalId
    ]
  }
}

output webAppUrl string = 'https://${webApp.outputs.defaultHostName}'
output apiAppUrl string = 'https://${apiApp.outputs.defaultHostName}'
output workerAppName string = workerApp.outputs.functionAppName
output keyVaultName string = keyVault.outputs.keyVaultName
output cosmosMongoAccountName string = cosmosMongo.outputs.accountName
output storageAccountName string = storage.outputs.storageAccountName
output contentUnderstandingEndpoint string = contentUnderstanding.outputs.endpoint
output containerRegistryLoginServer string = containerRegistry.outputs.loginServer
