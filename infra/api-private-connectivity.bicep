targetScope = 'resourceGroup'

param location string = 'canadaeast'
param namePrefix string = 'clidpprod'
param keyVaultName string = '${namePrefix}-kv'
param cosmosAccountName string = '${namePrefix}-cosmos-mongo'
param storageAccountName string = '${namePrefix}st'
param tags object = {
  application: 'enterprise-idp'
  environment: 'prod-demo'
  managedBy: 'bicep'
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosAccountName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource networkSecurityGroup 'Microsoft.Network/networkSecurityGroups@2026-05-01' = {
  name: '${namePrefix}-api-dependencies-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: []
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2026-05-01' = {
  name: '${namePrefix}-api-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: ['10.74.0.0/16']
    }
    subnets: [
      {
        name: 'snet-api-integration'
        properties: {
          addressPrefix: '10.74.0.0/26'
          networkSecurityGroup: {
            id: networkSecurityGroup.id
          }
          delegations: [
            {
              name: 'app-service'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
        }
      }
      {
        name: 'snet-private-endpoints'
        properties: {
          addressPrefix: '10.74.1.0/26'
          privateEndpointNetworkPolicies: 'Enabled'
          networkSecurityGroup: {
            id: networkSecurityGroup.id
          }
        }
      }
    ]
  }
}

var dependencies = [
  {
    name: 'vault'
    resourceId: vault.id
    groupId: 'vault'
    zone: 'privatelink.vaultcore.azure.net'
  }
  {
    name: 'mongo'
    resourceId: cosmos.id
    groupId: 'MongoDB'
    zone: 'privatelink.mongo.cosmos.azure.com'
  }
  {
    name: 'blob'
    resourceId: storage.id
    groupId: 'blob'
    zone: 'privatelink.blob.${environment().suffixes.storage}'
  }
  {
    name: 'queue'
    resourceId: storage.id
    groupId: 'queue'
    zone: 'privatelink.queue.${environment().suffixes.storage}'
  }
]

resource zones 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for dependency in dependencies: {
    name: dependency.zone
    location: 'global'
    tags: tags
  }
]

resource links 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (dependency, i) in dependencies: {
    parent: zones[i]
    name: '${namePrefix}-api'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: {
        id: vnet.id
      }
    }
  }
]

resource endpoints 'Microsoft.Network/privateEndpoints@2026-05-01' = [
  for dependency in dependencies: {
    name: '${namePrefix}-api-${dependency.name}-pep'
    location: location
    tags: tags
    properties: {
      subnet: {
        id: '${vnet.id}/subnets/snet-private-endpoints'
      }
      privateLinkServiceConnections: [
        {
          name: dependency.name
          properties: {
            privateLinkServiceId: dependency.resourceId
            groupIds: [dependency.groupId]
          }
        }
      ]
    }
  }
]

resource zoneGroups 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2026-05-01' = [
  for (dependency, i) in dependencies: {
    parent: endpoints[i]
    name: 'default'
    properties: {
      privateDnsZoneConfigs: [
        {
          name: dependency.name
          properties: {
            privateDnsZoneId: zones[i].id
          }
        }
      ]
    }
  }
]

output integrationSubnetId string = '${vnet.id}/subnets/snet-api-integration'
output virtualNetworkId string = vnet.id
