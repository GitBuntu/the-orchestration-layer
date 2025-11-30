---
title: "Building Callistra: Part 1 - From Concept to Local Testing with Azure Functions"
date: 2025-11-30
slug: article-1-local-harness
tags: [azure, azure-functions, csharp, entity-framework]
---

# Building Callistra: Part 1 - From Concept to Local Testing with Azure Functions

*A deep dive into building an automated healthcare call center system using Azure Functions, Entity Framework Core, and the Local Harness pattern*

## Introduction

Healthcare outreach is critical but resource-intensive. What if we could automate enrollment calls while maintaining a human touch? This is the challenge we set out to solve with **Callistra** - an Azure Functions-based call agent API designed to handle healthcare program enrollment calls at scale.

In this two-part series, I'll walk through the complete development journey, from initial architecture decisions to placing real phone calls via Azure Communication Services. Part 1 focuses on establishing the foundation: database design, Azure Functions setup, and local testing with our custom harness.

## Architecture Overview

Callistra follows a clean, layered architecture built on Azure Functions v4 with .NET 8:

- **Data Layer**: Entity Framework Core with SQL Server
- **Business Logic**: Service layer with repository pattern
- **API Layer**: HTTP-triggered Azure Functions
- **Testing Layer**: Local Harness for call simulation

The system manages three core entities:

1. **Members** - People to call for program enrollment
2. **CallSessions** - Individual call attempts with outcomes
3. **CallResponses** - Question/answer pairs collected during calls

## Phase 1: Database Foundation

### Entity Design

We started with the `Member` entity, representing individuals in our healthcare programs:

```csharp
public class Member
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [Phone]
    [MaxLength(20)]
    public string PhoneNumber { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string Program { get; set; } = string.Empty;

    [Required]
    [MaxLength(25)]
    public string Status { get; set; } = "Pending";

    public DateTime DateOfBirth { get; set; }

    // Navigation properties
    public ICollection<CallSession> CallSessions { get; set; } = new List<CallSession>();

    // Computed properties for backward compatibility
    public string FirstName => Name.Split(' ').FirstOrDefault() ?? string.Empty;
    public string LastName => Name.Split(' ').Skip(1).FirstOrDefault() ?? string.Empty;
}
```

The `CallSession` entity tracks each call attempt:

```csharp
public class CallSession
{
    public int Id { get; set; }

    [Required]
    public int MemberId { get; set; }

    [Required]
    [MaxLength(25)]
    public string Channel { get; set; } = "LocalHarness";

    public DateTime StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }

    [MaxLength(50)]
    public string? Outcome { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public bool Verified { get; set; } = false;

    // Navigation properties
    public Member Member { get; set; } = null!;
    public ICollection<CallResponse> Responses { get; set; } = new List<CallResponse>();

    // Computed property
    public string Status => EndedAt.HasValue ? "Completed" : "InProgress";
}
```

### Database Schema Alignment

One challenge was aligning modern C# conventions with existing database column names. Our database uses legacy names like `DOB` and `CreatedAt`, but we wanted clean property names in code:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Member>(entity =>
    {
        entity.ToTable("MembersToCall");

        // Map modern property names to legacy column names
        entity.Property(e => e.DateOfBirth).HasColumnName("DOB");
        entity.Property(e => e.CreatedDate).HasColumnName("CreatedAt");
        entity.Property(e => e.UpdatedDate).HasColumnName("UpdatedAt");

        // Ignore computed properties
        entity.Ignore(e => e.FirstName);
        entity.Ignore(e => e.LastName);
    });
}
```

### Docker-Based SQL Server

For local development, we containerized SQL Server:

```yaml
# docker-compose.yaml
services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      ACCEPT_EULA: "Y"
      SA_PASSWORD: "CallAgent123!"
      MSSQL_PID: "Developer"
    ports:
      - "1433:1433"
    volumes:
      - sqlserver_data:/var/opt/mssql
      - ./init:/docker-entrypoint-initdb.d
