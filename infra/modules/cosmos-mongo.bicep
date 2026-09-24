// Azure Cosmos DB for MongoDB (RU-based API) — the production database.
// Chosen over MongoDB Atlas because it is deployable natively via Bicep/ARM
// and is wire-compatible with the same pymongo/`mongodb://` code path
// (`DB_BACKEND=mongo`) the backend already uses against the local `mongo:7`
// container, so no application code branches on "which Mongo".
//
// The Mongo API does not support Microsoft Entra ID data-plane auth (unlike
// the Cosmos NoSQL API) — access is via the connection string/primary key,
// which is written to Key Vault as a secret by this module's caller. Compute
// identities never see the raw connection string directly; they get
// `Key Vault Secrets User` on the vault and resolve it through an App
// Service/Function App Key Vault reference.
param location string
param tags object
param namePrefix string
param databaseName string = 'clidp'

resource cosmosMongo 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: '${namePrefix}-cosmos-mongo'
  location: location
  tags: tags
  kind: 'MongoDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    apiProperties: {
      serverVersion: '7.0'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableMongo' }
      { name: 'EnableServerless' }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    minimalTlsVersion: 'Tls12'
  }
}

resource mongoDatabase 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases@2024-05-15' = {
  parent: cosmosMongo
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource processesCollection 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases/collections@2024-05-15' = {
  parent: mongoDatabase
  name: 'processes'
  properties: {
    resource: {
      id: 'processes'
      shardKey: {
        _id: 'Hash'
      }
    }
  }
}

resource jobsCollection 'Microsoft.DocumentDB/databaseAccounts/mongodbDatabases/collections@2024-05-15' = {
  parent: mongoDatabase
  name: 'jobs'
  properties: {
    resource: {
      id: 'jobs'
      shardKey: {
        _id: 'Hash'
      }
    }
  }
}

output accountId string = cosmosMongo.id
output accountName string = cosmosMongo.name
#disable-next-line outputs-should-not-contain-secrets
output connectionString string = cosmosMongo.listConnectionStrings().connectionStrings[0].connectionString
