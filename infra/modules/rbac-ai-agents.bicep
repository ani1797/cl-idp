// Grants the worker managed identity the `Foundry User` role (previously
// named `Azure AI User`) on the Azure AI Foundry account provisioned by
// modules/content-understanding.bicep. This is a *separate* role from
// `Cognitive Services User` (see modules/rbac-cognitive-services.bicep):
// Content Understanding's analyzer APIs accept Cognitive Services User, but
// the Azure AI Foundry Agent Service used by the judge feature
// (AgentsClient — list/create agents, threads, runs) requires Foundry User.
// See https://learn.microsoft.com/azure/ai-foundry/concepts/rbac-azure-ai-foundry
param cognitiveServicesAccountName string

@description('Principal IDs (worker managed identity) that call the Foundry Agent Service for the judge feature.')
param callerPrincipalIds array

var foundryUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: cognitiveServicesAccountName
}

resource agentRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in callerPrincipalIds: {
    name: guid(account.id, principalId, foundryUserRoleId)
    scope: account
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', foundryUserRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]
