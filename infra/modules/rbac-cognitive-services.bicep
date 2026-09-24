// Grants the API and worker managed identities `Cognitive Services User` on
// the Azure AI Foundry / Content Understanding account provisioned by
// modules/content-understanding.bicep in this same resource group. Because
// the account has `disableLocalAuth: true`, this RBAC role assignment is the
// *only* way either identity can call Content Understanding — there is no
// API-key fallback.
param cognitiveServicesAccountName string

@description('Principal IDs (API + worker managed identities) that call Content Understanding.')
param callerPrincipalIds array

var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: cognitiveServicesAccountName
}

resource cuRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in callerPrincipalIds: {
    name: guid(account.id, principalId, cognitiveServicesUserRoleId)
    scope: account
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]
