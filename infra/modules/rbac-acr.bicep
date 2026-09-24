// Grants AcrPull on the given Container Registry to each principal id — used
// so the web/api App Services can pull their container images using their
// system-assigned managed identity instead of registry admin credentials.
param registryName string
param principalIds array

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
  name: registryName
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in principalIds: {
    name: guid(registry.id, principalId, acrPullRoleId)
    scope: registry
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]
