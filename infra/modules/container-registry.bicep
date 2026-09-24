// Azure Container Registry — hosts the container images for the web and api
// App Services. Deployed in this resource group (not shared/reused) per the
// "everything self-sufficient and enclosed in the resource group"
// requirement. Admin user is disabled; the web/api App Services pull images
// using their system-assigned managed identity (AcrPull role, granted in
// main.bicep) rather than registry credentials.
param location string
param tags object
param namePrefix string

resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: '${namePrefix}acr'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

output registryName string = registry.name
output loginServer string = registry.properties.loginServer
output registryId string = registry.id
