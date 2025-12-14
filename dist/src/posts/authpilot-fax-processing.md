---
title: "Building AuthPilot: Automating Healthcare Prior Authorization with Azure Functions and Document Intelligence"
date: 2025-12-02
slug: authpilot-fax-processing
tags: [azure, azure-functions, document-intelligence, mongodb, csharp, healthcare]
---

# Building AuthPilot: Automating Healthcare Prior Authorization with Azure Functions and Document Intelligence

*A practical guide to building an automated fax processing pipeline that extracts structured data from healthcare prior authorization documents*

## Introduction

Prior authorization in healthcare is a necessary but time-consuming process. Insurance companies receive thousands of faxes daily containing prior authorization requests, each requiring manual data entry and review. What if we could automate the extraction of key fields from these documents?

**AuthPilot** is an Azure Functions-based solution that automatically processes fax documents uploaded to blob storage, extracts 25 structured fields using Azure Document Intelligence, and stores the results in MongoDB for downstream processing.

## Architecture Overview

AuthPilot follows an event-driven architecture built on Azure Functions v4 with .NET 9:

```
Fax Upload → Blob Storage → Azure Function → Document Intelligence → MongoDB
```

### Components

| Component | Purpose |
|-----------|---------|
| **Azure Blob Storage** | Receives incoming fax documents (PDF, TIFF, TIF) |
| **Azure Functions** | Blob-triggered processing pipeline |
| **Azure Document Intelligence** | Custom-trained model for field extraction |
| **MongoDB** | Stores structured authorization data |

### Data Flow

1. Fax document uploaded to `faxes` container
2. Blob trigger activates the Azure Function
3. Function organizes file into patient-specific folder
4. Document sent to Document Intelligence for analysis
5. Extracted data stored in MongoDB with processing status

## The Document Model

Healthcare prior authorization faxes contain predictable fields. We defined a comprehensive model covering 25 data points across six categories:

### Patient Information
```csharp
[BsonElement("patientName")]
public string? PatientName { get; set; }

[BsonElement("dateOfBirth")]
public DateTime? DateOfBirth { get; set; }

[BsonElement("memberId")]
public string? MemberId { get; set; }

[BsonElement("policyNumber")]
public string? PolicyNumber { get; set; }
```

### Provider Information
- Provider Name (treating physician)
- NPI Number
- Provider Contact (phone)
- Facility Name and Address
- Referring Provider

### Service Information
- Service Type (e.g., "Outpatient Physical Therapy")
- CPT Codes (procedure codes)
- ICD-10 Codes (diagnosis codes)
- Service Start/End Dates
- Units Requested
- Urgency Level

### Clinical and Administrative Fields
- Clinical Notes (justification)
- Fax Received Date
- Page Count
- Fax Header information (sender, recipient, dates)

## Azure Functions Implementation

### Blob Trigger with Auto-Organization

A key design decision was organizing incoming faxes into patient-specific folders. When a fax is uploaded to the root of the container, the function automatically creates a folder structure:

```csharp
[Function("ProcessFax")]
public async Task Run(
    [BlobTrigger("faxes/{name}", Connection = "BlobStorageConnection")] Stream blobStream,
    string name,
    FunctionContext context)
{
    // Skip if already in a subfolder
    if (name.Contains('/'))
    {
        await ProcessOrganizedFax(name, blobStream, startTime);
        return;
    }

    // Only process supported fax formats
    if (!IsSupportedFaxFormat(name))
    {
        _logger.LogInformation("Skipping unsupported file format: {BlobName}", name);
        return;
    }

    // Move file to its own folder
    var folderName = Path.GetFileNameWithoutExtension(name);
    var newBlobPath = $"{folderName}/{name}";
    
    // Copy to new location, delete original
    await OrganizeBlobAsync(name, newBlobPath);
}
```

This pattern ensures each fax gets its own folder, which becomes important when Document Intelligence generates additional files (`.ocr.json`, `fields.json`) during analysis.

### Supported File Formats

```csharp
private static bool IsSupportedFaxFormat(string fileName)
{
    return fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ||
           fileName.EndsWith(".tiff", StringComparison.OrdinalIgnoreCase) ||
           fileName.EndsWith(".tif", StringComparison.OrdinalIgnoreCase);
}
```

### Idempotency Check

To prevent duplicate processing (especially important with blob triggers that can fire multiple times), we check if a document was already processed:

