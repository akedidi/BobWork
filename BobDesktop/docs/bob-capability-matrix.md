# Bob Work - IBM Bob Capability Matrix

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Draft - Requires Validation with Actual Bob Installation

> **Décision validée 0.1.4+ (août 2026)** — Le stockage Keychain envisagé dans cette matrice n’est pas implémenté. Bob Work utilise un **coffre local AES-256-GCM** pour la clé Bob et les jetons manuels (persistants jusqu’à effacement). Voir `keychain-security.md`.

---

## Purpose

This document maps Bob Work features to IBM Bob Shell capabilities. Each capability is classified by availability status and includes evidence, limitations, fallback strategies, and user-facing messages.

**CRITICAL**: This matrix must be validated against the actual Bob installation before implementation. Never assume a capability exists without verification.

---

## Capability Status Definitions

| Status | Description | Implementation |
|--------|-------------|----------------|
| **Native** | Fully supported by Bob Shell | Use Bob directly |
| **Adapted** | Available with workarounds | Implement adapter layer |
| **Emulated** | Simulated by Bob Work | App provides functionality |
| **Partial** | Limited functionality available | Use with clear limitations |
| **Unavailable** | Not possible with current Bob | Disable or provide alternative |
| **To Confirm** | Needs validation with IBM | Research required |

---

## Core Capabilities

### 1. Bob Detection & Installation

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Binary detection in PATH | Native | Standard shell behavior | None | Manual path selection | "Bob Shell not found. Please install or select location." |
| Version detection | Native | `bob --version` | None | None | "Bob Shell version X.Y.Z detected" |
| Compatibility check | Emulated | Compare version strings | Requires known version format | Warn user | "Bob Shell version may be incompatible. Minimum required: 2.0.0" |
| Installation guidance | Emulated | Link to IBM docs | Cannot auto-install | Open browser | "Visit bob.ibm.com to install Bob Shell" |

**Notes**:
- Bob binary location varies by installation method
- Version format must be validated
- Cannot bundle Bob without IBM permission

---

### 2. Authentication & Authorization

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| IBMid/SSO authentication | To Confirm | Mentioned in docs | Browser-based flow | None | "Sign in with your IBMid to continue" |
| API key authentication | To Confirm | For non-interactive mode | May require specific Bob version | Interactive only | "API key required for scheduled tasks" |
| Token refresh | To Confirm | Unknown mechanism | May need re-auth | Prompt user | "Your session has expired. Please sign in again." |
| Multi-account support | Unavailable | Not mentioned in docs | Single account only | Account switching requires re-auth | "Switch accounts by signing out and signing in again" |
| Team/instance selection | To Confirm | Enterprise feature | May not be available | Default instance | "Using default IBM Bob instance" |

**Notes**:
- Authentication mechanism must be validated
- API key storage in Keychain is app responsibility
- Token lifetime unknown

---

### 3. Execution Modes

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Interactive mode | Native | `bob --interactive` | Requires terminal | None | "Starting interactive session..." |
| Non-interactive mode | Native | `bob --non-interactive` | Limited feedback | Parse text output | "Running task in background..." |
| Ask mode | To Confirm | Mentioned in docs | May be version-specific | Use default mode | "Quick answer mode" |
| Plan mode | To Confirm | Mentioned in docs | May be version-specific | Use default mode | "Creating plan..." |
| Code/Agent mode | To Confirm | Mentioned in docs | May be version-specific | Use default mode | "Working on your task..." |
| Orchestrator mode | To Confirm | May not be exposed | Likely unavailable | App-level orchestration | "Bob Work will coordinate multiple steps" |
| Custom modes | To Confirm | User-defined modes | Requires mode files | None | "Using custom mode: {name}" |

**Notes**:
- Mode availability varies by Bob version
- Custom modes require file system access
- Mode capabilities may differ

---

