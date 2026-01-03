---
title: "AuthPilot Deployment: When Flex Consumption Gets Flexed On"
date: 2025-12-28
slug: authpilot-fax-processing-deployment
tags: [artificial-intelligence, infrastructure-as-code, devops, azure, azure-functions, document-intelligence, cicd, github-actions, microsoft foundry]
---

# AuthPilot Deployment: When Flex Consumption Gets Flexed On

I thought deploying AuthPilot would be the easy part. I had the infrastructure. I had the code. I had confidence. What I *didn't* have was the knowledge that **Flex Consumption has opinions about blob triggers**, and those opinions would send me on a journey through Event Grid webhooks, RBAC permissions, and container naming conventions. Here's what I learned.

## What is AuthPilot?

AuthPilot automates prior authorization processing for healthcare providers. Medical practices receive hundreds of faxed prior authorization forms that need manual data entry—a time-consuming, error-prone process. AuthPilot uses Azure AI Document Intelligence with a custom extraction model to automatically extract patient information, procedure codes, and authorization details from faxed PDFs, storing structured data in Cosmos DB for downstream processing.

**Why fax in 2026?** Fax remains widely used in healthcare for document transmission due to existing regulatory frameworks and established workflows. AuthPilot works with this reality by processing faxed documents automatically.