```csharp
if (await _mongoDbService.IsBlobAlreadyProcessedAsync(blobPath))
{
    _logger.LogInformation("Blob {BlobName} already processed, skipping.", blobPath);
    return;
}
```

## Document Intelligence Integration

### Custom Model Training

Azure Document Intelligence allows training custom extraction models using labeled documents. The training process involves:

1. **Upload training documents** to a dedicated blob container (`training-data`)
2. **Label fields** in Document Intelligence Studio
3. **Train the model** on labeled examples
4. **Deploy** for inference via API

**Important:** Keep training data separate from production data. Training generates metadata files (`.ocr.json`, `fields.json`, `pdf.jsonl`) that you don't want triggering your production function.

### Field Mapping

When labeling documents in Document Intelligence Studio, use exact field names that match your code model:

| Document Field | Label Name |
|----------------|------------|
| Patient Name: Bob Goldwaithe | `PatientName` |
| Date of Birth: 03/15/1962 | `DateOfBirth` |
| Member ID: BCB-892741635 | `MemberId` |
| CPT Codes: 97110, 97140, 97530 | `CptCodes` |

![Model Data Extraction](src/posts/model_data_extraction.png)

**Pro tip:** Only select the value, not the field label. For `PatientName`, select "Bob Goldwaithe" - not "Patient Name: Bob Goldwaithe".

### Extraction Service

The Document Intelligence service sends the blob stream directly to the API and maps results to our model:

```csharp
public async Task<ExtractedAuthorizationData> AnalyzeFaxDocumentAsync(Stream blobStream, string modelId)
{
    var operation = await _client.AnalyzeDocumentAsync(
        WaitUntil.Completed, 
        modelId, 
        blobStream);
    
    var result = operation.Value;
    
    if (result.Documents.Count == 0)
    {
        return new ExtractedAuthorizationData();
    }

    return MapToExtractedData(result.Documents[0]);
}
```

The mapping handles different field types appropriately:

```csharp
private DateTime? GetFieldDateValue(IReadOnlyDictionary<string, DocumentField> fields, string fieldName)
{
    if (fields.TryGetValue(fieldName, out var field))
    {
        if (field.FieldType == DocumentFieldType.Date)
        {
            return field.Value.AsDate().DateTime;
        }
        else if (field.FieldType == DocumentFieldType.String)
        {
            // Fall back to string parsing for date fields returned as strings
            if (DateTime.TryParse(field.Value.AsString(), out var parsedDate))
            {
                return parsedDate;
            }
        }
    }
    return null;
}
```

## MongoDB Integration

### Document Structure

Each processed fax becomes a MongoDB document:

```csharp
public class AuthorizationDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("blobName")]
    public string BlobName { get; set; } = string.Empty;

    [BsonElement("fileName")]
    public string FileName { get; set; } = string.Empty;

    [BsonElement("uploadedAt")]
    public DateTime UploadedAt { get; set; }

    [BsonElement("processedAt")]
    public DateTime? ProcessedAt { get; set; }

    [BsonElement("status")]
    public string Status { get; set; } = "processing";

    [BsonElement("extractedData")]
    public ExtractedAuthorizationData? ExtractedData { get; set; }

    [BsonElement("errorMessage")]
    public string? ErrorMessage { get; set; }
}
```

### Status Lifecycle

Documents transition through three states:

| Status | Meaning |
|--------|---------|
| `processing` | Document received, analysis in progress |
| `completed` | Analysis successful, data extracted |
| `failed` | Analysis failed, error message stored |

### Service Implementation

The MongoDB service provides simple CRUD operations:

```csharp
public async Task<string> CreateAuthorizationDocumentAsync(string blobName, string fileName, DateTime uploadedAt)
{
    var document = new AuthorizationDocument
    {
        BlobName = blobName,
        FileName = fileName,
        UploadedAt = uploadedAt,
        Status = "processing"
    };

    await _collection.InsertOneAsync(document);
    return document.Id!;
}

public async Task UpdateAuthorizationWithExtractedDataAsync(string documentId, ExtractedAuthorizationData extractedData)
{
    var filter = Builders<AuthorizationDocument>.Filter.Eq(d => d.Id, documentId);
    var update = Builders<AuthorizationDocument>.Update
        .Set(d => d.ExtractedData, extractedData)
        .Set(d => d.Status, "completed")
        .Set(d => d.ProcessedAt, DateTime.UtcNow);

    await _collection.UpdateOneAsync(filter, update);
}
```