### 4. Session Management

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Session creation | Native | Start Bob process | None | None | "Session started" |
| Session persistence | To Confirm | Unknown if supported | May lose context on restart | Store conversation history | "Session context may be limited after restart" |
| Session resumption | To Confirm | Unknown mechanism | Likely unavailable | Create new session with summary | "Starting new session with previous context" |
| Multiple sessions | Emulated | Run multiple processes | Resource intensive | Queue tasks | "Running {n} tasks simultaneously" |
| Session state export | Unavailable | Not mentioned | Cannot export | App stores history | "Conversation saved locally" |

**Notes**:
- Session persistence is critical for long tasks
- May need to implement app-level session management
- Resource limits for concurrent sessions

---

### 5. Input/Output Handling

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Text prompts | Native | Standard input | None | None | N/A |
| File attachments | To Confirm | Unknown mechanism | May need file paths | Copy to temp location | "Analyzing attached files..." |
| Structured output (JSON) | To Confirm | Unknown if supported | May only output text | Parse text | "Processing results..." |
| Streaming output | To Confirm | Unknown if supported | May be batch only | Poll for updates | "Task in progress..." |
| Progress reporting | To Confirm | Unknown mechanism | Likely unavailable | Indeterminate progress | "Working... (progress unavailable)" |
| Error reporting | Partial | stderr output | Unstructured text | Parse error messages | "Error: {parsed message}" |

**Notes**:
- JSON output would greatly simplify parsing
- Text parsing is fragile and version-dependent
- Progress reporting may require estimation

---

### 6. Tool & Action Execution

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| File reading | Native | Bob can read files | Requires permissions | None | "Reading {filename}..." |
| File writing | Native | Bob can write files | Requires permissions | None | "Creating {filename}..." |
| File deletion | Native | Bob can delete files | Requires permissions | None | "Deleting {filename}..." |
| Command execution | To Confirm | May be restricted | Security implications | Disable or sandbox | "Executing command..." |
| Web search | To Confirm | May require integration | May be unavailable | Disable feature | "Web search not available" |
| Browser control | To Confirm | Unknown if supported | Likely unavailable | Disable feature | "Browser control not available" |
| API calls | To Confirm | Via MCP or native | Depends on integrations | Disable feature | "Calling {service} API..." |

**Notes**:
- Tool availability depends on Bob configuration
- Security policies may restrict certain tools
- MCP servers extend tool capabilities

---

### 7. Approval & Permission System

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Interactive approvals | To Confirm | Unknown mechanism | May not work in non-interactive | Pre-approve or deny | "Approval required: {action}" |
| Approval policies | Emulated | App-level control | Bob may not support | App enforces | "Permission policy: {policy}" |
| Action preview | Partial | Depends on Bob output | May be limited | Show command/file | "Bob wants to: {action}" |
| Approval history | Emulated | App stores decisions | None | None | "View approval history" |
| Permission scopes | Emulated | App-level control | Bob may not support | App enforces | "Allowed for this task only" |

**Notes**:
- Critical for security
- May need plan-then-execute workflow
- App must enforce if Bob doesn't

---

### 8. Skills & Custom Capabilities

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Skill definition | To Confirm | Mentioned in docs | Format unknown | None | "Loading skill: {name}" |
| Skill installation | To Confirm | File-based | Requires file access | None | "Installing skill..." |
| Skill discovery | To Confirm | Unknown mechanism | May need manual config | App scans directory | "Detecting available skills..." |
| Skill versioning | Unavailable | Not mentioned | No version control | App manages versions | "Skill version: {version}" |
| Skill marketplace | Unavailable | Not mentioned | No official marketplace | Local plugins only | "Install custom plugins" |

**Notes**:
- Skills extend Bob capabilities
- File format must be validated
- App can manage skill lifecycle

---

### 9. MCP (Model Context Protocol) Integration

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| MCP server support | To Confirm | Mentioned in docs | Configuration required | None | "MCP server: {name}" |
| MCP server installation | To Confirm | Unknown mechanism | May be manual | Guided setup | "Configure MCP server..." |
| MCP tool discovery | To Confirm | Unknown mechanism | May be manual | None | "Available tools: {list}" |
| MCP authentication | To Confirm | Unknown mechanism | May be complex | Store in Keychain | "Authenticate with {service}" |
| Custom MCP servers | To Confirm | User-defined | Requires development | None | "Custom MCP server" |

