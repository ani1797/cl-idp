// Azure Communication Services Email — Azure-managed domain, used as the
// hosted-demo mail relay via ACS's SMTP-AUTH endpoint (smtp.azurecomm.net).
// NOTE: ACS (including ACS Email) is being retired (new signups blocked Oct
// 2026, full retirement Sept 2028) — this module is intentionally scoped to
// the demo only; a production deployment should target a real
// enterprise/M365 relay or private authenticated relay instead (see
// docs/spec/TECHNOLOGY.md "Email Notifications").
param location string = 'global'
param tags object
param namePrefix string
param dataLocation string = 'UnitedStates'

@description('Application (client) ID of the pre-created Entra app registration used for SMTP AUTH against this ACS resource. Created out-of-band via `az ad app create` (Bicep cannot create Entra app registrations).')
param smtpEntraApplicationId string

@description('Object (principal) ID of the service principal for the Entra app above, used for the RBAC role assignment.')
param smtpEntraServicePrincipalObjectId string

@description('SMTP username to register against the Entra application (free text or email-format; must match the sender domain if email format).')
param smtpUsernameValue string = 'clidp-idp-notifications'

var communicationAndEmailServiceOwnerRoleId = '09976791-48a7-449e-bb21-39d1a415f350'

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: '${namePrefix}-email'
  location: location
  tags: tags
  properties: {
    dataLocation: dataLocation
  }
}

// Azure-managed domain (<guid>.azurecomm.net) — no custom DNS/SPF/DKIM setup
// required, sufficient for demo-only sending volumes.
resource domain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: location
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
  }
}

// Registers the sender "local part" (the bit before @) allowed to send from
// this domain — required even for the Azure-managed domain.
resource senderUsername 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-04-01' = {
  parent: domain
  name: 'donotreply'
  properties: {
    username: 'DoNotReply'
    displayName: 'Enterprise IDP Notifications'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: '${namePrefix}-acs'
  location: location
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      domain.id
    ]
  }
}

// Grants the Entra app (via its service principal) permission to send email
// through this ACS resource over SMTP.
resource smtpRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(communicationService.id, smtpEntraServicePrincipalObjectId, communicationAndEmailServiceOwnerRoleId)
  scope: communicationService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', communicationAndEmailServiceOwnerRoleId)
    principalId: smtpEntraServicePrincipalObjectId
    principalType: 'ServicePrincipal'
  }
}

// Links the Entra app to an SMTP AUTH username on this resource — the SMTP
// password is one of the Entra app's client secrets (created out-of-band,
// stored in Key Vault, never referenced here).
resource smtpUsername 'Microsoft.Communication/communicationServices/smtpUsernames@2024-09-01-preview' = {
  parent: communicationService
  name: '${smtpUsernameValue}-smtp'
  properties: {
    entraApplicationId: smtpEntraApplicationId
    tenantId: tenant().tenantId
    username: smtpUsernameValue
  }
  dependsOn: [
    smtpRoleAssignment
  ]
}

output communicationServiceId string = communicationService.id
output communicationServiceName string = communicationService.name
output mailFromAddress string = '${senderUsername.properties.username}@${domain.properties.mailFromSenderDomain}'
output smtpUsername string = smtpUsername.properties.username