## Local Development Setup

### Prerequisites

- .NET 9 SDK
- Azure Functions Core Tools v4
- Docker (for MongoDB)
- Azure subscription (for Blob Storage and Document Intelligence)

### MongoDB via Docker

```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

### Configuration

Create `local.settings.json` with your connection details:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "BlobStorageConnection": "<your-blob-connection-string>",
    "MongoDBConnectionString": "mongodb://localhost:27017/",
    "MongoDBDatabase": "authpilot",
    "MongoDBCollection": "authorizations",
    "DocumentIntelligenceEndpoint": "<your-di-endpoint>",
    "DocumentIntelligenceKey": "<your-di-key>",
    "DocumentIntelligenceModelId": "<your-custom-model-id>"
  }
}
```

### Running Locally

```bash
cd src
func start
```

Upload a PDF to your `faxes` container and watch the magic happen!

## Demo: AuthPilot in Action

<video width="100%" controls style="max-width: 800px; margin: 2rem auto; display: block; border-radius: 8px;">
  <source src="/the-orchestration-layer/FunctionTest.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

## Infrastructure as Code Deployment

AuthPilot requires provisioning several Azure resources. Use Infrastructure as Code to define and deploy them consistently:

### Required Azure Resources

| Resource | Type | Purpose | IaC Template |
|----------|------|---------|--------------|
| **Blob Storage** | `Microsoft.Storage/storageAccounts` | Stores incoming faxes and training data | Configure containers: `faxes`, `training-data` |
| **Azure Functions** | `Microsoft.Web/sites` | Executes blob-triggered processing pipeline | Runtime: .NET 9 isolated, v4 |
| **Document Intelligence** | `Microsoft.CognitiveServices/accounts` | Custom model for field extraction | SKU: `S0` or higher |
| **MongoDB Atlas** | External managed service | Stores extraction results and metadata | Connection via MongoDB driver, secured with IP whitelist |
| **Application Insights** | `Microsoft.Insights/components` | Monitoring and diagnostics | Linked to Functions app |

### Key IaC Patterns

**1. Separate Storage Accounts for Training and Production**
- `storageAccounts/training` - Contains labeled training data and generated metadata (`.ocr.json`, `fields.json`)
- `storageAccounts/production` - Contains incoming faxes and processed results
- This separation prevents training metadata from triggering the production function

**2. Document Intelligence Binding**
Ensure the managed identity of your Functions app has `Cognitive Services User` role on the Document Intelligence resource.

**3. MongoDB Atlas Connection Security**
- Store connection string in Azure Key Vault with restricted database user credentials
- Reference via `@Microsoft.KeyVault(SecretUri=...)` in app settings
- Configure MongoDB Atlas IP whitelist to allow only your Azure Functions outbound IPs
- Use network peering or VPN for production workloads requiring higher isolation
- Enable MongoDB Atlas audit logging for compliance tracking

### Deployment Checklist

- [ ] Create separate resource groups for training and production
- [ ] Provision storage accounts with appropriate access tiers
- [ ] Train Document Intelligence model in staging environment
- [ ] Deploy Functions app with correct runtime version and permissions
- [ ] Configure blob trigger binding to exclude training data patterns
- [ ] Enable Application Insights diagnostics
- [ ] Set up monitoring alerts for failed documents and function errors
- [ ] Test blob-triggered idempotency with retry scenarios

## What's Next

With AuthPilot's architecture defined, the next phase is deployment to Azure. This involves:

1. **Bicep Template Development** - Create modular Bicep files for all resources (storage, functions, Document Intelligence, Key Vault)
2. **CI/CD Pipeline Setup** - Configure GitHub Actions to automatically deploy on push to main branch
3. **Document Intelligence Model Training** - Use labeled faxes to train your custom extraction model in the staging environment
4. **End-to-End Testing** - Deploy to production environment and process real faxes through the complete pipeline
5. **Monitoring & Alerting** - Configure Application Insights dashboards and set thresholds for failed documents and performance metrics

Refer to the [Infrastructure as Code Deployment](#infrastructure-as-code-deployment) section for resource definitions and the deployment checklist.

## Code Repository

The complete AuthPilot codebase is available on GitHub: [github.com/GitBuntu/authpilot](https://github.com/GitBuntu/authpilot)

---