**Notes**:
- MCP enables external integrations
- Configuration complexity varies
- Security implications for custom servers

---

### 10. Memory & Context Management

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Conversation memory | To Confirm | Unknown mechanism | May be limited | App stores history | "Remembering conversation..." |
| Long-term memory | To Confirm | Unknown if supported | Likely unavailable | App-level memory | "Saved to project memory" |
| Memory search | Unavailable | Not mentioned | Not available | App implements | "Searching memory..." |
| Memory export | Unavailable | Not mentioned | Not available | Export conversations | "Export conversation history" |
| Selective forgetting | Unavailable | Not mentioned | Not available | Delete conversations | "Clear memory" |

**Notes**:
- Memory is critical for context
- App may need to manage memory
- Privacy implications

---

### 11. Orchestration & Multi-Step Tasks

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Task decomposition | To Confirm | Orchestrator mode | May not be exposed | App decomposes | "Breaking down task into steps..." |
| Dependency management | To Confirm | Unknown if supported | Likely unavailable | App manages | "Step 2 depends on step 1" |
| Parallel execution | To Confirm | Unknown if supported | Likely unavailable | Sequential only | "Running steps in sequence" |
| Sub-agent spawning | To Confirm | Unknown if supported | Likely unavailable | Single agent | "Using single agent" |
| Step validation | Emulated | App-level control | None | None | "Validating step results..." |
| Rollback on failure | Unavailable | Not mentioned | Not available | Manual retry | "Step failed. Retry?" |

**Notes**:
- Orchestration is complex
- App may need to implement
- Critical for Work mode

---

### 12. Artifact Generation

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Text generation | Native | Core capability | None | None | "Generating text..." |
| Code generation | Native | Core capability | None | None | "Writing code..." |
| Markdown generation | Native | Core capability | None | None | "Creating document..." |
| PPTX generation | Emulated | App uses library | Bob doesn't generate | App generates | "Creating presentation..." |
| DOCX generation | Emulated | App uses library | Bob doesn't generate | App generates | "Creating document..." |
| XLSX generation | Emulated | App uses library | Bob doesn't generate | App generates | "Creating spreadsheet..." |
| PDF generation | Emulated | App uses library | Bob doesn't generate | App generates | "Creating PDF..." |
| Image generation | To Confirm | May require integration | Depends on model | Disable feature | "Image generation not available" |
| Web app generation | Partial | Bob generates code | No hosting | Local preview only | "Creating web app..." |

**Notes**:
- Bob generates content, app formats
- Office formats require libraries
- Validation is app responsibility

---

### 13. Scheduling & Automation

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Scheduled execution | Emulated | App implements | Bob doesn't schedule | App scheduler | "Task scheduled for {time}" |
| Cron expressions | Emulated | App parses | None | None | "Runs every Monday at 9 AM" |
| Event triggers | Unavailable | Not mentioned | Not available | Manual triggers only | "Trigger manually" |
| Webhook support | Unavailable | Not mentioned | Not available | Disable feature | "Webhooks not available" |
| Retry policies | Emulated | App implements | None | None | "Will retry {n} times" |
| Offline handling | Emulated | App detects | Bob requires online | Queue for later | "Mac was offline. Run now?" |

**Notes**:
- Scheduling is app responsibility
- Requires API key for non-interactive
- Mac must be awake

---

### 14. Monitoring & Diagnostics

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Usage tracking | To Confirm | Unknown if exposed | May be unavailable | Estimate from time | "Estimated usage: {tokens}" |
| Budget limits | To Confirm | Unknown if exposed | May be unavailable | Time limits only | "Budget: {amount}" |
| Performance metrics | Unavailable | Not mentioned | Not available | Measure time only | "Completed in {time}" |
| Error diagnostics | Partial | stderr output | Unstructured | Parse errors | "Error details: {message}" |
| Audit logs | Emulated | App logs | None | None | "View activity log" |

