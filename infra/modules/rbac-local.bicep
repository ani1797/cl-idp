// Role assignments for the *local* resource group: grants each compute
// identity exactly the data-plane roles it needs on storage and Key Vault.
// See "RBAC Permissions" in docs/spec/TECHNOLOGY.md for the full narrative
// matrix this implements.
param storageAccountName string
param keyVaultName string

@description('Principal IDs (managed identities) that need blob + queue data access — API and worker.')
param dataPlanePrincipalIds array

@description('Principal IDs that only need to read secrets from Key Vault — web, API, worker.')
param secretsReaderPrincipalIds array

// Built-in role definition IDs (stable across all tenants/subscriptions).
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource blobRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in dataPlanePrincipalIds: {
    name: guid(storage.id, principalId, storageBlobDataContributorRoleId)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource queueRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in dataPlanePrincipalIds: {
    name: guid(storage.id, principalId, storageQueueDataContributorRoleId)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource secretsUserRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in secretsReaderPrincipalIds: {
    name: guid(keyVault.id, principalId, keyVaultSecretsUserRoleId)
    scope: keyVault
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

output monitoringMetricsPublisherRoleId string = monitoringMetricsPublisherRoleId
