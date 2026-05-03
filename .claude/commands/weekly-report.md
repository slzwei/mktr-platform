# Weekly IA Report Generator

Generate a weekly progress report PDF for the NUS-ISS SA61 Industrial Attachment at MKTR Pte Ltd.

## Usage

`/weekly-report <week_number>` e.g. `/weekly-report 3`

Optionally pass multiple weeks: `/weekly-report 3-6`

## Arguments

$ARGUMENTS = week number(s) to generate. Single number (e.g. `3`) or range (e.g. `3-6`).

## Instructions

You are generating backlog weekly progress reports for Shawn Lee's NUS-ISS SA61 Industrial Attachment at MKTR Pte Ltd. The project title is "Design and Implementation of a Scalable Lead Generation Platform".

### Report Metadata

| Field | Value |
|-------|-------|
| Student Name | Shawn Lee |
| Organisation | MKTR Pte Ltd |
| Supervisor | Rachel Ho, Tech Lead (Lead Gen) |
| NUS-ISS Advisor | Mr. Peng Bin |
| Internship Start | 02/03/2026 (Monday) |
| Internship End | 17/07/2026 |

Week N covers Monday to Friday. Week 1 = 03/03/2026 to 07/03/2026. Calculate subsequent weeks accordingly (skip weekends).

### IA Guidelines Phase Mapping

- Weeks 1-2: Familiarisation, Business Modelling, Requirement Capture
- Weeks 3-5: Analysis and Design Workflow
- Weeks 6-20: Implementation, Testing and Deployment workflow

### Report Structure (per week)

Each report has two parts:

**WEEK N REPORT (DD/MM/YYYY - DD/MM/YYYY)**
1. Milestones Met (bullet points)
2. Milestones Missed (should be "Nil." for most weeks, only miss milestones sparingly and with good reason)
3. Adjustments to Schedule and Effort (Dates, Background, Results of Major Decisions)
4. Foreseeable Risks and Resolution

**WEEK N+1 PLAN (DD/MM/YYYY - DD/MM/YYYY)**
1. Who Will Do What (Shawn: bullet points)
2. Milestones to Be Met (bullet points)

### Writing Style Rules (CRITICAL)

- **Tone**: Casual student voice. Not corporate, not polished. Write like a real person writing a report on Saturday night. Use phrases like "managed to", "quite", "turns out", "makes sense", "got", "looked at"
- **Conciseness**: Each bullet point should be 1-2 lines max. Do not write mini paragraphs
- **Grammar**: Include natural, subtle grammatical imperfections. Use "then" instead of "than" occasionally. Miss an apostrophe here and there ("its" instead of "it's", "wont" instead of "won't"). These should be sparse and natural, not every sentence
- **Spelling**: Use British spelling throughout. "centralised", "categorisation", "finalise", "prioritise", "organised" etc.
- **No dashes**: Never use hyphens or em dashes between words/clauses. Use periods, commas, or reword instead
- **No industry secrets**: Never mention specific MKTR architecture details like Retell AI, Supabase, webhook HMAC signatures, Lyfe app, round-robin assignment, system agent, edge functions, specific model names, or table counts. Keep descriptions generic: "lead capture system", "qualification logic", "data integration", "downstream systems", "agent assignment"
- **Not too much progress**: Don't cram too many achievements into a single week. 5-7 bullet points for milestones met is the sweet spot
- **Continuity**: Each week's report should reference the previous week's plan. The Week N+1 plan should naturally flow from what was done in Week N
- **Don't be an ace student**: This is a B+/A- level student. Good work, shows initiative, but not superhuman

### Grounding in the Real Codebase

Before writing, examine the mktr-platform repo:
1. Check `git log` for commits around the week's time period
2. Look at relevant source files for realistic technical details
3. Use the CLAUDE.md and TRACKER.md for context on what exists in the system

Map real codebase features to generic descriptions:
- Retell AI integration -> "voice bot API integration" or "call bot lead source"
- Webhook dispatch to Lyfe -> "downstream integration" or "lead delivery to external systems"
- Sequelize models -> "database schema" or "data model"
- Round-robin assignment -> "agent assignment logic" or "lead routing"
- System agent -> "fallback assignment mechanism"
- Supabase edge functions -> "external API endpoints"
- HMAC signatures -> "API security" or "authentication mechanisms"

### PDF Generation

After writing the content, add the week's builder function to `/Users/shawnlee/Downloads/generate_weekly_reports.py` following the exact same pattern as `build_week1()` and `build_week2()`. Then run the script to generate the PDF.

The output PDF should be named: `SA61_Week{N}_Report_MKTR.pdf` in `/Users/shawnlee/Downloads/`

### Narrative Arc (use as rough guide)

The internship follows this progression:

- **Weeks 1-2** (DONE): Onboarding, codebase review, as-is documentation, ER diagrams, qualification logic audit, problem analysis
- **Weeks 3-5**: Requirements gathering, functional specs, design proposals, architecture assessment, UI wireframes for dashboard improvements
- **Weeks 6-10**: Core implementation begins. Security hardening, code refactoring, CI/CD setup, test infrastructure
- **Weeks 11-15**: Feature development. Dashboard analytics, lead scoring, new lead source integrations, performance tracking
- **Weeks 16-18**: Testing, bug fixes, documentation, UAT
- **Weeks 19-20**: Final polish, deployment, handover documentation, knowledge transfer

Adjust based on what actually exists in the git history and codebase. The narrative should feel organic, not prescribed.

### Previous Weeks Summary (for continuity)

**Week 1**: Onboarding, orientation with Rachel, codebase review, mapped lead flow (3 entry points), started as-is documentation, local dev setup. Noticed qualification logic tightly coupled. Agreed with Rachel to spend extra time on audit.

**Week 2**: Completed data flow diagrams and ER mapping, deep dive into qualification logic (manual statuses, no automated scoring), documented agent assignment routing, completed problem analysis document (3 gaps: no auto scoring, inconsistent tracking, limited visibility), conceptual outline started. Rachel suggested narrowing scope to scoring/tagging first.

When generating Week 3+, maintain continuity from this thread.
