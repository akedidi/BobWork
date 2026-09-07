# Bob Work - IBM Bob Validation Checklist

**Purpose**: Validate IBM Bob installation and capabilities before implementation  
**Date**: 2026-08-05  
**Status**: Ready for Execution

---

## Overview

This checklist guides the validation of IBM Bob Shell capabilities. Complete each section and document findings to update the [Bob Capability Matrix](bob-capability-matrix.md).

---

## Prerequisites

- [ ] macOS 12.0+ installed
- [ ] Terminal access
- [ ] Text editor for capturing outputs

---

## Section 1: Installation & Version

### 1.1 Locate Bob Binary

```bash
# Check if Bob is in PATH
which bob

# Common locations to check
ls -la /usr/local/bin/bob
ls -la /opt/homebrew/bin/bob
ls -la ~/bin/bob
ls -la ~/.local/bin/bob
```

**Document**:
- Bob binary location: `_______________________`
- Found in PATH: ☐ Yes ☐ No

---

### 1.2 Check Version

```bash
bob --version
```

**Document**:
- Bob version: `_______________________`
- Version format: `_______________________`

**Expected**: Version 2.x or higher

---

### 1.3 View Help

```bash
bob --help
```

**Document**:
- Save complete output to: `bob-help-output.txt`
- Available options count: `_______________________`

**Key options to look for**:
- [ ] `--interactive`
- [ ] `--non-interactive`
- [ ] `--mode`
- [ ] `--input`
- [ ] `--output`
- [ ] `--version`
- [ ] `--help`

---

## Section 2: Authentication

### 2.1 Check Authentication Status

```bash
# Try to check authentication (command may vary)
bob auth status
# OR
bob --version  # May show auth status
```

**Document**:
- Authentication required: ☐ Yes ☐ No
- Currently authenticated: ☐ Yes ☐ No
- Authentication method: ☐ IBMid/SSO ☐ API Key ☐ Other: `_______`

---

### 2.2 Test Authentication (if not authenticated)

```bash
# Interactive authentication
bob auth login
# OR
bob --interactive
```

**Document**:
- Authentication method used: `_______________________`
- Browser opened: ☐ Yes ☐ No
- Authentication successful: ☐ Yes ☐ No
- Error messages (if any): `_______________________`

---

## Section 3: Execution Modes

### 3.1 List Available Modes

```bash
# Try to list modes
bob --list-modes
# OR
bob modes list
# OR check help output
```

**Document**:
- Command to list modes: `_______________________`
- Available modes:
  - [ ] ask
  - [ ] plan
  - [ ] code
  - [ ] agent
  - [ ] orchestrator
  - [ ] Other: `_______________________`

---

### 3.2 Test Interactive Mode

```bash
bob --interactive
# Then type a simple question like "What is 2+2?"
# Type "exit" to quit
```

**Document**:
- Interactive mode works: ☐ Yes ☐ No
- Prompt format: `_______________________`
- Response format: ☐ Text ☐ JSON ☐ Other: `_______`
- Can exit cleanly: ☐ Yes ☐ No

---

### 3.3 Test Non-Interactive Mode

```bash
# Create a test input file
echo "What is the capital of France?" > test-input.txt

# Run non-interactive
bob --non-interactive --input test-input.txt --output test-output.txt
# OR
bob --non-interactive < test-input.txt > test-output.txt

# Check output
cat test-output.txt
```

**Document**:
- Non-interactive mode works: ☐ Yes ☐ No
- Output format: ☐ Text ☐ JSON ☐ Other: `_______`
- Output file created: ☐ Yes ☐ No
- Response quality: ☐ Good ☐ Acceptable ☐ Poor

---

### 3.4 Test Specific Modes

**Ask Mode**:
```bash
bob --mode=ask --interactive
# Ask: "What is machine learning?"
```

**Document**:
- Ask mode available: ☐ Yes ☐ No
- Response appropriate: ☐ Yes ☐ No

**Plan Mode**:
```bash
bob --mode=plan --interactive
# Ask: "Create a plan to organize a team meeting"
```

**Document**:
- Plan mode available: ☐ Yes ☐ No
- Generates structured plan: ☐ Yes ☐ No

**Code/Agent Mode**:
```bash
bob --mode=code --interactive
# Ask: "Write a Python function to calculate factorial"
```

**Document**:
- Code/Agent mode available: ☐ Yes ☐ No
- Generates code: ☐ Yes ☐ No

---

## Section 4: File Operations

### 4.1 Test File Reading

