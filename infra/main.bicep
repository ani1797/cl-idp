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

@description('SMTP relay host for review-needed notification emails. Points at an unauthenticated relay by default; set to an authenticated (or private) relay hostname together with the mail auth/TLS params below.')
param smtpHost string = '127.0.0.1'

@description('SMTP relay port.')
param smtpPort int = 1025

@description('Mail relay auth mode: "none" (unauthenticated, default) or "basic" (SMTP AUTH using smtpUsername/smtpPassword below).')
@allowed(['none', 'basic'])
param mailAuthMode string = 'none'

@description('Mail relay TLS mode: "none" (default), "starttls", or "smtps".')
@allowed(['none', 'starttls', 'smtps'])
param mailTlsMode string = 'none'

@description('SMTP AUTH username, only used when mailAuthMode=basic.')
param smtpUsername string = ''

@secure()
@description('SMTP AUTH password/secret, only used when mailAuthMode=basic. Stored as a Key Vault secret and referenced from app settings — never written directly into resource properties.')
param smtpPassword string = ''

@description('From address used on outbound notification emails. Authenticated/private relays typically require a verified/allowed sender.')
param mailFromAddress string = 'enterprise-idp@localhost'

@description('Optional subnet resource ID for regional VNet integration on the api App Service and worker Function App, required when mailAuthMode=basic and smtpHost is only reachable over a private network path (private authenticated relay). Leave empty (default) for no VNet integration. NOTE: enabling this for the worker also requires bumping `workerPlanSkuName`/`workerPlanTier` to an Elastic Premium SKU, since the default Consumption plan does not support regional VNet integration.')
param mailRelaySubnetId string = ''

@description('Provisions Azure Communication Services Email (Azure-managed domain) and wires it up as the demo mail relay via SMTP AUTH. DEMO ONLY: ACS (including ACS Email) is being retired (new signups blocked Oct 2026, full retirement Sept 2028) — do not enable this for a production deployment; use a real enterprise/M365 relay or a private authenticated relay instead. When true, this overrides smtpHost/smtpPort/mailAuthMode/mailTlsMode/smtpUsername/mailFromAddress with the ACS SMTP endpoint automatically.')
param enableAcsEmailDemo bool = false

@description('Application (client) ID of the pre-created Entra app registration used for ACS SMTP AUTH. Required when enableAcsEmailDemo=true; created out-of-band via `az ad app create` (Bicep cannot create Entra app registrations).')
param smtpEntraApplicationId string = ''

@description('Object (principal) ID of the service principal for the Entra app above. Required when enableAcsEmailDemo=true.')
param smtpEntraServicePrincipalObjectId string = ''

@description('Worker Function App hosting plan SKU name. Override to an Elastic Premium SKU (e.g. EP1) when `mailRelaySubnetId` is set.')
param workerPlanSkuName string = 'Y1'

@description('Worker Function App hosting plan tier, paired with `workerPlanSkuName`.')
param workerPlanTier string = 'Dynamic'

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

// DEMO ONLY — see enableAcsEmailDemo description above.
module communicationEmail 'modules/communication-email.bicep' = if (enableAcsEmailDemo) {
  name: 'communication-email'
  scope: rg
  params: {
    tags: tags
    namePrefix: namePrefix
    smtpEntraApplicationId: smtpEntraApplicationId
    smtpEntraServicePrincipalObjectId: smtpEntraServicePrincipalObjectId
  }
}

// When the ACS Email demo is enabled, its SMTP endpoint/credentials override
// the generic mail params above; otherwise the generic params pass through
// unchanged (unauthenticated relay, or whatever authenticated/private relay
// values were supplied).
var effectiveSmtpHost = enableAcsEmailDemo ? 'smtp.azurecomm.net' : smtpHost
var effectiveSmtpPort = enableAcsEmailDemo ? 587 : smtpPort
var effectiveMailAuthMode = enableAcsEmailDemo ? 'basic' : mailAuthMode
var effectiveMailTlsMode = enableAcsEmailDemo ? 'starttls' : mailTlsMode
var effectiveSmtpUsername = enableAcsEmailDemo ? communicationEmail.outputs.smtpUsername : smtpUsername
var effectiveMailFromAddress = enableAcsEmailDemo ? communicationEmail.outputs.mailFromAddress : mailFromAddress

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

// Only written when an authenticated (or private) relay is configured; the
// default unauthenticated relay has no secret to store.
module smtpSecret 'modules/kv-secret.bicep' = if (!empty(smtpPassword)) {
  name: 'smtp-secret'
  scope: rg
  params: {
    keyVaultName: keyVault.outputs.keyVaultName
    secretName: 'smtp-password'
    secretValue: smtpPassword
  }
}

var smtpSecretUri = '${keyVault.outputs.keyVaultUri}secrets/smtp-password'

// Mail relay app settings shared by the api (which composes and, in this
// codebase, ultimately delegates to the worker's send path) and the worker
// (which actually sends the notification email). Same settings regardless
// of mode — unauthenticated relay, authenticated SMTP relay, or a private
// authenticated relay reachable only via `mailRelaySubnetId` VNet
// integration; only mailAuthMode/mailTlsMode/smtpHost and the presence of
// credentials change between them.
var mailAppSettings = concat([
  {
    name: 'SMTP_HOST'
    value: effectiveSmtpHost
  }
  {
    name: 'SMTP_PORT'
    value: string(effectiveSmtpPort)
  }
  {
    name: 'MAIL_AUTH_MODE'
    value: effectiveMailAuthMode
  }
  {
    name: 'MAIL_TLS_MODE'
    value: effectiveMailTlsMode
  }
  {
    name: 'MAIL_FROM_ADDRESS'
    value: effectiveMailFromAddress
  }
], empty(effectiveSmtpUsername) ? [] : [
  {
    name: 'SMTP_USERNAME'
    value: effectiveSmtpUsername
  }
], empty(smtpPassword) ? [] : [
  {
    name: 'SMTP_PASSWORD'
    value: '@Microsoft.KeyVault(SecretUri=${smtpSecretUri})'
  }
])

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
    vnetIntegrationSubnetId: mailRelaySubnetId
    appSettings: concat([
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
    ], mailAppSettings)
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
    vnetIntegrationSubnetId: mailRelaySubnetId
    planSkuName: workerPlanSkuName
    planTier: workerPlanTier
    appSettings: concat([
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
    ], mailAppSettings)
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
