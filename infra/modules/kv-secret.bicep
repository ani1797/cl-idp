// Writes a single secret into an existing Key Vault. Used for the Cosmos
// Mongo API connection string (and can be reused for SMTP credentials later).
param keyVaultName string
param secretName string
@secure()
param secretValue string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource secret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: secretName
  properties: {
    value: secretValue
  }
}