```bash
# Create a test file
echo "This is a test file for Bob." > test-read.txt

# Ask Bob to read it
bob --interactive
# Then: "Read the file test-read.txt and summarize it"
```

**Document**:
- Can read files: ☐ Yes ☐ No
- Requires explicit path: ☐ Yes ☐ No
- Requires permission: ☐ Yes ☐ No

---

### 4.2 Test File Writing

```bash
bob --interactive
# Then: "Create a file called test-write.txt with the content 'Hello from Bob'"

# Check if file was created
ls -la test-write.txt
cat test-write.txt
```

**Document**:
- Can write files: ☐ Yes ☐ No
- Requires approval: ☐ Yes ☐ No
- Approval mechanism: `_______________________`

---

## Section 5: Output Format & Progress

### 5.1 Check Output Format

```bash
bob --interactive
# Ask a question and observe the output format
```

**Document**:
- Output format: ☐ Plain text ☐ JSON ☐ Structured ☐ Mixed
- ANSI colors used: ☐ Yes ☐ No
- Progress indicators: ☐ Yes ☐ No
- Streaming output: ☐ Yes ☐ No (batch only)

---

### 5.2 Test Long-Running Task

```bash
bob --interactive
# Ask: "Analyze this text and provide detailed insights: [paste a long paragraph]"
```

**Document**:
- Shows progress: ☐ Yes ☐ No
- Progress format: `_______________________`
- Can interrupt (Ctrl+C): ☐ Yes ☐ No
- Graceful interruption: ☐ Yes ☐ No

---

## Section 6: Skills & Custom Capabilities

### 6.1 Check Skills Directory

```bash
# Check for skills directory
ls -la ~/.bob/skills/
# OR
ls -la ~/.config/bob/skills/
```

**Document**:
- Skills directory exists: ☐ Yes ☐ No
- Skills directory location: `_______________________`
- Number of skills found: `_______________________`
- Skill file format: ☐ YAML ☐ JSON ☐ Other: `_______`

---

### 6.2 Check Custom Modes

```bash
# Check for custom modes directory
ls -la ~/.bob/modes/
# OR
ls -la ~/.config/bob/modes/
```

**Document**:
- Custom modes directory exists: ☐ Yes ☐ No
- Custom modes directory location: `_______________________`
- Number of custom modes: `_______________________`
- Mode file format: ☐ YAML ☐ JSON ☐ Other: `_______`

---

## Section 7: MCP (Model Context Protocol)

### 7.1 Check MCP Support

```bash
# Check for MCP configuration
ls -la ~/.bob/mcp/
# OR
ls -la ~/.config/bob/mcp/
# OR check help for MCP options
bob --help | grep -i mcp
```

**Document**:
- MCP supported: ☐ Yes ☐ No ☐ Unknown
- MCP config location: `_______________________`
- MCP config format: ☐ JSON ☐ YAML ☐ Other: `_______`

---

## Section 8: Error Handling

### 8.1 Test Invalid Command

```bash
bob --invalid-option
```

**Document**:
- Error message clear: ☐ Yes ☐ No
- Error message: `_______________________`
- Exit code: `_______________________`

---

### 8.2 Test Invalid Input

```bash
bob --interactive
# Type gibberish or invalid request
```

**Document**:
- Handles gracefully: ☐ Yes ☐ No
- Error message helpful: ☐ Yes ☐ No

---

## Section 9: Session & Context

### 9.1 Test Session Persistence

```bash
# Start interactive session
bob --interactive
# Ask: "My name is Alice"
# Then ask: "What is my name?"
```

**Document**:
- Remembers context: ☐ Yes ☐ No
- Context persists across messages: ☐ Yes ☐ No

---

### 9.2 Test Session Resumption

```bash
# Start session, ask a question, then exit
bob --interactive
# Ask something, then exit
# Start again
bob --interactive
# Ask: "What did we discuss last time?"
```

**Document**:
- Can resume previous session: ☐ Yes ☐ No
- Session ID mechanism: ☐ Yes ☐ No
- Session storage location: `_______________________`

---

## Section 10: Advanced Features

### 10.1 Test Approval/Permission System

```bash
bob --interactive
# Ask Bob to delete a file or run a command
```

**Document**:
- Approval system exists: ☐ Yes ☐ No
- Approval prompt format: `_______________________`
- Can approve/deny: ☐ Yes ☐ No
- Approval persists: ☐ Yes ☐ No

---

### 10.2 Test Sandbox/Security

