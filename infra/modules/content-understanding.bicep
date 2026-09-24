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

output accountId string = foundry.id
output accountName string = foundry.name
output endpoint string = 'https://${foundry.name}.cognitiveservices.azure.com/'
output principalId string = foundry.identity.principalId
output modelDeploymentName string = modelDeployment.name
output embeddingModelDeploymentName string = embeddingModelDeployment.name