**Want to deploy this yourself?**
- 📦 **Infrastructure Code**: [github.com/GitBuntu/cerebricep](https://github.com/GitBuntu/cerebricep) - Complete Bicep templates
- 🚀 **Application Code**: [github.com/GitBuntu/authpilot](https://github.com/GitBuntu/authpilot) - .NET Function App

Clone both repositories and follow along—you'll have a working document processing pipeline deployed to Azure by the end of this article.

---

## Quick Start: TL;DR Deployment Checklist

**Want to deploy fast without reading the full war stories?** Here's your express lane:

### Prerequisites
1. Azure subscription with Contributor access
2. Azure CLI installed and authenticated
3. .NET 9.0 SDK installed
4. Azure Functions Core Tools v4

### Deployment Steps (30 minutes)

```bash
# 1. Deploy infrastructure
git clone https://github.com/GitBuntu/cerebricep
cd cerebricep
az deployment sub create --location westeurope --template-file main.bicep

# 2. Configure Event Grid (CRITICAL for Flex Consumption)
az provider register --namespace Microsoft.EventGrid

# 3. Deploy function app
git clone https://github.com/GitBuntu/authpilot
cd authpilot
func azure functionapp publish <your-function-app-name>

# 4. Set up Key Vault access
az functionapp identity assign --name <app-name> --resource-group <rg-name>
az role assignment create --assignee <principal-id> \
  --role "Key Vault Secrets User" --scope <keyvault-id>

# 5. Create Event Grid subscription (use webhook URL)
BLOB_KEY=$(az functionapp keys list --name <app-name> --resource-group <rg-name> \
  --query "systemKeys.blobs_extension" -o tsv)
az eventgrid event-subscription create --name faxes-subscription \
  --source-resource-id <storage-account-id> \
  --endpoint "https://<app-name>.azurewebsites.net/runtime/webhooks/blobs?functionName=Host.Functions.ProcessFax&code=${BLOB_KEY}" \
  --included-event-types Microsoft.Storage.BlobCreated
```

### Critical Gotchas to Avoid
- ✅ Use **dedicated container** for deployment storage (not your blob trigger container)
- ✅ **Plain connection string** for blob trigger (Key Vault references don't work here)
- ✅ Set `Source = BlobTriggerSource.EventGrid` in your BlobTrigger attribute
- ✅ Grant Key Vault access to **system-assigned identity** (not just user-assigned)
- ✅ Set **always-ready instances = 0** for true pay-per-execution (otherwise €60+/month baseline)
- ⚠️ **App Configuration costs €60/month**—consider alternatives for MVP

**Test it**: Upload a PDF to the `faxes` container and watch it process in Application Insights.

*Want to understand WHY these steps matter? Keep reading—the chapters below explain every pitfall I hit and how to avoid them.*

---

## The Setup: What Was Deployed

AuthPilot is an Azure Function app that processes faxed prior authorization forms using AI. The architecture is straightforward:

- **Azure Functions** (.NET 9.0 isolated worker, Flex Consumption plan)
- **Cosmos DB for MongoDB** storing processed authorization documents
- **Azure AI Document Intelligence** with a custom extraction model (`authpilot-cem-v1`) trained in [Document Intelligence Studio](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/studio-overview?view=doc-intel-4.0.0&tabs=di-studio)
- **Azure Storage** with a `faxes` container for incoming PDFs
- **Azure Key Vault** for secrets management
- **Managed Identities** (both system-assigned and user-assigned) for passwordless authentication

The function itself is simple: when a PDF lands in the `faxes` blob container, extract the authorization data, organize the blob into subfolders, and store the results in Cosmos DB with idempotency checks.

Straightforward, right? *Right?*

![Deployed Azure Resources](src/posts/rg.png)
*The complete resource group showing all deployed services for AuthPilot*

---

## Chapter 1: The Innocent Question

> "Do I need to edit any settings in the `local.settings.json` file for deployment?"

The answer: **No.** `local.settings.json` is local-only. It stays on your machine, lives in `.gitignore`, and does not deploy. All the *real* configuration goes into Azure Function App Settings.

But this innocent question kicked off a cascade of discoveries about what *actually* matters in deployment configuration.

### The Lesson

Understand the difference between local development settings and deployed application settings. The former is for testing. The latter is for production. Don't conflate them.

---

## Chapter 2: Key Vault References and the Red X of Shame

After deploying, I checked my Function App's application settings in the Azure Portal. Instead of happy green checkmarks, I saw **red X icons** next to my Key Vault references:

```
@Microsoft.KeyVault(SecretUri=https://<your-keyvault>.vault.azure.net/secrets/BlobStorageConnection) ❌
@Microsoft.KeyVault(SecretUri=https://<your-keyvault>.vault.azure.net/secrets/DocumentIntelligenceKey) ❌
@Microsoft.KeyVault(SecretUri=https://<your-keyvault>.vault.azure.net/secrets/MongoDBConnectionString) ❌
```

### The Problem

My Function App couldn't access Key Vault. Why? Because while I'd configured a **user-assigned managed identity** during IaC deployment, the Function App's **system-assigned managed identity** also needed access.

### The Solution

**Prerequisites**: Ensure your Key Vault uses **Azure role-based access control (RBAC)** for authorization, not legacy Access Policies. You can verify this in the Azure Portal under Key Vault → Access configuration. RBAC is the modern recommended approach and required for the `Key Vault Secrets User` role to work.

1. **Enable system-assigned managed identity** on the Function App (if not already enabled):

```bash
az functionapp identity assign --name <function-app-name> --resource-group <resource-group>
```

This command returns the principal ID you'll need for the next step.

2. Grant the `Key Vault Secrets User` role to the system-assigned identity's principal ID
3. Wait for RBAC to propagate (typically under 60 seconds, but can vary)

```bash
az role assignment create \
  --assignee <system-assigned-identity-principal-id> \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.KeyVault/vaults/<your-keyvault>
```

Red X icons turned green. Victory.

### The Lesson

**Two types of managed identities exist**: user-assigned (defined in your IaC) and system-assigned (tied to the Function App lifecycle). Both can coexist.

**Key Vault reference identity behavior**:
- If only system-assigned identity exists → uses system-assigned
- If only user-assigned identity exists → uses user-assigned  
- If **both** exist → system-assigned takes precedence by default

You can explicitly control which identity is used for Key Vault references by setting the `keyVaultReferenceIdentity` property in your Function App configuration to either `SystemAssigned` or the resource ID of a specific user-assigned identity.

**Best practice**: Grant Key Vault access to whichever identity will be used for Key Vault references. In most cases with Flex Consumption, the system-assigned identity is the simplest approach.

**Important**: This approach requires your Key Vault to use Azure RBAC for authorization. If your Key Vault still uses Access Policies, you'll need to either migrate to RBAC or grant access via Access Policies instead of role assignments.

---

## Chapter 3: The Deployment Storage Mystery

Next error: deployment failed with a cryptic message:

> "The specified resource name contains invalid characters."

### Understanding Deployment Storage in Flex Consumption

Before diving into the problem, let's understand what **deployment storage** is and why Flex Consumption needs it.

Unlike traditional Consumption plans that store deployment packages in a hidden internal location, **Flex Consumption requires you to provide a dedicated storage account** for storing the compiled function app code (the deployment package). This is configured via the `DEPLOYMENT_STORAGE_CONNECTION_STRING` application setting.

**Key distinctions:**
- `AzureWebJobsStorage` (or `BlobStorageConnection` in my case) → Used by your function app at runtime for internal operations, state management, and blob triggers
- `DEPLOYMENT_STORAGE_CONNECTION_STRING` → Used exclusively to store and retrieve your deployment packages

You can use the same storage account for both, but they serve different purposes. The deployment package gets uploaded to a container in the deployment storage account during the `func azure functionapp publish` command.

### The Problem

During deployment, I encountered the "invalid characters" error. After digging into my Bicep template, I found the issue: I had configured deployment packages to be stored in the same container as my blob trigger (`faxes`).

**The root cause**: Using the same container for deployment packages AND application blobs created a conflict. The `faxes` container already had blob trigger configurations and Event Grid subscriptions—incompatible with deployment package storage.

### The Solution

Create a dedicated `deployments` container:

```bicep
resource deploymentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'deployments'
  properties: { publicAccess: 'None' }
}

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  properties: {
    siteConfig: {
      appSettings: [
        { name: 'DEPLOYMENT_STORAGE_CONNECTION_STRING', value: '...' }
        { name: 'DEPLOYMENT_STORAGE_CONTAINER_NAME', value: 'deployments' }  // ✅ Dedicated
      ]
    }
  }
}
```

**Note**: If you omit `DEPLOYMENT_STORAGE_CONTAINER_NAME`, Azure auto-generates a name like `scm-releases-{sitename}`.

### Verification

After deployment, check the container:

```bash
az storage blob list --account-name <storage> --container-name deployments --auth-mode login
```

You should see `released-package.zip`.

### Best Practices

1. **Dedicated container** for deployments—don't share with application data
2. **Lifecycle management** to auto-delete old packages (see full Bicep in [cerebricep repo](https://github.com/GitBuntu/cerebricep)):
   - Delete blobs in `deployments/` after 30 days
   - Saves storage costs without manual cleanup
3. **Grant RBAC access** if using managed identity for passwordless deployment

<details>
<summary>📄 Complete Bicep example with lifecycle policy and RBAC (click to expand)</summary>

```bicep
resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'DeleteOldDeployments'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['deployments/']
            }
            actions: {
              baseBlob: { delete: { daysAfterModificationGreaterThan: 30 } }
            }
          }
        }
      ]
    }
  }
}

var storageBlobDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource deploymentStorageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, functionApp.id, storageBlobDataContributorRole)
  properties: {
    roleDefinitionId: storageBlobDataContributorRole
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```

</details>

### The Lesson

**Separate deployment infrastructure from application infrastructure.** While it's tempting to reuse containers or storage accounts to save costs, it creates logical confusion and potential conflicts. Use conventional, well-established names for deployment infrastructure: `deployments`, `packages`, `artifacts`.

The few cents saved by sharing containers aren't worth the hours spent debugging deployment failures.

---

## Chapter 4: The Blob Trigger That Wouldn't

Deployment succeeded. Application settings looked good. Managed identities had permissions. I uploaded a test PDF to the `faxes` container.

Nothing.

I checked the logs. Silence. I checked Application Insights. Nothing. The function simply wasn't triggering.

### The Problem

**Flex Consumption does not support polling-based blob triggers.** 

Traditional Azure Functions use a mechanism called `LogsAndContainerScan` to poll blob storage for changes. It checks the logs and scans containers periodically. Flex Consumption **does not do this**. Instead, it requires **Event Grid** to push blob creation events to the function.

My function was sitting there, waiting for events that would never arrive because I hadn't configured Event Grid.

### The Solution: Event Grid to the Rescue

I needed to:

1. **Update the function code** to specify Event Grid as the trigger source
2. **Register the Event Grid resource provider** in my subscription
3. **Create an Event Grid subscription** pointing to the function's blob extension webhook endpoint

#### Step 1: Update the Function Code

```csharp
public async Task Run(
    [BlobTrigger("faxes/{name}", Source = BlobTriggerSource.EventGrid, Connection = "BlobStorageConnection")] Stream blobStream,
    string name,
    Uri uri,
    FunctionContext context)
{
    // Function implementation
}
```

The magic: `Source = BlobTriggerSource.EventGrid`. This tells the function runtime to expect Event Grid events instead of polling.

#### Step 2: Register Event Grid Provider

```bash
az provider register --namespace Microsoft.EventGrid
```

This took a few minutes to propagate. You can check status with:

```bash
az provider show -n Microsoft.EventGrid --query "registrationState" -o tsv
```

Wait until it returns `Registered`.

**Better Approach: Include in Bicep**

In hindsight, this should have been part of my IaC deployment. **Important note**: When you deploy Event Grid resources in Bicep, Azure automatically registers the `Microsoft.EventGrid` provider if it isn't already registered. You don't need explicit provider registration code—just deploy the Event Grid subscription resource and Azure handles provider registration automatically.

This makes your infrastructure truly repeatable—no manual steps required.

#### Step 3: Create the Event Grid Subscription

This was the tricky part. The Azure Portal's Event Grid subscription wizard has a dropdown to select an Azure Function. That dropdown was empty. Why? Because of how Flex Consumption registers its endpoints. The portal couldn't discover them.

**Solution: Use the webhook endpoint manually.**

The webhook URL format is:

```
https://<function-app-name>.azurewebsites.net/runtime/webhooks/blobs?functionName=Host.Functions.<function-name>&code=<blob_extension_key>
```

For my function `ProcessFax`, it became:

```
https://<your-function-app>.azurewebsites.net/runtime/webhooks/blobs?functionName=Host.Functions.ProcessFax&code=<blob_extension_key>
```

The `<blob_extension_key>` is the **blob extension system key** from the Function App's "App keys" section in the portal. Look for keys under "System keys" → "blobs_extension".

##### Creating the Event Grid Subscription via Azure CLI

```bash
# First, retrieve the blob extension key
BLOB_EXTENSION_KEY=$(az functionapp keys list \
  --name <function-app-name> \
  --resource-group <resource-group> \
  --query "systemKeys.blobs_extension" -o tsv)

# Construct the webhook URL
WEBHOOK_URL="https://<function-app-name>.azurewebsites.net/runtime/webhooks/blobs?functionName=Host.Functions.ProcessFax&code=${BLOB_EXTENSION_KEY}"

# Create the Event Grid subscription
az eventgrid event-subscription create \
  --name faxes-blob-subscription \
  --source-resource-id "/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Storage/storageAccounts/<storage-account-name>" \
  --endpoint "${WEBHOOK_URL}" \
  --endpoint-type webhook \
  --included-event-types Microsoft.Storage.BlobCreated \
  --subject-begins-with "/blobServices/default/containers/faxes/"
```

##### Creating the Event Grid Subscription in Bicep

For a fully automated IaC approach, define the Event Grid subscription in Bicep:

```bicep
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: storageAccountName
}

resource functionApp 'Microsoft.Web/sites@2023-01-01' existing = {
  name: functionAppName
}

// Retrieve the blob extension key using listKeys
var blobExtensionKey = listKeys('${functionApp.id}/host/default', '2023-01-01').systemKeys.blobs_extension

resource eventGridSubscription 'Microsoft.EventGrid/eventSubscriptions@2023-12-15-preview' = {
  name: 'faxes-blob-subscription'
  scope: storageAccount
  properties: {
    destination: {
      endpointType: 'WebHook'
      properties: {
        endpointUrl: 'https://${functionApp.properties.defaultHostName}/runtime/webhooks/blobs?functionName=Host.Functions.ProcessFax&code=${blobExtensionKey}'
        maxEventsPerBatch: 1
        preferredBatchSizeInKilobytes: 64
      }
    }
    filter: {
      includedEventTypes: [
        'Microsoft.Storage.BlobCreated'
      ]
      subjectBeginsWith: '/blobServices/default/containers/faxes/'
      subjectEndsWith: '.pdf'
    }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: {
      maxDeliveryAttempts: 30
      eventTimeToLiveInMinutes: 1440
    }
  }
}
```

**Key configuration details:**
- **Endpoint Type**: WebHook
- **Endpoint URL**: The webhook URL with blob extension key
- **Event Schema**: EventGridSchema
- **Filter to Event Types**: `Microsoft.Storage.BlobCreated`
- **Subject Filters**: Begins with `/blobServices/default/containers/faxes/`, ends with `.pdf`

The subject filters ensure only PDF files from the `faxes` container trigger the function.

### The Result

Uploaded a PDF. Within seconds:

```
ProcessFax triggered for blob: bob_goldwaithe/bob_goldwaithe.pdf
Document analyzed. Extracted data: PatientName=Bob Goldwaithe, ...
Successfully stored document with ID: <new-document-id>
```

🎉 **It worked.**

### The Lesson

**Flex Consumption requires Event Grid for blob triggers.** Polling is not supported. The function dropdown in the Azure Portal may not work—use the webhook URL approach instead. Event Grid subscriptions can take a minute to activate after creation. Be patient.

---

## Chapter 5: The Connection String Conundrum

One more surprise: **Flex Consumption does not support Key Vault references for blob trigger connections.**

I had configured `BlobStorageConnection` as a Key Vault reference:

```
@Microsoft.KeyVault(SecretUri=https://<your-keyvault>.vault.azure.net/secrets/BlobStorageConnection)
```

The function couldn't read it for the blob trigger. Why? Because the blob extension needs the connection string *before* the function runtime initializes, and Key Vault references resolve *during* runtime initialization. Chicken, meet egg.

### The Solution

Use a **plain connection string** for `BlobStorageConnection` in application settings. Not a Key Vault reference. Just the raw connection string.

For other secrets (like `DocumentIntelligenceKey` or `MongoDBConnectionString`), Key Vault references work fine. But the blob trigger connection must be plain text.

### The Lesson

Not all application settings are created equal. Some need to be available pre-runtime. Check the docs (or learn through pain, like I did) to see which settings must be plain strings vs. Key Vault references.

---

## Chapter 6: Idempotency and Production Readiness

Once the function started triggering, I saw duplicate processing attempts. The same blob triggered multiple times, and my logs showed:

```
Blob bob_goldwaithe/bob_goldwaithe.pdf already processed (Document ID: <existing-document-id>)
Skipping processing.
```

This was intentional. My `MongoDbService` checks if a document with the same blob URI already exists before inserting:

```csharp
var existingDoc = await _collection.Find(filter).FirstOrDefaultAsync();
if (existingDoc != null)
{
    _logger.LogInformation("Document already exists with ID {id}", existingDoc.Id);
    return existingDoc.Id;
}
```

Idempotency in action. Event Grid can deliver the same event multiple times (especially during retries). The function gracefully handles duplicates without creating redundant database records.

### The Lesson

**Design for idempotency from day one.** Blob triggers can fire multiple times for the same blob. Your processing logic should detect and skip duplicates. Use unique identifiers (like blob URIs) as keys in your database to enforce this.

---

## Chapter 7: The Cost of Flex vs. The Cost of Everything Else

Here's the cost breakdown for Flex Consumption vs. a traditional Consumption or Premium plan:

- **Flex Consumption**: Pay per execution + execution time + memory usage. Execution time is billed in **GB-seconds** (calculated from MB-milliseconds of execution). Scales up to **1,000 instances per region** (default limit is 100, configurable minimum is 40). Includes always-ready instances (configurable 0-100) with baseline billing even when idle. **Note**: Only truly pay-per-execution if always-ready instances = 0.
  
- **Traditional Consumption**: Pay per execution + execution time (GB-s). Limited to **200 instances**. Includes 1 million executions and 400,000 GB-s free per month.

- **Premium (EP2)**: Base cost of **~€280/month** (Windows) or **~€205/month** (Linux) in West Europe for always-on compute + per-execution costs when scaling. No scale limits. Includes VNET integration and no cold starts.

### Understanding Flex Consumption Billing

Flex Consumption has two billing modes:

1. **On-Demand Executions**: Billed for actual execution time only. Receives free grant (check current pricing for amounts). Execution units calculated as: `(instance memory in MB) × (execution time in milliseconds) / 1,024,000 = GB-seconds`

2. **Always-Ready Instances**: If configured > 0, you pay a baseline rate for provisioned capacity (whether executing or not) PLUS execution time when functions run. Always-ready instances have lower per-execution costs but no free grants.

**Key Billing Metrics** (from Azure Monitor):
- `OnDemandFunctionExecutionCount` - Charged per 10 executions
- `OnDemandFunctionExecutionUnits` - Execution time in GB-seconds
- `AlwaysReadyUnits` - Baseline charge for always-ready capacity (even when idle)
- `AlwaysReadyFunctionExecutionUnits` - Execution time on always-ready instances

For a dev environment with low traffic and the Azure Functions free grant applied to on-demand executions, Flex Consumption costs are minimal. My monthly cost: **under €5** for the function app itself. However, **Azure App Configuration can easily become your biggest cost item** at ~€60/month for this MVP, significantly exceeding the combined costs of Cosmos DB, Document Intelligence, and the Function App.

![Cost Breakdown by Service](src/posts/cost.png)

*Monthly cost breakdown showing relative costs of each Azure service*

**Cost Warning**: **Azure App Configuration** is deceptively expensive for small projects. The Standard tier pricing model adds up quickly even with moderate usage, and there's no true consumption-based option. For an MVP or dev environment, **App Configuration can cost more than all your other services combined**. Seriously consider alternatives:
- Store configuration in Azure Key Vault (if secrets-only)
- Use Function App application settings directly (for simple scenarios)
- Implement configuration caching to reduce read operations
- Evaluate if you truly need a dedicated configuration service for your scale

As shown in the cost breakdown, App Configuration can represent 60-70% of your total infrastructure spend—a disproportionate cost for a feature that should be supporting infrastructure, not driving it.

**Important**: The default Flex Consumption configuration may include always-ready instances. For true pay-per-execution with no idle costs, explicitly configure `--always-ready-instances 0` during creation. With 0 always-ready instances, your app can scale to zero when idle, but may experience slightly longer cold starts. Traditional Consumption may actually be cheaper for very infrequent invocations due to its generous free grant.

### The Lesson

Flex Consumption is cost-effective for production workloads with consistent traffic or bursts requiring fast scale (up to 1,000 instances). For dev/test environments with sporadic use:

- **For true pay-per-execution**: Set always-ready instances to 0 and leverage the free grant on on-demand executions
- **For reduced latency**: Configure 1-2 always-ready instances but accept baseline costs even when idle
- **For infrequent invocations**: Traditional Consumption might be cheaper due to its generous monthly free grant

The trade-off? Event Grid requirements and slightly longer cold starts with 0 always-ready instances vs. instant response with always-ready > 0 plus baseline costs.

---

## Chapter 8: Naming Conventions Matter (Especially for Organized Blobs)

My function organizes blobs into subfolders based on patient name. A blob named `bob_goldwaithe_prior_auth.pdf` gets moved to `bob_goldwaithe/bob_goldwaithe.pdf`. This keeps the `faxes` container tidy and makes blobs easier to find.

The code extracts the patient name from the blob name and constructs a new blob path:

```csharp
var patientName = blobName.Split('_')[0] + "_" + blobName.Split('_')[1];
var newBlobName = $"{patientName}/{patientName}.pdf";
```

This works because my fax filenames follow a strict convention: `{firstName}_{lastName}_prior_auth.pdf`.

### The Lesson

Establish naming conventions early. They make downstream processing easier. If your blob names are random UUIDs, extracting metadata becomes harder. Structure your inputs to make your processing logic simpler.

---

## Chapter 9: Managed Identity Everywhere

Every service in AuthPilot uses managed identity:

- **Function App → Key Vault**: System-assigned identity with `Key Vault Secrets User` role
- **Function App → Cosmos DB**: User-assigned identity with connection string in Key Vault (future: RBAC directly)
- **Function App → Document Intelligence**: API key in Key Vault (no managed identity support yet)

No hardcoded secrets. No connection strings in environment variables. Everything flows through Azure AD and Key Vault.

### The Lesson

Managed identities eliminate credential management headaches. Use them wherever possible. Store remaining secrets (like third-party API keys) in Key Vault. Your security team will thank you.

---

## Chapter 10: Testing the Deployment

Final validation checklist:

1. ✅ HTTP trigger (`/api/test/mongo`) works → Cosmos DB connectivity confirmed
2. ✅ Blob trigger fires on upload → Event Grid subscription working
3. ✅ Document Intelligence processes blobs → API key and endpoint correct
4. ✅ Idempotency prevents duplicates → Database logic sound
5. ✅ Logs flow to Application Insights → Observability in place

I uploaded 10 test blobs. All processed successfully. No errors. No duplicates. The system was production-ready.

### The Lesson

Test each integration point individually before declaring victory. A working deployment isn't just "the function runs." It's "the function runs *and* connects to every dependency correctly."

---

## The Final Deployment Checklist

Here's what I learned the hard way, distilled into a checklist for future deployments:

### Pre-Deployment
- [ ] Understand SKU limitations (Flex Consumption = Event Grid required)
- [ ] Create secrets in Key Vault
- [ ] Grant managed identities appropriate RBAC roles
- [ ] Configure application settings (not local.settings.json)
- [ ] Use plain connection strings for blob trigger connections

### Deployment
- [ ] Deploy function code (`func azure functionapp publish`)
- [ ] Verify deployment storage configuration (avoid creative container names)
- [ ] Check Key Vault references show green checkmarks
- [ ] Register Event Grid provider (`az provider register --namespace Microsoft.EventGrid`)

### Post-Deployment
- [ ] Create Event Grid subscription with webhook URL
- [ ] Use subject filters to limit events to specific containers
- [ ] Upload test blob and verify trigger fires
- [ ] Check Application Insights for logs
- [ ] Confirm idempotency by uploading same blob twice

### Validation
- [ ] Test each integration (HTTP trigger, blob trigger, database, AI service)
- [ ] Verify no secrets leaked to logs or source control
- [ ] Confirm costs align with expectations
- [ ] Document any quirks for future you (or teammates)

---

## Final Thoughts

Remember that opening paragraph where I had "the infrastructure, the code, and confidence"? Turns out confidence without understanding is just optimism. Deploying AuthPilot taught me that **Azure Functions are easy until they're not**—and Flex Consumption has a learning curve that traditional Consumption plans don't prepare you for.

The journey from "this should take 10 minutes" to "why won't this trigger?" taught me more about Azure Functions than any tutorial could. Event Grid isn't just a nice-to-have for Flex Consumption—it's mandatory. Managed identities aren't just best practice—they're the difference between red X icons and green checkmarks. Deployment storage isn't just a detail—it's the difference between successful deploys and cryptic error messages.

**What started as a simple deployment became a masterclass in:**
- Understanding the architectural differences between Consumption plans
- Reading error messages that don't tell you what's actually wrong
- Recognizing when Azure documentation says "optional" but really means "required for your use case"
- Learning that €60/month for App Configuration can exceed all your other infrastructure costs combined

**The system works now**. Faxes arrive. PDFs get uploaded to the `faxes` container. Event Grid fires. The function triggers. Document Intelligence extracts structured data with the custom-trained model. Cosmos DB stores the results. Idempotency prevents duplicates. Application Insights captures telemetry.

But more importantly: **you can deploy it too**. Clone the [infrastructure repo](https://github.com/GitBuntu/cerebricep) and [application repo](https://github.com/GitBuntu/authpilot), follow the Quick Start checklist, and you'll have a working document processing pipeline in 30 minutes. You'll avoid the hours I spent debugging because you now know:

✅ Flex Consumption requires Event Grid for blob triggers  
✅ Always-ready instances = 0 for true pay-per-execution  
✅ Dedicated deployment storage container  
✅ Plain connection strings for blob triggers  
✅ System-assigned identity needs Key Vault access  
✅ App Configuration costs add up fast  

The biggest lesson? **Fail fast, document thoroughly, share widely**. Every "Red X of Shame" I encountered is now a green checkmark you won't have to debug. Every cryptic error message I decoded is now a checklist item you can follow.

Go build something. Break something. Learn something. Then write it down so the next person doesn't have to.