**Notes**:
- Monitoring helps users understand usage
- Budget tracking may be unavailable
- App should log all operations

---

### 15. Security & Sandboxing

| Feature | Status | Evidence | Limitations | Fallback | User Message |
|---------|--------|----------|-------------|----------|--------------|
| Sandboxed execution | To Confirm | Mentioned in docs | Configuration required | Disable or warn | "Running in sandbox" |
| File access control | To Confirm | Unknown mechanism | May be limited | App enforces | "Access limited to project files" |
| Network restrictions | To Confirm | Unknown mechanism | May be limited | App monitors | "Network access: {allowed/denied}" |
| Command allowlisting | To Confirm | Unknown mechanism | May be unavailable | App enforces | "Command not allowed" |
| Secret protection | Emulated | App responsibility | Bob may log secrets | App redacts | "Secrets protected" |

**Notes**:
- Security is critical
- App must enforce if Bob doesn't
- Never trust Bob with secrets directly

---

## Feature-to-Capability Mapping

### Bob Work Feature: Quick Chat

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Ask mode | To Confirm | Use default mode |
| Text prompts | Native | Feature blocked |
| Streaming output | To Confirm | Show final result only |

**Verdict**: Implementable with degraded experience if Ask mode unavailable.

---

### Bob Work Feature: Planning Mode

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Plan mode | To Confirm | Use default mode with planning prompt |
| Structured output | To Confirm | Parse text output |
| Approval system | To Confirm | App-level approval |

**Verdict**: Implementable with workarounds.

---

### Bob Work Feature: Work Mode (Long Tasks)

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Non-interactive mode | Native | Feature blocked |
| Progress reporting | To Confirm | Indeterminate progress |
| Session persistence | To Confirm | Cannot resume after crash |
| Approval system | To Confirm | Pre-approve or plan-then-execute |

**Verdict**: Implementable but may require plan-then-execute workflow.

---

### Bob Work Feature: Conversational Plugin Builder

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Skill definition | To Confirm | Cannot create skills |
| Custom modes | To Confirm | Cannot create modes |
| File system access | Native | Feature blocked |
| MCP configuration | To Confirm | Cannot create MCP plugins |

**Verdict**: Implementable for recipes and skills. MCP plugins depend on Bob support.

---

### Bob Work Feature: Presentation Builder

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Text generation | Native | Feature blocked |
| File writing | Native | Feature blocked |
| PPTX generation | Emulated | App generates |

