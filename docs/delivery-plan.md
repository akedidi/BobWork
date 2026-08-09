# Bob Work - Delivery Plan

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Draft

> **Décision de livraison 0.1.4 (9 août 2026)** — Les tâches Keychain de ce plan initial sont annulées. Le produit livré ne possède ni dépendance, ni commande, ni entitlement de Trousseau ; les secrets manuels sont volatils.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Development Phases](#development-phases)
3. [Phase Details](#phase-details)
4. [Dependencies & Blockers](#dependencies--blockers)
5. [Testing Strategy](#testing-strategy)
6. [Deployment Strategy](#deployment-strategy)
7. [Success Criteria](#success-criteria)
8. [Risk Management](#risk-management)
9. [Timeline Estimates](#timeline-estimates)

---

## Project Overview

### Objective

Build Bob Work, a native macOS application that makes IBM Bob's AI capabilities accessible to non-technical users through an intuitive graphical interface.

### Scope

**MVP Features** (Priority):
1. Native macOS application with premium UI
2. IBM Bob detection and integration
3. Project and conversation management
4. Chat and Work modes
5. **Conversational plugin builder** (highest priority)
6. Business modes (Planning, Presentation, Document, etc.)
7. Approval and permission system
8. Artifact generation (PPTX, DOCX, XLSX, PDF)
9. Security and sandboxing
10. DMG packaging

**Post-MVP** (Deferred):
- Scheduled tasks and automation
- Integration catalog
- Built-in browser
- Notification system
- Menu bar app
- Advanced orchestration

### Constraints

- Bob Shell 2.x must be installed
- No Apple Developer certificates initially (unsigned builds)
- Local-first, no cloud infrastructure
- Must handle missing Bob features gracefully

---

## Development Phases

### Phase 0: Audit & Research ✓
**Status**: In Progress  
**Duration**: 1-2 days  
**Goal**: Understand environment, validate Bob capabilities, create design documents

### Phase 1: Documentation
**Status**: Pending  
**Duration**: 1 day  
**Goal**: Complete all design documents

### Phase 2: Architecture & Foundations
**Status**: Pending  
**Duration**: 3-5 days  
**Goal**: Set up project structure, build system, core infrastructure

### Phase 3: Bob Adapter & Capability Detection
**Status**: Pending  
**Duration**: 3-4 days  
**Goal**: Create Bob integration layer, detect capabilities

### Phase 4: UI & Design System
**Status**: Pending  
**Duration**: 4-5 days  
**Goal**: Implement design system, core UI components

### Phase 5: Projects & Conversations
**Status**: Pending  
**Duration**: 3-4 days  
**Goal**: Implement project and conversation management

### Phase 6: Business Modes & Orchestration
**Status**: Pending  
**Duration**: 4-5 days  
**Goal**: Implement business modes, task orchestration

### Phase 7: Plugin System (Priority)
**Status**: Pending  
**Duration**: 5-7 days  
**Goal**: Implement conversational plugin builder

### Phase 8: Integrations & MCP
**Status**: Pending  
**Duration**: 3-4 days  
**Goal**: Basic integration framework (defer full catalog)

### Phase 9: Scheduled Tasks & Notifications
**Status**: Pending (Post-MVP)  
**Duration**: 3-4 days  
**Goal**: Task scheduling, notification system

### Phase 10: Security & Permissions
**Status**: Pending  
**Duration**: 3-4 days  
**Goal**: Implement security model, approval system

### Phase 11: Artifacts & Deliverables
**Status**: Pending  
**Duration**: 4-5 days  
**Goal**: Implement artifact generation and validation

### Phase 12: Testing & Validation
**Status**: Pending  
**Duration**: 4-5 days  
**Goal**: Comprehensive testing, bug fixes

### Phase 13: Packaging & Distribution
**Status**: Pending  
**Duration**: 2-3 days  
**Goal**: Create DMG, documentation, distribution

### Phase 14: Final Documentation & Handoff
**Status**: Pending  
**Duration**: 2 days  
**Goal**: Complete documentation, demo, handoff

**Total Estimated Duration**: 6-8 weeks for MVP

---

## Phase Details

### Phase 0: Audit & Research

**Objectives**:
- ✓ Understand project requirements
- ✓ Create product requirements document
- ✓ Create system design document
- ✓ Create Bob capability matrix
- ✓ Create security model
- ✓ Create UI specification
- ✓ Create delivery plan
- Validate Bob installation and capabilities
- Identify blockers

**Deliverables**:
- ✓ `docs/product-requirements.md`
- ✓ `docs/system-design.md`
- ✓ `docs/bob-capability-matrix.md`
- ✓ `docs/security-model.md`
- ✓ `docs/ui-specification.md`
- ✓ `docs/delivery-plan.md`
- Bob capability validation report (pending user input)

**Tasks**:
- [x] Read mission brief
- [x] Create PRD
- [x] Create system design
- [x] Create capability matrix
- [x] Create security model
- [x] Create UI spec
- [x] Create delivery plan
- [ ] Validate Bob installation
- [ ] Test Bob commands
- [ ] Document actual capabilities
- [ ] Update capability matrix

---

### Phase 1: Documentation Completion

**Objectives**:
- Finalize all design documents
- Get stakeholder approval
- Create technical specifications

**Deliverables**:
- Updated capability matrix with actual Bob data
- API specifications
- Database schema documentation
- Component specifications

**Tasks**:
- [ ] Validate Bob capabilities with actual installation
- [ ] Update capability matrix with evidence
- [ ] Document Bob command outputs
- [ ] Create API specifications
- [ ] Document database schema
- [ ] Create component specifications
- [ ] Review and approve all documents

---

### Phase 2: Architecture & Foundations

**Objectives**:
- Set up monorepo structure
- Configure Tauri 2
- Set up React + TypeScript
- Configure build system
- Set up database
- Set up Keychain integration

**Deliverables**:
- Working project structure
- Build scripts
- Development environment
- SQLite database with migrations
- Keychain integration

**Tasks**:
- [ ] Initialize monorepo (pnpm workspaces)
- [ ] Set up Tauri 2 project
- [ ] Configure React + TypeScript + Vite
- [ ] Set up Tailwind CSS
- [ ] Configure ESLint, Prettier, Clippy
- [ ] Set up SQLite with rusqlite
- [ ] Implement migration system
- [ ] Set up Keychain integration (security-framework)
- [ ] Create initial database schema
- [ ] Set up logging (tracing, log4rs)
- [ ] Create development scripts
- [ ] Test build process

**File Structure**:
```
bob-work/
├── apps/
│   └── macos/
│       ├── src/           # React frontend
│       ├── src-tauri/     # Rust backend
│       └── package.json
├── packages/
│   ├── core/              # Shared types
│   ├── ui/                # UI components
│   ├── bob-adapter/       # Bob integration
│   └── shared-types/      # TypeScript types
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

### Phase 3: Bob Adapter & Capability Detection

**Objectives**:
- Implement Bob detection
- Implement Bob execution
- Implement capability detection
- Create mock Bob adapter for testing
- Handle Bob errors gracefully

**Deliverables**:
- `BobAdapter` trait and implementation
- `BobDetector` for finding Bob binary
- `BobExecutor` for running Bob commands
- `CapabilityRegistry` for tracking features
- Mock adapter for testing
- Event parser for Bob output

**Tasks**:
- [ ] Implement Bob binary detection
- [ ] Implement version checking
- [ ] Implement authentication flow
- [ ] Implement capability detection
- [ ] Create capability registry
- [ ] Implement Bob process management
- [ ] Implement event parsing (JSON or text)
- [ ] Create mock Bob adapter
- [ ] Test with actual Bob installation
- [ ] Handle errors and edge cases
- [ ] Document limitations

**Key Files**:
- `packages/bob-adapter/src/detector.rs`
- `packages/bob-adapter/src/executor.rs`
- `packages/bob-adapter/src/parser.rs`
- `packages/bob-adapter/src/capability.rs`
- `packages/bob-adapter/src/mock.rs`

---

### Phase 4: UI & Design System

**Objectives**:
- Implement design system
- Create core UI components
- Implement main window layout
- Implement sidebar
- Implement theme system

**Deliverables**:
- Design system (colors, typography, spacing)
- Core components (Button, Input, Card, etc.)
- Main window with three-column layout
- Sidebar with navigation
- Theme switcher (light/dark)

**Tasks**:
- [ ] Set up design tokens (CSS variables)
- [ ] Create color palette
- [ ] Implement typography system
- [ ] Create core components:
  - [ ] Button
  - [ ] Input
  - [ ] Textarea
  - [ ] Select
  - [ ] Card
  - [ ] Badge
  - [ ] Avatar
  - [ ] Icon
  - [ ] Tooltip
  - [ ] Modal
  - [ ] Dropdown
- [ ] Implement main window layout
- [ ] Implement sidebar
- [ ] Implement theme system
- [ ] Test accessibility (keyboard, VoiceOver)
- [ ] Test responsive behavior

**Key Files**:
- `packages/ui/src/design-system/`
- `packages/ui/src/components/`
- `apps/macos/src/components/Layout/`
- `apps/macos/src/components/Sidebar/`

---

### Phase 5: Projects & Conversations

**Objectives**:
- Implement project CRUD
- Implement conversation CRUD
- Implement message storage
- Implement file attachment
- Implement search

**Deliverables**:
- Project management system
- Conversation management system
- Message rendering
- File attachment handling
- Search functionality

**Tasks**:
- [ ] Implement project database operations
- [ ] Implement conversation database operations
- [ ] Implement message database operations
- [ ] Create project UI (dashboard, settings)
- [ ] Create conversation UI (list, detail)
- [ ] Implement message rendering (Markdown)
- [ ] Implement file attachment
- [ ] Implement drag-and-drop
- [ ] Implement search
- [ ] Test data persistence
- [ ] Test file handling

**Key Files**:
- `src-tauri/src/services/project_service.rs`
- `src-tauri/src/services/conversation_service.rs`
- `apps/macos/src/views/ProjectView/`
- `apps/macos/src/views/ConversationView/`
- `apps/macos/src/components/MessageList/`

---

### Phase 6: Business Modes & Orchestration

**Objectives**:
- Implement mode registry
- Implement business modes
- Implement task orchestration
- Implement progress tracking

**Deliverables**:
- Mode registry and selector
- Business mode implementations
- Task orchestration engine
- Progress tracking UI

**Tasks**:
- [ ] Create mode registry
- [ ] Implement mode selector UI
- [ ] Implement Quick Chat mode
- [ ] Implement Planning mode
- [ ] Implement General Work mode
- [ ] Implement Presentation Builder mode
- [ ] Implement Document/Report mode
- [ ] Implement Spreadsheet/Analysis mode
- [ ] Implement Research mode
- [ ] Implement Automation Builder mode
- [ ] Implement Orchestrator mode
- [ ] Create task orchestration engine
- [ ] Implement progress tracking
- [ ] Test each mode

**Key Files**:
- `src-tauri/src/services/mode_service.rs`
- `src-tauri/src/services/task_service.rs`
- `src-tauri/src/services/orchestrator_service.rs`
- `apps/macos/src/components/ModeSelector/`
- `apps/macos/src/components/TaskProgress/`

---

### Phase 7: Plugin System (Priority)

**Objectives**:
- Implement conversational plugin builder
- Implement plugin manifest system
- Implement plugin installation
- Implement plugin execution
- Implement plugin sandboxing

**Deliverables**:
- Conversational plugin builder UI
- Plugin manifest schema and validation
- Plugin installation system
- Plugin execution engine
- Plugin sandbox

**Tasks**:
- [ ] Design plugin manifest schema
- [ ] Implement plugin builder conversation flow
- [ ] Implement manifest generation
- [ ] Implement plugin validation
- [ ] Implement plugin installation (transactional)
- [ ] Implement Bob config integration
- [ ] Implement plugin execution
- [ ] Implement plugin sandbox
- [ ] Create plugin library UI
- [ ] Test plugin creation end-to-end
- [ ] Test plugin execution
- [ ] Test rollback

**Key Files**:
- `src-tauri/src/services/plugin_service.rs`
- `src-tauri/src/models/plugin.rs`
- `apps/macos/src/views/PluginBuilder/`
- `apps/macos/src/views/PluginLibrary/`

**Plugin Categories**:
1. Recipe (instructions only)
2. Integration (with external APIs)
3. Executable (with code)

---

### Phase 8: Integrations & MCP

**Objectives**:
- Create integration framework
- Implement OAuth flow
- Implement MCP configuration
- Create integration catalog UI (basic)

**Deliverables**:
- Integration framework
- OAuth 2.0 flow
- MCP configuration UI
- Basic integration catalog

**Tasks**:
- [ ] Design integration architecture
- [ ] Implement OAuth 2.0 flow
- [ ] Implement token storage (Keychain)
- [ ] Implement MCP configuration
- [ ] Create integration catalog UI
- [ ] Implement integration connection flow
- [ ] Test OAuth flow
- [ ] Test MCP configuration
- [ ] Document integration creation

**Key Files**:
- `src-tauri/src/services/integration_service.rs`
- `src-tauri/src/oauth/`
- `apps/macos/src/views/IntegrationCatalog/`

**Note**: Full integration catalog deferred to post-MVP. Focus on framework and 1-2 example integrations.

---

### Phase 9: Scheduled Tasks & Notifications (Post-MVP)

**Objectives**:
- Implement task scheduler
- Implement notification system
- Implement menu bar app

**Deliverables**:
- Task scheduler
- Notification system
- Menu bar app

**Tasks**:
- [ ] Implement scheduler service
- [ ] Implement cron parsing
- [ ] Implement task queue
- [ ] Implement macOS notifications
- [ ] Implement menu bar app
- [ ] Test scheduling
- [ ] Test notifications
- [ ] Handle Mac sleep/wake

**Key Files**:
- `src-tauri/src/services/scheduler_service.rs`
- `src-tauri/src/services/notification_service.rs`

**Note**: This phase may be deferred to post-MVP depending on Bob's non-interactive capabilities.

---

### Phase 10: Security & Permissions

**Objectives**:
- Implement permission system
- Implement approval flow
- Implement sandboxing
- Implement secret management
- Implement audit logging

**Deliverables**:
- Permission system
- Approval UI
- Sandbox implementation
- Secret redaction
- Audit log

**Tasks**:
- [ ] Implement permission types
- [ ] Implement permission policies
- [ ] Implement approval request system
- [ ] Create approval card UI
- [ ] Implement sandbox for plugins
- [ ] Implement path validation
- [ ] Implement symlink validation
- [ ] Implement network policy
- [ ] Implement secret redaction
- [ ] Implement audit logging
- [ ] Test security controls
- [ ] Penetration testing

**Key Files**:
- `src-tauri/src/security/`
- `src-tauri/src/services/approval_service.rs`
- `apps/macos/src/components/ApprovalCard/`

---

### Phase 11: Artifacts & Deliverables

**Objectives**:
- Implement artifact generation
- Implement artifact validation
- Implement artifact preview
- Implement version control

**Deliverables**:
- PPTX generation
- DOCX generation
- XLSX generation
- PDF generation
- Artifact validation
- Artifact gallery

**Tasks**:
- [ ] Implement PPTX generation (python-pptx or Node.js library)
- [ ] Implement DOCX generation (docx or docx-rs)
- [ ] Implement XLSX generation (xlsx or calamine)
- [ ] Implement PDF generation (headless browser or library)
- [ ] Implement artifact validation
- [ ] Implement visual QA (render to image)
- [ ] Implement artifact preview
- [ ] Implement version control
- [ ] Create artifact gallery UI
- [ ] Test each format
- [ ] Test validation

**Key Files**:
- `src-tauri/src/services/artifact_service.rs`
- `src-tauri/src/generators/`
- `apps/macos/src/views/ArtifactGallery/`

---

### Phase 12: Testing & Validation

**Objectives**:
- Write comprehensive tests
- Fix bugs
- Optimize performance
- Validate against acceptance criteria

**Deliverables**:
- Unit tests (>70% coverage)
- Integration tests
- UI tests
- Security tests
- Performance tests
- Bug fixes

**Tasks**:
- [ ] Write unit tests (Rust)
- [ ] Write unit tests (TypeScript)
- [ ] Write integration tests
- [ ] Write UI tests (React Testing Library)
- [ ] Write security tests
- [ ] Write performance tests
- [ ] Run tests on CI
- [ ] Fix bugs
- [ ] Optimize performance
- [ ] Validate acceptance criteria
- [ ] User acceptance testing

**Test Coverage Goals**:
- Rust backend: >80%
- TypeScript frontend: >70%
- Critical paths: 100%

---

### Phase 13: Packaging & Distribution

**Objectives**:
- Create DMG
- Write installation instructions
- Prepare for signing (when certificates available)
- Create update system

**Deliverables**:
- DMG installer
- Installation guide
- Signing instructions
- Update system

**Tasks**:
- [ ] Configure Tauri bundler
- [ ] Create app icon
- [ ] Create DMG background image
- [ ] Build DMG
- [ ] Test installation on clean Mac
- [ ] Write installation guide
- [ ] Document signing process
- [ ] Document notarization process
- [ ] Set up update system (Tauri updater)
- [ ] Test update process
- [ ] Create release notes

**Key Files**:
- `src-tauri/tauri.conf.json`
- `src-tauri/icons/`
- `docs/installation.md`
- `docs/signing.md`

---

### Phase 14: Final Documentation & Handoff

**Objectives**:
- Complete all documentation
- Create demo video
- Prepare handoff materials

**Deliverables**:
- User documentation
- Developer documentation
- Demo video
- Handoff materials

**Tasks**:
- [ ] Write user guide
- [ ] Write developer guide
- [ ] Document API
- [ ] Document architecture
- [ ] Create demo video
- [ ] Create screenshots
- [ ] Write release notes
- [ ] Prepare handoff presentation
- [ ] Final review

**Documentation**:
- User Guide
- Developer Guide
- API Documentation
- Architecture Documentation
- Security Documentation
- Deployment Guide
- Troubleshooting Guide

---

## Dependencies & Blockers

### Critical Dependencies

1. **IBM Bob Installation**
   - Status: To be validated
   - Impact: Blocks all Bob integration work
   - Mitigation: Use mock adapter for development

2. **Bob Capabilities**
   - Status: Unknown
   - Impact: May require feature adjustments
   - Mitigation: Graceful degradation, clear user communication

3. **Apple Developer Certificates**
   - Status: Not available initially
   - Impact: Cannot sign or notarize builds
   - Mitigation: Provide unsigned builds, document signing process

### Potential Blockers

1. **Bob Non-Interactive Mode Limitations**
   - Risk: May not support approvals
   - Impact: Requires plan-then-execute workflow
   - Mitigation: Implement app-level orchestration

2. **Bob Session Persistence**
   - Risk: May not persist across restarts
   - Impact: Cannot resume long tasks
   - Mitigation: Store conversation history, restart with summary

3. **Bob Output Format**
   - Risk: May only provide text, not JSON
   - Impact: Difficult to parse progress
   - Mitigation: Text parsing, indeterminate progress

4. **MCP Configuration Complexity**
   - Risk: May be too technical for users
   - Impact: Integration setup difficult
   - Mitigation: Guided setup wizard

---

## Testing Strategy

### Unit Testing

**Backend (Rust)**:
- Test all services
- Test database operations
- Test security functions
- Test Bob adapter (with mock)
- Coverage: >80%

**Frontend (TypeScript)**:
- Test components
- Test hooks
- Test utilities
- Coverage: >70%

### Integration Testing

**Backend**:
- Test service interactions
- Test database transactions
- Test Bob integration (with real Bob)
- Test file operations

**Frontend**:
- Test user flows
- Test IPC communication
- Test state management

### UI Testing

**React Testing Library**:
- Test component rendering
- Test user interactions
- Test accessibility

**Manual Testing**:
- Test on different macOS versions
- Test with different screen sizes
- Test with VoiceOver
- Test keyboard navigation

### Security Testing

**Automated**:
- Path traversal tests
- Symlink tests
- Secret redaction tests
- Permission enforcement tests

**Manual**:
- Penetration testing
- Plugin security review
- Approval flow testing

### Performance Testing

**Metrics**:
- App launch time: <2s
- UI responsiveness: <100ms
- Conversation load: <500ms
- Search: <1s

**Load Testing**:
- Large conversations (1000+ messages)
- Many projects (100+)
- Large files (100MB+)

### Acceptance Testing

**Scenarios** (from PRD):
1. Installation and setup
2. Create project and chat
3. Generate deliverable (presentation)
4. Create plugin through conversation
5. Schedule task (if supported)
6. Handle Bob limitation gracefully

---

## Deployment Strategy

### Development Builds

**Frequency**: Continuous  
**Distribution**: Local only  
**Signing**: None  
**Testing**: Developer testing

### Alpha Builds

**Frequency**: Weekly  
**Distribution**: Internal team  
**Signing**: None  
**Testing**: Internal testing, bug reporting

### Beta Builds

**Frequency**: Bi-weekly  
**Distribution**: Selected users  
**Signing**: None (or ad-hoc if certificates available)  
**Testing**: User acceptance testing, feedback

### Release Builds

**Frequency**: As needed  
**Distribution**: Public  
**Signing**: Yes (when certificates available)  
**Testing**: Full test suite, acceptance criteria validated

### Update Strategy

**Mechanism**: Tauri updater  
**Frequency**: As needed  
**Process**:
1. Build new version
2. Sign update
3. Upload to release server
4. Update manifest
5. App checks for updates
6. User notified
7. Download and install

---

## Success Criteria

### MVP Success Criteria

**Functional**:
- [ ] User can install from DMG
- [ ] User can authenticate with IBM
- [ ] User can create a project
- [ ] User can have a conversation
- [ ] User can generate a deliverable (e.g., presentation)
- [ ] User can create a plugin through conversation
- [ ] User can approve/deny sensitive actions
- [ ] App handles Bob limitations gracefully

**Non-Functional**:
- [ ] App launches in <2 seconds
- [ ] UI is responsive (<100ms)
- [ ] No secrets in logs or database
- [ ] All sensitive actions require approval
- [ ] App recovers from Bob crashes
- [ ] Data persists across restarts

**User Experience**:
- [ ] Non-technical users can accomplish tasks without help
- [ ] Clear error messages, no technical jargon
- [ ] Professional appearance
- [ ] Accessible (keyboard, VoiceOver)

**Security**:
- [ ] Secrets only in Keychain
- [ ] Path validation prevents traversal
- [ ] Plugins run in sandbox
- [ ] Audit trail for all operations

### Post-MVP Success Criteria

- [ ] Scheduled tasks work reliably
- [ ] Integration catalog has 5+ integrations
- [ ] Built-in browser works for common tasks
- [ ] Notification system is reliable
- [ ] Menu bar app provides quick access

---

## Risk Management

### High-Priority Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Bob capabilities insufficient | Medium | High | Graceful degradation, clear communication |
| Bob output unparseable | Medium | High | Text parsing, indeterminate progress |
| No Apple certificates | High | Medium | Unsigned builds, document signing |
| Performance issues | Low | Medium | Profiling, optimization |
| Security vulnerabilities | Low | Critical | Security review, penetration testing |

### Medium-Priority Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Tauri bugs | Low | Medium | Report upstream, workarounds |
| SQLite corruption | Low | Medium | Backups, integrity checks |
| Keychain access issues | Low | Medium | Fallback to encrypted file |
| macOS compatibility | Low | Low | Test on multiple versions |

### Mitigation Strategies

**Bob Capabilities**:
- Validate early
- Build mock adapter
- Implement fallbacks
- Communicate limitations clearly

**Performance**:
- Profile regularly
- Optimize hot paths
- Use virtual scrolling
- Lazy load data

**Security**:
- Security review at each phase
- Penetration testing before release
- Bug bounty program (future)

**Quality**:
- Automated testing
- Code review
- User testing
- Continuous integration

---

## Timeline Estimates

### Optimistic (6 weeks)

- Phase 0-1: 3 days
- Phase 2: 3 days
- Phase 3: 3 days
- Phase 4: 4 days
- Phase 5: 3 days
- Phase 6: 4 days
- Phase 7: 5 days
- Phase 8: 3 days
- Phase 10: 3 days
- Phase 11: 4 days
- Phase 12: 4 days
- Phase 13: 2 days
- Phase 14: 2 days

**Total**: 43 days (~6 weeks)

### Realistic (8 weeks)

- Phase 0-1: 4 days
- Phase 2: 5 days
- Phase 3: 4 days
- Phase 4: 5 days
- Phase 5: 4 days
- Phase 6: 5 days
- Phase 7: 7 days
- Phase 8: 4 days
- Phase 10: 4 days
- Phase 11: 5 days
- Phase 12: 5 days
- Phase 13: 3 days
- Phase 14: 2 days

**Total**: 57 days (~8 weeks)

### Pessimistic (10 weeks)

- Phase 0-1: 5 days
- Phase 2: 7 days
- Phase 3: 5 days
- Phase 4: 7 days
- Phase 5: 5 days
- Phase 6: 7 days
- Phase 7: 10 days
- Phase 8: 5 days
- Phase 10: 5 days
- Phase 11: 7 days
- Phase 12: 7 days
- Phase 13: 4 days
- Phase 14: 3 days

**Total**: 77 days (~10 weeks)

### Assumptions

- Single developer working full-time
- Bob capabilities are sufficient
- No major blockers
- Requirements don't change significantly
- Testing is done in parallel with development

---

## Next Steps

### Immediate (This Week)

1. ✓ Complete design documentation
2. Validate Bob installation and capabilities
3. Update capability matrix with actual data
4. Get stakeholder approval on design
5. Set up development environment

### Short-Term (Next 2 Weeks)

1. Complete Phase 2 (Architecture & Foundations)
2. Complete Phase 3 (Bob Adapter)
3. Start Phase 4 (UI & Design System)

### Medium-Term (Next 4 Weeks)

1. Complete Phase 4 (UI)
2. Complete Phase 5 (Projects & Conversations)
3. Complete Phase 6 (Business Modes)
4. Start Phase 7 (Plugin System)

### Long-Term (Next 8 Weeks)

1. Complete Phase 7 (Plugin System)
2. Complete remaining phases
3. Testing and bug fixes
4. Packaging and documentation
5. Release MVP

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-05 | Bob (Plan Mode) | Initial delivery plan |
