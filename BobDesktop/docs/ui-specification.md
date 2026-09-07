# Bob Work - UI Specification

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Draft

---

## Table of Contents

1. [Design System](#design-system)
2. [Main Window](#main-window)
3. [Sidebar](#sidebar)
4. [Home View](#home-view)
5. [Chat & Work Views](#chat--work-views)
6. [Composer](#composer)
7. [Inspector Panel](#inspector-panel)
8. [Project Views](#project-views)
9. [Plugin Builder](#plugin-builder)
10. [Settings](#settings)
11. [Approval Cards](#approval-cards)
12. [Notifications](#notifications)
13. [Accessibility](#accessibility)
14. [Responsive Behavior](#responsive-behavior)

---

## Design System

### Visual Identity

**Principles**:
- Original, not a ChatGPT copy
- Professional and premium
- Clean and uncluttered
- Functional over decorative
- macOS-native feel

### Typography

**Font Family**:
- Primary: SF Pro (system font)
- Monospace: SF Mono (for code)
- Fallback: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto

**Type Scale**:
```css
--text-xs: 11px;    /* Captions, labels */
--text-sm: 13px;    /* Body small, secondary */
--text-base: 15px;  /* Body text */
--text-lg: 17px;    /* Emphasized text */
--text-xl: 20px;    /* Headings */
--text-2xl: 24px;   /* Page titles */
--text-3xl: 30px;   /* Hero text */
```

**Font Weights**:
```css
--font-regular: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

**Line Heights**:
```css
--leading-tight: 1.25;
--leading-normal: 1.5;
--leading-relaxed: 1.75;
```

### Color Palette

**Light Theme**:
```css
/* Backgrounds */
--bg-primary: #F5F5F7;        /* Main background - warm light gray */
--bg-secondary: #FFFFFF;      /* Cards, panels */
--bg-tertiary: #FAFAFA;       /* Hover states */
--bg-elevated: #FFFFFF;       /* Modals, popovers */

/* Surfaces */
--surface-1: #FFFFFF;         /* Primary surface */
--surface-2: #F9F9F9;         /* Secondary surface */
--surface-3: #F5F5F5;         /* Tertiary surface */

/* Text */
--text-primary: #1D1D1F;      /* Primary text */
--text-secondary: #6E6E73;    /* Secondary text */
--text-tertiary: #86868B;     /* Tertiary text, disabled */
--text-inverse: #FFFFFF;      /* Text on dark backgrounds */

/* Borders */
--border-light: #E5E5E7;      /* Light borders */
--border-medium: #D2D2D7;     /* Medium borders */
--border-strong: #A1A1A6;     /* Strong borders */

/* Accent Colors */
--accent-primary: #2563EB;    /* Indigo - primary actions */
--accent-primary-hover: #1D4ED8;
--accent-primary-active: #1E40AF;

--accent-secondary: #0891B2;  /* Turquoise - secondary actions */
--accent-secondary-hover: #0E7490;
--accent-secondary-active: #155E75;

/* Semantic Colors */
--success: #059669;           /* Green - success states */
--success-bg: #D1FAE5;
--success-border: #6EE7B7;

--warning: #D97706;           /* Amber - warnings */
--warning-bg: #FEF3C7;
--warning-border: #FCD34D;

--error: #DC2626;             /* Red - errors */
--error-bg: #FEE2E2;
--error-border: #FCA5A5;

--info: #2563EB;              /* Blue - info */
--info-bg: #DBEAFE;
--info-border: #93C5FD;

/* Risk Levels */
--risk-low: #059669;
--risk-medium: #D97706;
--risk-high: #EA580C;
--risk-critical: #DC2626;
```

**Dark Theme**:
```css
/* Backgrounds */
--bg-primary: #1C1C1E;        /* Main background - graphite with blue tint */
--bg-secondary: #2C2C2E;      /* Cards, panels */
--bg-tertiary: #3A3A3C;       /* Hover states */
--bg-elevated: #2C2C2E;       /* Modals, popovers */

/* Surfaces */
--surface-1: #2C2C2E;
--surface-2: #3A3A3C;
--surface-3: #48484A;

/* Text */
--text-primary: #F5F5F7;
--text-secondary: #AEAEB2;
--text-tertiary: #8E8E93;
--text-inverse: #1D1D1F;

/* Borders */
--border-light: #38383A;
--border-medium: #48484A;
--border-strong: #636366;

/* Accent Colors (adjusted for dark mode) */
--accent-primary: #3B82F6;
--accent-primary-hover: #2563EB;
--accent-primary-active: #1D4ED8;

--accent-secondary: #06B6D4;
--accent-secondary-hover: #0891B2;
--accent-secondary-active: #0E7490;

/* Semantic Colors (adjusted) */
--success: #10B981;
--success-bg: #064E3B;
--success-border: #059669;

--warning: #F59E0B;
--warning-bg: #78350F;
--warning-border: #D97706;

--error: #EF4444;
--error-bg: #7F1D1D;
--error-border: #DC2626;

--info: #3B82F6;
--info-bg: #1E3A8A;
--info-border: #2563EB;
```

### Spacing

**8-Point Grid System**:
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
```

### Border Radius

```css
--radius-sm: 6px;    /* Small elements */
--radius-md: 8px;    /* Buttons, inputs */
--radius-lg: 12px;   /* Cards, panels */
--radius-xl: 16px;   /* Large cards */
--radius-full: 9999px; /* Pills, avatars */
```

### Shadows

```css
/* Light Theme */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1);

/* Dark Theme */
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
```

### Icons

**Source**: Lucide React (open-source, SF Symbols-like)

**Sizes**:
```css
--icon-xs: 12px;
--icon-sm: 16px;
--icon-md: 20px;
--icon-lg: 24px;
--icon-xl: 32px;
```

**Common Icons**:
- Home: `Home`
- Chat: `MessageSquare`
- Work: `Briefcase`
- Project: `Folder`
- Task: `CheckSquare`
- Schedule: `Calendar`
- Plugin: `Puzzle`
- Integration: `Link`
- Settings: `Settings`
- Search: `Search`
- Add: `Plus`
- Close: `X`
- Menu: `Menu`
- More: `MoreHorizontal`
- Edit: `Edit`
- Delete: `Trash2`
- Download: `Download`
- Upload: `Upload`
- File: `File`
- Image: `Image`
- Code: `Code`
- Terminal: `Terminal`
- Globe: `Globe`
- Lock: `Lock`
- Unlock: `Unlock`
- Eye: `Eye`
- EyeOff: `EyeOff`
- Check: `Check`
- Alert: `AlertCircle`
- Info: `Info`
- Warning: `AlertTriangle`
- Error: `XCircle`

---

## Main Window

### Dimensions

**Minimum Size**:
- Width: 980px
- Height: 680px

**Default Size**:
- Width: 1280px
- Height: 800px

**Maximum Size**: No limit (respects screen size)

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Title Bar (macOS native, integrated)                       │
├──────────┬──────────────────────────────────┬───────────────┤
│          │                                  │               │
│ Sidebar  │      Main Content Area          │   Inspector   │
│ (260px)  │         (flexible)               │   (340px)     │
│          │                                  │   (optional)  │
│          │                                  │               │
│          │                                  │               │
│          │                                  │               │
│          │                                  │               │
│          │                                  │               │
└──────────┴──────────────────────────────────┴───────────────┘
```

**Resizable Elements**:
- Sidebar: 200px - 400px
- Inspector: 280px - 500px
- Main content: Flexible (fills remaining space)

**Collapsible Elements**:
- Sidebar: Can be hidden (Cmd+B)
- Inspector: Can be hidden (Cmd+I)

### Title Bar

**macOS Integrated Title Bar**:
- Traffic lights (close, minimize, maximize) on left
- Title centered (or hidden for more space)
- Drag area for window movement
- Transparent background with blur effect

**Custom Controls** (if needed):
- Search (Cmd+K)
- New Chat (Cmd+N)
- Account menu

---

## Sidebar

### Structure

```
┌─────────────────────────┐
│  [Profile/Space]  [▼]   │ ← Header
├─────────────────────────┤
│  [+ New]                │ ← Primary Action
├─────────────────────────┤
│  🔍 Search...           │ ← Search
├─────────────────────────┤
│  🏠 Home                │ ← Navigation
│  💬 New Chat            │
│  📁 Projects            │
│  ✓ Tasks                │
│  📅 Scheduled           │
│  🧩 Plugins             │
│  🔗 Integrations        │
├─────────────────────────┤
│  Recent                 │ ← Sections
│  • Conversation 1       │
│  • Conversation 2       │
│                         │
│  Pinned                 │
│  📌 Important Chat      │
│                         │
│  Projects               │
│  📁 Project Alpha       │
│  📁 Project Beta        │
├─────────────────────────┤
│  ⚡ Bob Ready           │ ← Footer
│  👤 Account             │
│  ⚙️ Settings            │
└─────────────────────────┘
```

### Header

**Profile/Space Selector**:
- Avatar or initials
- Name
- Dropdown for future multi-space support

**Styling**:
- Height: 56px
- Padding: 12px
- Background: Transparent
- Border-bottom: 1px solid border-light

### Primary Action Button

**"New" Button**:
- Full width
- Height: 40px
- Accent color
- Icon: Plus
- Dropdown menu:
  - New Chat
  - New Project
  - New Plugin
  - Schedule Task

### Search

**Global Search**:
- Input field
- Icon: Search
- Placeholder: "Search conversations, projects..."
- Keyboard shortcut: Cmd+K
- Opens command palette

### Navigation

**Items**:
- Home
- New Chat
- Projects
- Tasks
- Scheduled
- Plugins
- Integrations

**Styling**:
- Height: 36px
- Padding: 8px 12px
- Border-radius: 6px
- Hover: bg-tertiary
- Active: accent-primary with white text
- Icon + Text

### Sections

**Recent Conversations**:
- Last 10 conversations
- Sorted by date
- Truncated titles
- Hover shows full title

**Pinned Conversations**:
- User-pinned items
- Always visible
- Pin icon

**Projects**:
- All projects
- Expandable to show conversations
- Project icon/color

**Styling**:
- Section header: text-sm, text-secondary, uppercase, font-semibold
- Items: text-base, text-primary
- Indent: 12px for nested items

### Context Menu

**Right-click on conversation/project**:
- Rename
- Pin/Unpin
- Move to Project
- Duplicate
- Export
- Archive
- Delete

### Footer

**Bob Status**:
- Icon: Lightning bolt
- Text: "Bob Ready" / "Bob Offline" / "Bob Busy"
- Color: success / error / warning
- Click to show details

**Account**:
- User avatar
- Click to show menu:
  - Account Settings
  - Usage & Billing
  - Sign Out

**Settings**:
- Gear icon
- Opens settings window

---

## Home View

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│  What would you like to accomplish?                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [Large text input]                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  Quick Start                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Create   │ │ Analyze  │ │ Write    │ │ Automate │      │
│  │ Present. │ │ Files    │ │ Report   │ │ Task     │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                               │
│  Recent Projects                                              │
│  ┌──────────────────┐ ┌──────────────────┐                 │
│  │ Project Alpha    │ │ Project Beta     │                 │
│  │ 3 conversations  │ │ 5 conversations  │                 │
│  └──────────────────┘ └──────────────────┘                 │
│                                                               │
│  Active Tasks                                                 │
│  • Analyzing sales data... (45%)                             │
│  • Creating presentation... (waiting for approval)           │
│                                                               │
│  Pending Approvals                                            │
│  ⚠️ Plugin wants to write to file.csv                        │
│                                                               │
│  Upcoming Scheduled                                           │
│  📅 Monday 9:00 AM - Weekly sales report                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Main Prompt

**Large Text Input**:
- Height: 120px
- Placeholder: "What would you like to accomplish?"
- Auto-focus on load
- Enter to submit
- Shift+Enter for new line

### Quick Start Cards

**Grid Layout**:
- 4 columns on large screens
- 2 columns on medium screens
- 1 column on small screens

**Card Design**:
- Width: Flexible
- Height: 120px
- Border-radius: 12px
- Background: surface-1
- Border: 1px solid border-light
- Hover: Lift with shadow-md
- Icon at top
- Title below
- Subtitle (optional)

**Cards**:
1. Create Presentation
2. Analyze Files
3. Write Report
4. Automate Task
5. Organize Project
6. Research Topic
7. Create Plugin
8. Orchestrate Process

### Recent Projects

**Card Grid**:
- 2-3 columns
- Card shows:
  - Project name
  - Project icon/color
  - Number of conversations
  - Last activity
  - Quick actions (hover)

### Active Tasks

**List View**:
- Task name
- Progress bar (if available)
- Status (running, waiting, etc.)
- Click to view details

### Pending Approvals

**Alert Cards**:
- Warning icon
- Brief description
- "Review" button
- Risk level indicator

### Upcoming Scheduled

**List View**:
- Date/time
- Task name
- Next run indicator
- Quick actions (run now, edit, disable)

---

## Chat & Work Views

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Chat] [Work]  Conversation Title            [⋯]           │ ← Header
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [Message 1 - User]                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ User message content...                              │   │
│  │ 📎 attachment.pdf                                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  [Message 2 - Assistant]                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Assistant response with markdown...                  │   │
│  │                                                       │   │
│  │ ```python                                            │   │
│  │ def hello():                                         │   │
│  │     print("Hello")                                   │   │
│  │ ```                                                  │   │
│  │                                                       │   │
│  │ 📊 Created: presentation.pptx                        │   │
│  │ 🔧 Used tools: file_write, pptx_generate            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  [Message 3 - In Progress]                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⏳ Analyzing files...                                │   │
│  │ ▓▓▓▓▓▓▓▓░░░░░░░░ 45%                                │   │
│  │ Step 2 of 5: Reading data.csv                        │   │
│  │ [Stop] [Pause]                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  [Composer]                                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Type a message...                                    │   │
│  │                                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│  [📎] [@] [/] [Mode: General] [Project: None]  [Send]      │
└─────────────────────────────────────────────────────────────┘
```

### Header

**Mode Toggle**:
- Segmented control
- [Chat] [Work]
- Chat: Quick, no long tasks
- Work: Long tasks, deliverables

**Conversation Title**:
- Editable (click to edit)
- Auto-generated from first message
- Truncated with ellipsis

**Actions Menu** (⋯):
- Rename
- Pin/Unpin
- Move to Project
- Export
- Archive
- Delete

### Message List

**Auto-scroll**:
- Scroll to bottom on new message
- Show "New messages" indicator if scrolled up
- Smooth scroll animation

**Message Types**:
1. User message
2. Assistant message
3. System message (info, error)
4. In-progress message
5. Approval request

### User Message

**Layout**:
- Align: Right
- Background: accent-primary
- Text color: white
- Border-radius: 12px (rounded on left, square on right)
- Max-width: 70%
- Padding: 12px 16px

**Content**:
- Text (markdown)
- Attachments (chips below text)
- Timestamp (hover)

### Assistant Message

**Layout**:
- Align: Left
- Background: surface-1
- Text color: text-primary
- Border-radius: 12px (rounded on right, square on left)
- Max-width: 80%
- Padding: 16px

**Content**:
- Markdown rendering
- Code blocks with syntax highlighting
- Tables
- Images
- Attachments
- Sources (expandable)
- Tools used (expandable)
- Artifacts (cards)
- Timestamp

**Markdown Rendering**:
- Headings: Bold, larger text
- Lists: Bullets, numbers
- Code inline: Monospace, bg-tertiary
- Code blocks: Syntax highlighting, copy button
- Links: Underline, accent color
- Blockquotes: Left border, italic
- Tables: Bordered, striped rows

### In-Progress Message

**Layout**:
- Same as assistant message
- Animated border or glow

**Content**:
- Status text
- Progress bar (if available)
- Current step
- Sub-tasks (expandable)
- Tools being used
- Elapsed time
- Actions: Stop, Pause (if available)

**Progress Bar**:
- Determinate: 0-100%
- Indeterminate: Animated stripes
- Color: accent-primary

### Approval Request

**Layout**:
- Prominent card
- Warning color border
- Icon: Alert triangle

**Content**:
- Clear description
- Risk level badge
- Details (expandable):
  - Command/action
  - Files affected
  - Data accessed
  - Network destination
- Actions:
  - Deny (red)
  - Modify (blue)
  - Allow Once (green)
  - Allow for Task (green)
  - Always Allow (yellow, with warning)

---

## Composer

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Type a message...                                    │   │
│  │                                                       │   │
│  │                                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│  [📎] [@] [/] [Mode ▼] [Project ▼] [Schedule] [⚙️]  [Send] │
└─────────────────────────────────────────────────────────────┘
```

### Text Input

**Multi-line Text Area**:
- Min-height: 60px
- Max-height: 300px
- Auto-expand as user types
- Placeholder: "Type a message..." or "What would you like to accomplish?"
- Font: text-base
- Padding: 12px

**Keyboard Shortcuts**:
- Enter: Send (if not empty)
- Shift+Enter: New line
- Cmd+K: Open command palette
- Escape: Clear input

### Attachment Button (📎)

**Click to**:
- Open file picker
- Or show menu:
  - Choose Files
  - Choose Folder
  - Take Screenshot (if authorized)

**Attached Files**:
- Show as chips below input
- File name
- File size
- Remove button (X)

### Mention Button (@)

**Click to**:
- Show integration picker
- Select integration to query
- Insert @integration in text

**Available Integrations**:
- Google Drive
- Slack
- GitHub
- etc.

### Command Button (/)

**Click to**:
- Show command palette
- Quick actions:
  - /plan - Create a plan
  - /present - Create presentation
  - /analyze - Analyze files
  - /research - Research topic
  - /plugin - Create plugin
  - /schedule - Schedule task

### Mode Selector

**Dropdown**:
- Current mode displayed
- Click to show menu:
  - Quick Chat
  - Planning
  - General Work
  - Presentation
  - Document
  - Spreadsheet
  - Research
  - Website/App
  - Automation
  - Orchestrator
  - Plugin Creator
  - (Custom modes)

### Project Selector

**Dropdown**:
- Current project or "None"
- Click to show menu:
  - None (global)
  - Project Alpha
  - Project Beta
  - + New Project

### Schedule Button

**Click to**:
- Show schedule dialog
- Set date/time
- Set recurrence
- Set policy

### Settings Button (⚙️)

**Click to**:
- Show composer settings:
  - Permission policy
  - Budget limit
  - Timeout
  - Sandbox

### Send Button

**States**:
- Disabled: Gray, if input empty
- Enabled: Accent color
- Sending: Spinner
- Stop: Red, if task running

**Icon**:
- Send: Arrow up
- Stop: Square

---

## Inspector Panel

### Tabs

**Context-Dependent Tabs**:
- Plan (for Work mode)
- Progress (for active tasks)
- Sources (for conversations with sources)
- Files (for projects)
- Diff (for file changes)
- Artifact (for deliverables)
- Browser (future)
- Plugin (for plugin details)
- Permissions (for approval requests)
- History (for execution history)

### Plan Tab

**Content**:
- Task objective
- Steps (numbered list)
- Dependencies (if any)
- Estimated time
- Required permissions
- Edit button

### Progress Tab

**Content**:
- Overall progress bar
- Current step
- Sub-tasks (tree view)
- Elapsed time
- Estimated remaining time
- Logs (expandable)

### Sources Tab

**Content**:
- List of sources
- File name/URL
- Excerpt
- Click to view full content

### Files Tab

**Content**:
- File tree
- File name
- File size
- Last modified
- Actions: Open, Download

### Diff Tab

**Content**:
- Side-by-side or unified diff
- Syntax highlighting
- Line numbers
- Accept/Reject changes

### Artifact Tab

**Content**:
- Artifact preview
- Artifact metadata
- Version history
- Actions: Download, Open, Regenerate

---

## Project Views

### Project Dashboard

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  Project Alpha                                    [⋯]        │
│  Marketing campaign for Q4 launch                            │
├─────────────────────────────────────────────────────────────┤
│  [Overview] [Chats] [Tasks] [Sources] [Deliverables] [...]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Overview Tab Content                                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Overview Tab

**Sections**:
- Project description
- Recent activity
- Active tasks
- Recent deliverables
- Team members (future)
- Quick actions

### Chats Tab

**List of Conversations**:
- Conversation title
- Last message preview
- Date
- Click to open

### Tasks Tab

**Task List**:
- Task name
- Status
- Progress
- Date
- Click to view details

### Sources Tab

**File/Source List**:
- File name
- Type
- Size
- Date added
- Actions

### Deliverables Tab

**Artifact Gallery**:
- Grid or list view
- Thumbnail preview
- Artifact name
- Type
- Date created
- Actions

---

## Plugin Builder

### Conversational Interface

**Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  Create a Plugin                                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [Assistant]                                                  │
│  Let's create a plugin together. What would you like         │
│  your plugin to do?                                          │
│                                                               │
│  [User]                                                       │
│  I want a plugin that analyzes sales data every Monday       │
│  and creates a presentation.                                 │
│                                                               │
│  [Assistant]                                                  │
│  Great! A few questions:                                     │
│  1. Where are the sales files located?                       │
│  2. What format are they in?                                 │
│  3. Who should receive the presentation?                     │
│  4. Should I ask before sending?                             │
│                                                               │
│  [User]                                                       │
│  ...                                                          │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│  [Composer]                                                   │
└─────────────────────────────────────────────────────────────┘
```

### Plugin Preview

**After Requirements Gathered**:
```
┌─────────────────────────────────────────────────────────────┐
│  Plugin Preview                                              │
├─────────────────────────────────────────────────────────────┤
│  Name: Sales Report Analyzer                                 │
│  Category: Integration                                       │
│  Scope: Personal                                             │
│                                                               │
│  Capabilities:                                               │
│  • Read files from ~/Documents/Sales                         │
│  • Analyze CSV data                                          │
│  • Create PowerPoint presentations                           │
│  • Send email (requires approval)                            │
│                                                               │
│  Permissions Required:                                       │
│  ⚠️ File Read: ~/Documents/Sales/*.csv                       │
│  ⚠️ File Write: ~/Documents/Reports/*.pptx                   │
│  ⚠️ Network: smtp.gmail.com (email)                          │
│                                                               │
│  Trigger:                                                     │
│  📅 Every Monday at 9:00 AM                                  │
│                                                               │
│  [Test in Sandbox] [Install] [Cancel]                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Settings

### Window Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Settings                                          [×]       │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  General     │  General Settings Content                   │
│  Appearance  │                                              │
│  Bob         │                                              │
│  Projects    │                                              │
│  Tasks       │                                              │
│  Scheduling  │                                              │
│  Permissions │                                              │
│  Plugins     │                                              │
│  Integration │                                              │
│  Notificatio │                                              │
│  Memory      │                                              │
│  Data        │                                              │
│  Account     │                                              │
│  Advanced    │                                              │
│  About       │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Search

**Global Settings Search**:
- Search bar at top
- Filters settings as you type
- Highlights matching text

### Categories

**Sidebar Navigation**:
- General
- Appearance
- Bob & Models
- Projects
- Tasks
- Scheduling
- Permissions & Security
- Plugins
- Integrations
- Notifications
- Memory & Personalization
- Data & Privacy
- Account
- Advanced
- About

### Setting Controls

**Toggle**:
- macOS-style switch
- Label on left
- Description below (optional)

**Dropdown**:
- Current value displayed
- Click to show options
- Search in dropdown (if many options)

**Text Input**:
- Single line or multi-line
- Placeholder text
- Validation feedback

**Slider**:
- Min and max labels
- Current value displayed
- Snap to increments

**Color Picker**:
- Color swatch
- Click to open picker
- Preset colors

**File/Folder Picker**:
- Path displayed
- "Choose" button
- Clear button

---

## Approval Cards

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠️ Approval Required                          [Risk: High]  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Bob wants to write to file.csv                              │
│                                                               │
│  Why: To save the analyzed sales data                        │
│                                                               │
│  Details:                                                     │
│  • File: ~/Documents/Sales/report.csv                        │
│  • Size: ~50 KB                                              │
│  • Existing file will be overwritten                         │
│  • Undo: Backup available                                    │
│                                                               │
│  [Deny] [Modify] [Allow Once] [Allow for Task]              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Risk Level Badge

**Colors**:
- Low: Green
- Medium: Amber
- High: Orange
- Critical: Red

**Position**: Top-right corner

### Action Buttons

**Deny**:
- Color: Red
- Icon: X
- Keyboard: Escape

**Modify**:
- Color: Blue
- Icon: Edit
- Opens modification dialog

**Allow Once**:
- Color: Green
- Icon: Check
- Keyboard: Enter (if not critical)

**Allow for Task**:
- Color: Green
- Icon: Check with clock
- Keyboard: Cmd+Enter

**Always Allow** (if policy permits):
- Color: Yellow
- Icon: Check with infinity
- Warning dialog before confirming

---

## Notifications

### macOS Native Notifications

**Content**:
- Title
- Body
- Icon (app icon)
- Actions (if supported)

**Types**:
- Task Started
- Task Completed
- Task Failed
- Approval Required
- Information Needed
- Budget Warning
- Integration Disconnected
- Update Available

**Actions** (if macOS supports):
- Open
- Approve
- Deny
- Snooze

### In-App Notifications

**Toast Notifications**:
- Position: Top-right
- Duration: 3-5 seconds
- Dismissible
- Stack multiple

**Types**:
- Success: Green
- Info: Blue
- Warning: Amber
- Error: Red

---

## Accessibility

### Keyboard Navigation

**Global Shortcuts**:
- Cmd+N: New chat
- Cmd+Shift+N: New project
- Cmd+K: Search/Command palette
- Cmd+,: Settings
- Cmd+B: Toggle sidebar
- Cmd+I: Toggle inspector
- Cmd+W: Close window
- Cmd+Q: Quit app

**Navigation**:
- Tab: Next element
- Shift+Tab: Previous element
- Arrow keys: Navigate lists
- Enter: Activate
- Escape: Cancel/Close

### Screen Reader Support

**VoiceOver**:
- Semantic HTML
- ARIA labels
- ARIA live regions for dynamic content
- Descriptive button labels
- Alt text for images

### Visual Accessibility

**Contrast**:
- WCAG AA compliance minimum
- AAA for critical text

**Text Size**:
- Respect system text size settings
- Scale UI proportionally
- Min text size: 13px

**Reduced Motion**:
- Respect prefers-reduced-motion
- Disable animations
- Use instant transitions

**Color Blindness**:
- Don't rely on color alone
- Use icons and labels
- Test with color blindness simulators

---

## Responsive Behavior

### Window Sizes

**Large (1280px+)**:
- Sidebar: 260px
- Inspector: 340px
- Main: Flexible

**Medium (980px - 1279px)**:
- Sidebar: 240px
- Inspector: Hidden by default
- Main: Flexible

**Small (< 980px)**:
- Not supported (minimum window size enforced)

### Sidebar Collapse

**When collapsed**:
- Show icons only
- Width: 60px
- Tooltip on hover

### Inspector Detach

**Detached Inspector**:
- Separate window
- Floating above main window
- Always on top (optional)
- Resizable

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-08-05 | Bob (Plan Mode) | Initial UI specification |