```

This setup allows `docker compose up` from the `/db` directory to spin up a fully configured database in seconds.

## Phase 2: Azure Functions Implementation

### Project Structure

We organized the Functions project with clear separation of concerns:

```
CallAgent.Api/
├── Functions/           # HTTP trigger endpoints
├── Services/           # Business logic
├── Repositories/       # Data access
├── Models/
│   ├── Entities/      # EF Core entities
│   ├── DTOs/          # API request/response models
│   └── Configuration/ # Configuration classes
├── Data/              # DbContext
└── Migrations/        # EF Core migrations
```

### Dependency Injection Setup

Azure Functions v4 in-process model supports full dependency injection. We configured services in `Startup.cs`:

```csharp
public class Startup : FunctionsStartup
{
    public override void Configure(IFunctionsHostBuilder builder)
    {
        var configuration = builder.GetContext().Configuration;

        // Database with retry logic
        builder.Services.AddDbContext<CallAgentDbContext>(options =>
        {
            options.UseSqlServer(
                configuration["DATABASE_CONNECTION_STRING"],
                sqlOptions => sqlOptions
                    .EnableRetryOnFailure(
                        maxRetryCount: 3,
                        maxRetryDelay: TimeSpan.FromSeconds(5),
                        errorNumbersToAdd: null)
                    .CommandTimeout(30)
            );
        });

        // Repository pattern
        builder.Services.AddScoped<IMemberRepository, MemberRepository>();
        builder.Services.AddScoped<ICallSessionRepository, CallSessionRepository>();
        builder.Services.AddScoped<IUnitOfWork, UnitOfWork>();

        // Business services
        builder.Services.AddScoped<IMemberService, MemberService>();
        builder.Services.AddScoped<ICallSessionService, CallSessionService>();

        // Configuration binding
        builder.Services.AddOptions<CallAgentOptions>()
            .Configure<IConfiguration>((settings, config) =>
                config.GetSection(CallAgentOptions.SectionName).Bind(settings));
    }
}
```

### Function Endpoints

The `MemberOperations` class demonstrates our Function implementation pattern:

```csharp
public class MemberOperations
{
    private readonly IMemberService _memberService;
    private readonly ILogger<MemberOperations> _logger;

    public MemberOperations(IMemberService memberService, ILogger<MemberOperations> logger)
    {
        _memberService = memberService;
        _logger = logger;
    }

