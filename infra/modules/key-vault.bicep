// Key Vault (RBAC authorization mode — no access policies) holding secrets that
// compute identities read via Key Vault references: the Cosmos Mongo API
// connection string and SMTP credentials. Azure RBAC (not vault access
// policies) governs who/what can read secrets — see RBAC section of
// docs/spec/TECHNOLOGY.md.
param location string
param tags object
param namePrefix string
param tenantId string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${namePrefix}-kv'
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
  }
}

output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
