---
title: "AuthPilot Fax Processing: Tales from the IaC Trenches"
date: 2025-12-20
slug: authpilot-fax-processing-iac
tags: [azure, bicep, infrastructure-as-code, lessons-learned]
---

# AuthPilot Fax Processing: Tales from the IaC Trenches

When I set out to build AuthPilot — a fax processing system powered by Azure Functions and AI — I thought it would be straightforward. Deploy a few resources, run some AI models, call it a day. Spoiler alert: Infrastructure as Code has opinions. *Loud* opinions. Here are the battle scars and the wisdom I gained.

## The Setup: What I Built

First, a quick tour of my Azure estate (yes, I built an "estate" for a fax processing system — I'm nothing if not ambitious):

- **Azure Functions** running .NET 9.0 (Flex Consumption SKU—more on that later)
- **Cosmos DB** for storing fax metadata and processing history
- **Azure Storage** for PDF caching and blob storage
- **Document Intelligence** for OCR and fax content extraction
- **Key Vault** for secrets (the responsible way)
- **Managed Identities** for passwordless, guilt-free authentication
- **Log Analytics & Application Insights** to watch it all fail in real-time

![AuthPilot Resources Architecture](src/posts/resources.png)

Nothing revolutionary. But getting from "let's deploy this" to "it's actually deployed" taught me some valuable lessons.

## Lesson 1: Quota Limits Are Not Suggestions

### The Problem

I started with an ambitious goal: use the `Y1` Consumption plan. Free tier. Minimal cost. What could go wrong?

*Everything.*

My Azure subscription—a free trial because who has budget for infrastructure?—hit a regional quota limit in East US. **Zero** instances available. I wasn't alone; free subscriptions get much tighter quotas than Enterprise Agreement accounts. The error message was delightfully vague: "Regional subscription limit: 0 instances available."

![Deployment Attempt Failures](src/posts/deploymentattempt.png)

### The Solution

Enter **Flex Consumption** (`FC1` SKU, `FlexConsumption` tier). No regional quotas. Scales to 1000 instances. Suddenly, my deployment didn't get rejected by invisible Azure gatekeepers.

### The Lesson

Check your actual quota availability before committing to a SKU. A five-minute call to Azure support or a quick browse through the portal's quota page beats eight hours of deployment failures wondering if you've somehow broken the cloud.

**Pro tip**: Use Flex for dev/free subscriptions. It's like the cloud equivalent of getting a building permit—there's still red tape, but fewer of it.

---

## Lesson 2: Bicep's SKU Names and ARM's SKU Names Are Not Friends

### The Problem

Emboldened by my Flex Consumption epiphany, I wrote:

```bicep
var skuName = 'Flex'
var skuTier = 'Consumption'
```

The ARM template validation laughed. "Invalid SKU.Name: 'Flex'."

Turns out, ARM templates want the *actual* internal names: `FC1` for the name, `FlexConsumption` for the tier. Bicep's more human-friendly `'Flex'` is a nice abstraction layer that the runtime doesn't understand.

### The Solution

Map the friendly names to ARM requirements:

```bicep
var isFlex = sku == 'Flex'
var skuName = isFlex ? 'FC1' : sku
var skuTier = isFlex ? 'FlexConsumption' : 'ElasticPremium'
```

### The Lesson

Azure has both customer-facing names and internal API names. They're not the same. Always check the ARM template schema when moving between abstraction layers. Your IDE's intellisense lies to you in a very polite way.

---

## Lesson 3: Different SKUs Have Completely Different Config Requirements

This one hurt.

### The Problem

I wrote a single, elegant site configuration object with conditionals:

```bicep
var siteConfig = {
  linuxFxVersion: isFlexConsumption ? null : 'DOTNET-ISOLATED|9.0'
  // ... other stuff
}
```

Three deployment failures later:

1. **Error 1**: "LinuxFxVersion is invalid for Flex Consumption sites." (Flex specifies runtime in `functionAppConfig`, not `siteConfig`.)
2. **Error 2**: "FunctionAppConfig is required on create for FlexConsumption sites." (I forgot to include it entirely.)
3. **Error 3**: "FUNCTIONS_WORKER_RUNTIME is invalid for Flex Consumption sites." (It was in appSettings—Flex doesn't want it there either.)

### The Solution

Stop with the cute `null` conditionals. Create completely separate configuration objects:

```bicep
var siteConfigFlex = {
  // No linuxFxVersion here
  // No FUNCTIONS_WORKER_RUNTIME here
  // ... only Flex-compatible properties
}

var siteConfigStandard = {
  linuxFxVersion: 'DOTNET-ISOLATED|9.0'
  // ... standard properties
}

var siteConfig = isFlex ? siteConfigFlex : siteConfigStandard
```

### The Lesson

When different SKUs have different mandatory properties, don't compromise with conditionals. Generate completely separate configurations. The ARM template validation will thank you, and my future self won't curse past-me for being clever.

---

## Lesson 4: Naming Conflicts Will Eat Your Lunch

### The Problem

I used deterministic naming with a fixed suffix (`-001`) for everything. Great for production! Terrible for dev. Every retry deployment tried to update the same resource, and if the Bicep changed, things got weird.

### The Solution

Environment-aware naming:

- **Dev**: `take(uniqueString(deployment().name), 5)` — generates a unique 5-character suffix per deployment
- **Prod**: `-001` — stable, predictable names for production consistency

```bicep
var nameSuffix = environment == 'dev' 
  ? take(uniqueString(deployment().name), 5)
  : '-001'

var funcAppName = 'func-cerebricep-${environment}${nameSuffix}'
```

### The Lesson

IaC is about idempotency. Deploying the same template multiple times should be safe. Dev environments benefit from unique naming per deployment (safer for repeated tests). Production needs stable, fixed names (easier to monitor and manage). Don't use the same naming strategy everywhere.

---

## Lesson 5: Test Your `.bicepparam` Files Before Deployment

### The Problem

I kept passing invalid parameters to my `az deployment sub create` command. The errors were cryptic and only appeared at deployment time — 3 minutes into a 5-minute deployment that was about to fail anyway.

### The Solution

```bash
az bicep build-params --file infra/workloads/authpilot/dev.bicepparam
```

This validates the parameter file before deployment. Catches missing required parameters, type mismatches, and other happiness-killing issues in under 5 seconds.

### The Lesson

Validate early. Two commands instead of one, but you'll save the sanity.

---

## Lesson 6: Managed Identities > Hardcoded Secrets (Obviously)

I'm not going to lecture you on this. But I *will* say: I stored API keys in Key Vault and used managed identity RBAC to grant the Function App access. No connection strings in app settings. No credentials in GitHub Actions logs. The system worked because Azure AD did the heavy lifting.

And it meant my GitHub Actions workflow could use OIDC federation—no service principal credentials stored as secrets. Just a token exchange and a federated credential pointing to my GitHub repo.

**Do this.**

---

## Lesson 7: Cost Optimization is Real and Glorious

Here's my cost breakdown by environment:

- **Dev**: ~$15-20/month
  - Consumption (or Flex) Function App
  - 400 RU/s Cosmos DB
  - Free tier Document Intelligence (1 page/month limit, but it's free!)
  - No private endpoints, no zone redundancy

- **Prod**: ~$500+/month
  - EP2 Premium Function App
  - 4000 RU/s Cosmos DB
  - Standard Document Intelligence
  - Private endpoints enabled, zone redundancy everywhere

This is a **25x difference**, and it's *entirely intentional*. Dev doesn't need the infrastructure of production. Don't treat it like it does.

### The Lesson

Use environment-specific parameter files to tailor resource tiers, SKUs, and replication settings. Your finance team will appreciate it.

---

## Lesson 8: What-If Analysis Is Your Friend

Before deploying to production, I run:

```bash
az deployment sub what-if \
  --name $DEPLOYMENT_NAME \
  --location eastus \
  --template-file infra/main.bicep \
  --parameters infra/workloads/authpilot/prod.bicepparam
```

This shows exactly what will change. No surprises. No "oh wait, I didn't mean to delete that." Just a clear preview of what the cloud is about to do with your infrastructure.

### The Lesson

Always preview before you deploy. It takes 30 seconds and prevents catastrophes.

---

## Lesson 9: Separate Config Objects, Not Separate Templates

I was tempted to create three separate Bicep files: `main-dev.bicep`, `main-uat.bicep`, `main-prod.bicep`. I didn't. Instead, I created one `main.bicep` with parameter files:

- `dev.bicepparam` — Dev configuration
- `uat.bicepparam` — UAT configuration  
- `prod.bicepparam` — Production configuration

Same template, different parameters. Single source of truth for infrastructure logic. This is the way.

### The Lesson

Parameters are for variety, not Ctrl+C/Ctrl+V. Keep your Bicep DRY (Don't Repeat Yourself). If you're copy-pasting templates, you're setting yourself up for divergence and maintenance nightmares.

---

## Lesson 10: Module Outputs Are Your Currency

Each Bicep module outputs what downstream modules need:

```bicep
output functionAppId string = functionApp.id
output managedIdentityPrincipalId string = userAssignedIdentity.properties.principalId
output keVaultUri string = keyVault.properties.vaultUri
```

`main.bicep` then passes these outputs to the next module:

```bicep
module functionApp 'compute/function-app.bicep' = {
  scope: resourceGroup
  name: 'deploy-function-app'
  params: {
    keyVaultUri: configModule.outputs.keVaultUri
    managedIdentityPrincipalId: identityModule.outputs.managedIdentityPrincipalId
    // ...
  }
}
```

This forces explicit dependency management. Resources deploy in the right order. RBAC role assignments get the right principal IDs. No guessing, no hardcoding.

### The Lesson

Think of Bicep modules like functions in code. Inputs are parameters. Outputs are return values. Design with outputs in mind, and your infrastructure becomes testable and composable.

---

## The Final Form

When it all came together, my infrastructure looked like this:

1. **Resource Group** → Container for everything
2. **Log Analytics & Application Insights** → Telemetry foundation (others depend on this)
3. **User-Assigned Managed Identity** → Authentication backbone
4. **Key Vault & App Configuration** → Secrets and config management
5. **Storage & Cosmos DB** → Data layer
6. **Document Intelligence** → AI service
7. **Azure Functions** → Orchestration (depends on everything above)

Each layer builds on the previous one. Each module outputs what the next layer needs. The `main.bicep` orchestrates the whole symphony. And the parameter files let me play the same symphony in three different keys: dev, uat, and prod.

---

## Final Thoughts

Building AuthPilot's infrastructure taught me that IaC isn't about fancy Bicep tricks—it's about predictability, repeatability, and respect for the fact that you *will* deploy this again (maybe 50 times), and you want it to work the 50th time just like it worked the first time.

Check your quotas early. Name your resources idempotently. Use managed identity. Separate your configs by environment. And for the love of all that is holy, validate your Bicep before deployment.

The cloud is patient, but it's also unforgiving. IaC is how you build trust with it.

Now if you'll excuse me, I have 47 more deployments to test.

---