    [FunctionName("GetMembers")]
    public async Task<IActionResult> GetMembers(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "members")] HttpRequest req)
    {
        try
        {
            var members = await _memberService.GetAllMembersAsync();
            return new OkObjectResult(new ApiResponse<IEnumerable<Member>>
            {
                Success = true,
                Data = members
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving members");
            return new ObjectResult(new ApiResponse<IEnumerable<Member>>
            {
                Success = false,
                Message = "Failed to retrieve members",
                Errors = new[] { ex.Message }
            })
            {
                StatusCode = 500
            };
        }
    }
}
```

All responses use a consistent `ApiResponse<T>` wrapper:

```csharp
public class ApiResponse<T>
{
    public bool Success { get; set; }
    public T? Data { get; set; }
    public string? Message { get; set; }
    public string[]? Errors { get; set; }
}
```

## Phase 3: Local Harness Development

Before integrating with Azure Communication Services, we needed a way to test call flows locally. Enter the **Local Harness** - a console application that simulates phone calls.

### Architecture

The Local Harness is a separate .NET console project that:

1. Calls the Functions API to initiate a call session
2. Simulates user responses to questions
3. Records answers back to the API
4. Completes the session with an outcome

### Core Service Implementation

```csharp
public class LocalCallHarnessService : ILocalCallHarnessService
{
    private readonly HttpClient _httpClient;
    private readonly IQuestionEngine _questionEngine;
    private readonly ILogger<LocalCallHarnessService> _logger;

    public async Task<CallSessionResult> ExecuteCallSessionAsync(
        int memberId,
        CancellationToken cancellationToken = default)
    {
        // Start the call session
        var startResponse = await StartCallSessionAsync(memberId);
        if (!startResponse.Success)
        {
            return new CallSessionResult
            {
                Success = false,
                Message = "Failed to start call session"
            };
        }

        var sessionId = startResponse.Data!.Id;
        _logger.LogInformation("Call session {SessionId} started for member {MemberId}",
            sessionId, memberId);

        // Execute question flow
        var questions = await _questionEngine.GetQuestionsForProgramAsync(
            startResponse.Data.Member.Program);

        foreach (var question in questions)
        {
            // Simulate asking the question
            Console.WriteLine($"\n🤖 Agent: {question.QuestionText}");

            // Simulate user response (in real scenario, this comes from speech recognition)
            Console.Write("👤 Member: ");
            var userResponse = Console.ReadLine() ?? string.Empty;

            // Record the response
            await RecordResponseAsync(sessionId, question.QuestionNumber,
                question.QuestionText, userResponse);

            // Validate response
            var isValid = await _questionEngine.ValidateResponseAsync(
                question, userResponse);

            if (!isValid)
            {
                Console.WriteLine("⚠️  Invalid response, please try again");
            }
        }

        // Complete the session
        var outcome = DetermineOutcome(questions);
        await CompleteCallSessionAsync(sessionId, outcome);

        return new CallSessionResult
        {
            Success = true,
            SessionId = sessionId,
            Outcome = outcome
        };
    }
}
```

### Question Engine

The question engine manages the healthcare enrollment questionnaire:

```csharp
public class QuestionEngine : IQuestionEngine
{
    private readonly Dictionary<string, List<Question>> _programQuestions = new()
    {
        ["Smoking Cessation"] = new()
        {
            new Question
            {
                QuestionNumber = 1,
                QuestionText = "Are you currently smoking cigarettes?",
                ExpectedResponseType = ResponseType.YesNo,
                IsRequired = true
            },
            new Question
            {
                QuestionNumber = 2,
                QuestionText = "How many cigarettes do you smoke per day?",
                ExpectedResponseType = ResponseType.Numeric,
                IsRequired = true,
                ValidationRules = new ValidationRules
                {
                    MinValue = 0,
                    MaxValue = 100
                }
            },
            new Question
            {
                QuestionNumber = 3,
                QuestionText = "Are you interested in quitting smoking?",
                ExpectedResponseType = ResponseType.YesNo,
                IsRequired = true
            }
        }
    };

    public Task<List<Question>> GetQuestionsForProgramAsync(string program)
    {
        return Task.FromResult(_programQuestions.GetValueOrDefault(program)
            ?? new List<Question>());
    }

    public Task<bool> ValidateResponseAsync(Question question, string response)
    {
        return question.ExpectedResponseType switch
        {
            ResponseType.YesNo => Task.FromResult(
                response.Equals("yes", StringComparison.OrdinalIgnoreCase) ||
                response.Equals("no", StringComparison.OrdinalIgnoreCase)),

            ResponseType.Numeric => Task.FromResult(
                int.TryParse(response, out var numericValue) &&
                numericValue >= (question.ValidationRules?.MinValue ?? int.MinValue) &&
                numericValue <= (question.ValidationRules?.MaxValue ?? int.MaxValue)),

            _ => Task.FromResult(true)
        };
    }
}
```

### Console Interface

The harness provides a friendly console interface:

```csharp
public class Program
{
    static async Task Main(string[] args)
    {
        var host = CreateHostBuilder(args).Build();

        Console.WriteLine("╔════════════════════════════════════════════╗");
        Console.WriteLine("║   Callistra Local Call Harness             ║");
        Console.WriteLine("║   Healthcare Enrollment Simulation         ║");
        Console.WriteLine("╚════════════════════════════════════════════╝");
        Console.WriteLine();

        var callService = host.Services.GetRequiredService<ILocalCallHarnessService>();

        Console.Write("Enter Member ID to call: ");
        if (!int.TryParse(Console.ReadLine(), out var memberId))
        {
            Console.WriteLine("❌ Invalid Member ID");
            return;
        }

        Console.WriteLine($"\n📞 Initiating call to Member {memberId}...\n");

        var result = await callService.ExecuteCallSessionAsync(memberId);

        if (result.Success)
        {
            Console.WriteLine($"\n✅ Call completed successfully!");
            Console.WriteLine($"   Session ID: {result.SessionId}");
            Console.WriteLine($"   Outcome: {result.Outcome}");
        }
        else
        {
            Console.WriteLine($"\n❌ Call failed: {result.Message}");
        }
    }
}
```

## Testing the Complete Flow

### 1. Start SQL Server

```bash
cd db
docker compose up -d
```

### 2. Run EF Core Migrations

```bash
cd backend/src/CallAgent.Api
dotnet ef database update
```

### 3. Seed Test Data

```sql
INSERT INTO MembersToCall (Name, PhoneNumber, DOB, Program, Status, CreatedAt, UpdatedAt)
VALUES
    ('John Doe', '+15551234567', '1980-05-15', 'Smoking Cessation', 'Pending', GETUTCDATE(), GETUTCDATE()),
    ('Jane Smith', '+15559876543', '1975-08-22', 'Diabetes Management', 'Pending', GETUTCDATE(), GETUTCDATE());
```

### 4. Start Azure Functions

```bash
cd backend/src/CallAgent.Api
func start --port 7071
```

### 5. Run Local Harness

```bash
cd backend/src/CallAgent.LocalHarness
dotnet run
```

### Sample Session Output

```
╔════════════════════════════════════════════╗
║   Callistra Local Call Harness             ║
║   Healthcare Enrollment Simulation         ║
╚════════════════════════════════════════════╝

Enter Member ID to call: 1

📞 Initiating call to Member 1...

🤖 Agent: Are you currently smoking cigarettes?
👤 Member: yes

🤖 Agent: How many cigarettes do you smoke per day?
👤 Member: 15

🤖 Agent: Are you interested in quitting smoking?
👤 Member: yes

🤖 Agent: Would you like to schedule a consultation with our cessation specialist?
👤 Member: yes

🤖 Agent: What is the best time to reach you?
👤 Member: weekday mornings

✅ Call completed successfully!
   Session ID: 1001
   Outcome: Enrolled
```

## Key Achievements

By the end of Phase 3, we had:

✅ **Solid Database Foundation** - EF Core with SQL Server, repository pattern, unit of work
✅ **Azure Functions API** - 18 endpoints for member and call session management
✅ **Local Testing Capability** - Full call simulation without external dependencies
✅ **Question Engine** - Flexible, program-based questionnaire system
✅ **Clean Architecture** - Separation of concerns, dependency injection, testability

## Challenges and Solutions

### Challenge 1: Database Schema vs. Code Conventions

**Problem**: Legacy database with columns like `DOB`, `CreatedAt` vs. modern C# conventions
**Solution**: Entity Framework column mapping + computed properties for backward compatibility

### Challenge 2: Testing Without Real Phone Calls

**Problem**: Can't test call flows during development without incurring ACS costs
**Solution**: Local Harness that simulates the entire call lifecycle

### Challenge 3: Configuration Management

**Problem**: Different settings for local development, Azure deployment, testing
**Solution**: Strongly-typed configuration classes with IOptions pattern:

```csharp
public class CallAgentOptions
{
    public const string SectionName = "CallAgent";
    public string Environment { get; set; } = "Development";
    public bool EnableDetailedLogging { get; set; } = false;
    public int DefaultTimeoutSeconds { get; set; } = 30;
}
```

## What's Next

In Part 2, we'll tackle the most exciting (and challenging) phase: integrating with Azure Communication Services to place real phone calls. We'll cover:

- Azure Communication Services setup and configuration
- Azure Dev Tunnels for webhook handling
- Text-to-Speech integration with Azure Speech Services
- Real-world debugging of telephony issues
- The blocking challenges we're currently working through

The journey from simulated calls to real telephony brings a new set of challenges around audio codecs, webhook signatures, and cloud resource configuration. Stay tuned!

## Code Repository

The complete Callistra codebase is available on GitHub: [github.com/GitBuntu/callistra](https://github.com/GitBuntu/callistra)

---

