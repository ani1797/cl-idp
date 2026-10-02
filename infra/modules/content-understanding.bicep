// Azure AI Foundry account (kind AIServices) + project + a completion model
// deployment, giving this resource group everything Azure AI Content
// Understanding needs on its own — no cross-resource-group dependency.
// Mirrors the shape validated by the earlier CU verification spike
// (docs/plan/01-cu-verification-spike.md): AIServices kind, GlobalStandard
// deployment SKU, Microsoft Entra ID auth only (disableLocalAuth: true) so
// callers must use managed identity + RBAC, not API keys.
param location string
param tags object
param namePrefix string
param modelName string = 'gpt-4.1-mini'
param modelVersion string = '2025-04-14'
param modelCapacity int = 30
param embeddingModelName string = 'text-embedding-3-small'
param embeddingModelVersion string = '1'
param embeddingModelCapacity int = 120

@description('Resource ID of the shared Application Insights component (from modules/log-analytics.bicep). Wired into this account/project as an AppInsights connection so Foundry Agent Service traces (the judge agent runs) land in the same Application Insights used by the rest of the stack, enabling zero-code agent tracing.')
param appInsightsId string
@description('Connection string of the shared Application Insights component, used as the connection credential below.')
param appInsightsConnectionString string

@description('Model deployed for the Foundry AI Agent Judge. Deliberately a separate model/deployment from `modelName` (Content Understanding) so the two workloads never compete for the same per-deployment RPM/TPM capacity — the root cause of intermittent judge run failures observed when both shared one deployment. Set equal to `modelName` to intentionally share a deployment instead; no judge-specific deployment resource is created in that case.')
param judgeModelName string = 'gpt-5-mini'
param judgeModelVersion string = '2025-08-07'
param judgeModelCapacity int = 50

resource foundry 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${namePrefix}-foundry'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: '${namePrefix}-foundry'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true
    allowProjectManagement: true
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: foundry
  name: '${namePrefix}-project'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: '${namePrefix}-project'
    description: 'Azure AI Foundry project for the Enterprise IDP production stack.'
  }
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: modelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
  }
}

// Content Understanding's custom (schema-based) analyzers require both a
// completion model *and* an embedding model to be registered as CU
// "defaults" (PATCH /contentunderstanding/defaults) before analyzers can be
// trained — the embedding model backs semantic/grounded field extraction.
resource embeddingModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: foundry
  name: embeddingModelName
  sku: {
    name: 'Standard'
    capacity: embeddingModelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
      version: embeddingModelVersion
    }
  }
  dependsOn: [
    modelDeployment
  ]
}

// Only provisioned when the judge is configured to use a model distinct
// from the Content Understanding completion model above (the default and
// recommended configuration — see the `judgeModelName` description).
resource judgeModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = if (judgeModelName != modelName) {
  parent: foundry
  name: judgeModelName
  sku: {
    name: 'GlobalStandard'
    capacity: judgeModelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: judgeModelName
      version: judgeModelVersion
    }
  }
  dependsOn: [
    embeddingModelDeployment
  ]
}

// Existing resource reference (not a new deployment): the shared App
// Insights component, used below as the `scope` for RBAC role assignments
// that let the project's managed identity push agent traces into it.
resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: last(split(appInsightsId, '/'))
}

// Account-level AppInsights connection, mirroring the official Foundry
// samples pattern (microsoft-foundry/foundry-samples,
// 01-connections/connection-application-insights.bicep). Lets every
// project under this account send OpenTelemetry traces to Application
// Insights.
resource accountAppInsightsConnection 'Microsoft.CognitiveServices/accounts/connections@2025-04-01-preview' = {
  parent: foundry
  name: '${namePrefix}-foundry-appinsights'
  properties: {
    category: 'AppInsights'
    target: appInsightsId
    authType: 'ApiKey'
    isSharedToAll: true
    credentials: {
      key: appInsightsConnectionString
    }
    metadata: {
      ApiType: 'Azure'
      ResourceId: appInsightsId
    }
  }
}

// Project-level AppInsights connection. This is what actually enables
// zero-code Foundry Agent Service tracing (prompts, tool calls, errors) for
// the judge agent — traces land in the same Application Insights instance
// used by the api/worker/web services, so everything correlates together.
resource projectAppInsightsConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2025-04-01-preview' = {
  parent: project
  name: '${namePrefix}-project-appinsights'
  properties: {
    category: 'AppInsights'
    target: appInsightsId
    authType: 'ApiKey'
    isSharedToAll: true
    credentials: {
      key: appInsightsConnectionString
    }
    metadata: {
      ApiType: 'Azure'
      ResourceId: appInsightsId
    }
  }
}

// Log Analytics Reader + Privileged Monitoring Data Reader (the latter is
// required to read GenAI trace content, per Microsoft's own Foundry
// samples) — grants the project's system-assigned identity the read access
// needed for the Foundry portal's "Tracing" view to surface agent runs.
var appInsightsReaderRoleGuids = [
  '73c42c96-874c-492b-b04d-ab87d138a893'
  'dbc9c667-e97f-4491-aee6-90b9cf960190'
]

resource projectAppInsightsRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleGuid in appInsightsReaderRoleGuids: {
  name: guid(project.id, roleGuid, appInsightsId)
  scope: appInsights
  properties: {
    principalId: project.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleGuid)
    principalType: 'ServicePrincipal'
  }
}]

output accountId string = foundry.id
output accountName string = foundry.name
output endpoint string = 'https://${foundry.name}.cognitiveservices.azure.com/'
// Azure AI Foundry Agent Service (used by the judge feature) addresses the
// project, not the raw Cognitive Services endpoint above.
output projectEndpoint string = 'https://${foundry.name}.services.ai.azure.com/api/projects/${project.name}'
output principalId string = foundry.identity.principalId
output modelDeploymentName string = modelDeployment.name
output embeddingModelDeploymentName string = embeddingModelDeployment.name
output judgeModelDeploymentName string = judgeModelName != modelName ? judgeModelDeployment.name : modelDeployment.name