**Verdict**: Fully implementable (app generates PPTX from Bob's content).

---

### Bob Work Feature: Orchestrator

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Orchestrator mode | To Confirm | App implements orchestration |
| Task decomposition | To Confirm | App decomposes |
| Parallel execution | To Confirm | Sequential only |
| Sub-agents | To Confirm | Single agent |

**Verdict**: Implementable with app-level orchestration if Bob doesn't provide.

---

### Bob Work Feature: Scheduled Tasks

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Non-interactive mode | Native | Feature blocked |
| API key auth | To Confirm | Cannot run unattended |
| Scheduling | Emulated | App implements |

**Verdict**: Implementable if API key auth is available.

---

### Bob Work Feature: Integrations (Slack, Google, etc.)

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| MCP support | To Confirm | Cannot use MCP integrations |
| API calls | To Confirm | App makes API calls directly |
| OAuth flow | Emulated | App handles OAuth |

**Verdict**: Implementable with app-level integration if MCP unavailable.

---

### Bob Work Feature: Built-in Browser

| Required Capability | Status | Impact if Unavailable |
|---------------------|--------|----------------------|
| Browser control | To Confirm | Feature unavailable |
| Screenshot capture | Emulated | App captures |
| Web scraping | To Confirm | App scrapes |

**Verdict**: Likely unavailable in Bob. App can provide read-only browser or external browser.

---

## Validation Checklist

Before implementation, validate these capabilities with actual Bob installation:

- [ ] Run `bob --version` and record version
- [ ] Run `bob --help` and record available options
- [ ] Test `bob --interactive` and observe behavior
- [ ] Test `bob --non-interactive` with simple prompt
- [ ] Check for `~/.bob/` directory and contents
- [ ] List available modes: `bob --list-modes` (if supported)
- [ ] Check for skills directory: `~/.bob/skills/`
- [ ] Check for custom modes: `~/.bob/modes/`
- [ ] Test authentication flow
- [ ] Test file reading capability
- [ ] Test file writing capability
- [ ] Test approval mechanism (if any)
- [ ] Check for MCP configuration
- [ ] Test error handling
- [ ] Test session interruption and recovery
- [ ] Measure output format (JSON vs text)
- [ ] Test progress reporting (if any)
- [ ] Check for usage/budget API
- [ ] Test sandbox support (if any)
- [ ] Document all findings

---

## Risk Assessment

### High Risk (Feature Blockers)

1. **Non-interactive mode unavailable**: Cannot run background tasks
   - **Mitigation**: Require user to keep app open, use interactive mode
   
2. **No approval mechanism**: Cannot safely execute sensitive actions
   - **Mitigation**: Implement app-level approval, plan-then-execute workflow

3. **No API key auth**: Cannot run scheduled tasks
   - **Mitigation**: Disable scheduling, interactive only

4. **No session persistence**: Cannot resume after crash
   - **Mitigation**: Store conversation history, restart with summary

### Medium Risk (Degraded Experience)

1. **No structured output**: Difficult to parse results
   - **Mitigation**: Parse text output, use indeterminate progress

2. **No progress reporting**: Cannot show live progress
   - **Mitigation**: Show indeterminate progress, estimate from time

3. **No Orchestrator mode**: Cannot decompose complex tasks
   - **Mitigation**: Implement app-level orchestration

4. **No MCP support**: Cannot use external integrations
   - **Mitigation**: Implement app-level integrations

### Low Risk (Nice to Have)

1. **No browser control**: Cannot automate web tasks
   - **Mitigation**: Disable feature, provide read-only browser

2. **No image generation**: Cannot create images
   - **Mitigation**: Disable feature, use external tools

3. **No usage API**: Cannot show accurate usage
   - **Mitigation**: Estimate from time, show warnings

---

## Recommendations

### Phase 1: Core Validation
1. Install Bob Shell 2.x
2. Run validation checklist
3. Document actual capabilities
4. Update this matrix with evidence
5. Identify blockers

### Phase 2: Adapter Design
1. Design BobAdapter interface
2. Implement capability detection
3. Create fallback strategies
4. Build mock adapter for testing

### Phase 3: Feature Prioritization
1. Classify features by capability requirements
2. Prioritize features with Native/Adapted capabilities
3. Defer features requiring Unavailable capabilities
4. Plan workarounds for Partial capabilities

### Phase 4: User Communication
1. Create capability status UI
2. Show clear messages for limitations
3. Provide alternatives when possible
4. Never claim unavailable features work

---

## Open Questions for IBM

1. Does Bob 2.x provide structured JSON output, or only text?
2. Can Bob pause for approval in non-interactive mode?
3. Is there an API for querying usage and budget?
4. How does session persistence work across restarts?
5. Is the Orchestrator mode exposed in Bob 2.x?
6. What is the format for skill and mode definitions?
7. How does MCP server configuration work?
8. Can Bob run in a sandbox with restricted permissions?
9. Is there a webhook or event system for integrations?
10. What authentication methods are supported for automation?

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-05 | Bob (Plan Mode) | Initial capability matrix (pre-validation) |

---

## Next Steps

1. **User provides Bob information**: Version, help output, capabilities
2. **Validate matrix**: Test each capability with actual Bob
3. **Update status**: Change "To Confirm" to actual status with evidence
4. **Design adapters**: Create abstraction layer for each capability
5. **Implement fallbacks**: Build workarounds for unavailable features
6. **Document limitations**: Create user-facing capability status page