```bash
# Check for sandbox options
bob --help | grep -i sandbox
```

**Document**:
- Sandbox supported: ☐ Yes ☐ No
- Sandbox options: `_______________________`

---

### 10.3 Test Budget/Usage Tracking

```bash
# Check for usage/budget options
bob --help | grep -i budget
bob --help | grep -i usage
```

**Document**:
- Usage tracking available: ☐ Yes ☐ No
- Budget limits available: ☐ Yes ☐ No
- How to check usage: `_______________________`

---

## Section 11: Documentation & Resources

### 11.1 Check Local Documentation

```bash
# Check for local docs
ls -la ~/.bob/docs/
man bob
bob --help
```

**Document**:
- Local docs available: ☐ Yes ☐ No
- Man page available: ☐ Yes ☐ No
- Help comprehensive: ☐ Yes ☐ No

---

### 11.2 Online Resources

**Document**:
- Official docs URL: `_______________________`
- Community forum: `_______________________`
- Support channel: `_______________________`

---

## Section 12: Summary & Recommendations

### Capability Summary

Based on validation, rate each capability:

| Capability | Status | Evidence | Notes |
|------------|--------|----------|-------|
| Interactive mode | ☐ Native ☐ Partial ☐ Unavailable | | |
| Non-interactive mode | ☐ Native ☐ Partial ☐ Unavailable | | |
| Ask mode | ☐ Native ☐ Partial ☐ Unavailable | | |
| Plan mode | ☐ Native ☐ Partial ☐ Unavailable | | |
| Code/Agent mode | ☐ Native ☐ Partial ☐ Unavailable | | |
| File reading | ☐ Native ☐ Partial ☐ Unavailable | | |
| File writing | ☐ Native ☐ Partial ☐ Unavailable | | |
| Approval system | ☐ Native ☐ Partial ☐ Unavailable | | |
| Progress reporting | ☐ Native ☐ Partial ☐ Unavailable | | |
| Session persistence | ☐ Native ☐ Partial ☐ Unavailable | | |
| Skills support | ☐ Native ☐ Partial ☐ Unavailable | | |
| Custom modes | ☐ Native ☐ Partial ☐ Unavailable | | |
| MCP support | ☐ Native ☐ Partial ☐ Unavailable | | |
| Sandbox | ☐ Native ☐ Partial ☐ Unavailable | | |
| Usage tracking | ☐ Native ☐ Partial ☐ Unavailable | | |

---

### Blockers Identified

List any critical issues that would block development:

1. `_______________________`
2. `_______________________`
3. `_______________________`

---

### Recommendations

Based on findings, recommend:

**Proceed with implementation**:
- [ ] Yes, all critical capabilities available
- [ ] Yes, with workarounds for missing features
- [ ] No, critical blockers exist

**Priority adjustments**:
- `_______________________`

**Architecture changes**:
- `_______________________`

---

## Pre-release: real Bob Shell smoke

WDIO e2e uses `fake-bob`. Before a release, also run a real Shell turn:

```bash
# Requires bob on PATH + BOB_API_KEY (or BOBSHELL_API_KEY)
pnpm mac:smoke:bob
# or: pnpm --filter macos run smoke:bob
```

CI: workflow `Smoke Bob Shell (real)` (`.github/workflows/smoke-bob-shell.yml`) on `workflow_dispatch` and `v*` tags. Needs repository secret `BOB_API_KEY`.

Optional local skip (no key / no binary): `BOB_SMOKE_SKIP_IF_NO_KEY=1 pnpm mac:smoke:bob` (exit 2).

---

## Next Steps

After completing this checklist:

1. [ ] Update [`docs/bob-capability-matrix.md`](bob-capability-matrix.md) with actual evidence
2. [ ] Document any blockers or limitations
3. [ ] Adjust architecture if needed
4. [ ] Get stakeholder approval
5. [ ] Begin Phase 2: Architecture & Foundations
6. [ ] Run `pnpm mac:smoke:bob` with a real API key before tagging

---

## Attachments

Save these files for reference:

- [ ] `bob-help-output.txt` - Complete help output
- [ ] `bob-version-output.txt` - Version information
- [ ] `bob-interactive-session.txt` - Sample interactive session
- [ ] `bob-non-interactive-test.txt` - Non-interactive test results
- [ ] `bob-config-files.zip` - Configuration files (if any)

---

**Validation Date**: `_______________________`  
**Validated By**: `_______________________`  
**Bob Version**: `_______________________`  
**macOS Version**: `_______________________`
