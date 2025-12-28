# Lead Stress Testing - Quick Start Guide

> 🚀 **TL;DR:** Generate realistic test leads, test your features, clean up when done.

---

## The Essentials

### Generate Test Leads

```bash
cd backend
./stress-test.sh run 1000
```

### Preview Cleanup

```bash
cd backend
./stress-test.sh preview
```

### Clean Up

```bash
cd backend
./stress-test.sh cleanup
```

### Get Help

```bash
cd backend
./stress-test.sh help
```

---

## Common Scenarios

### 🎨 Testing the Admin Dashboard

**Goal:** See how the dashboard handles hundreds/thousands of leads.

```bash
cd backend

# Generate 1000 realistic test leads
./stress-test.sh run 1000

# ✅ Now test in the UI:
#    - Browse prospects in admin dashboard
#    - Test filters, search, sorting
#    - Try bulk operations
#    - Check pagination

# When done testing:
./stress-test.sh cleanup
```

**What you get:**
- 1,000 prospects with realistic data
- Names, emails, companies, job titles
- Assigned to existing campaigns and agents
- Various lead statuses and priorities
- All tagged with "STRESS_TEST" for safe cleanup

---

### ⚡ Performance Testing

**Goal:** Test how the system performs under load.

```bash
cd backend

# Generate a large dataset
./stress-test.sh run 10000

# ✅ Test performance:
#    - API response times
#    - Database query speed
#    - UI rendering performance
#    - Memory usage

# Scale up if needed
./stress-test.sh run 5000  # Adds 5000 more (15k total)

# Clean up
./stress-test.sh cleanup
```

**Performance expectations:**
- Generation: ~50-70 leads/second
- 1,000 leads: ~15-20 seconds
- 10,000 leads: ~2-3 minutes
- Cleanup: ~1-2 seconds for 1,000 leads

---

### 🔧 API Development

**Goal:** Test API endpoints with realistic data.

```bash
cd backend

# Generate test data
./stress-test.sh run 500

# ✅ Test your API:
#    GET /api/prospects
#    GET /api/prospects/:id
#    PATCH /api/prospects/:id
#    POST /api/prospects/:id/assign

# Clean up
./stress-test.sh cleanup
```

---

### 🎯 UI Component Development

**Goal:** Develop UI components with realistic data.

```bash
cd backend

# Quick test cycle
./stress-test.sh run 100     # Small set for quick iteration

# Develop your component...

./stress-test.sh cleanup     # Clean when done

# Need more? Generate again
./stress-test.sh run 200
```

---

## All Commands

### Using the Wrapper Script (Recommended)

```bash
cd backend

# Generate leads
./stress-test.sh run 1000           # 1000 leads, default batch size
./stress-test.sh run 5000 100       # 5000 leads, batch size 100

# Preview cleanup
./stress-test.sh preview

# Clean up test data
./stress-test.sh cleanup

# Show help
./stress-test.sh help
```

### Direct Node.js Commands

```bash
cd backend

# Generate leads
node stress-test-leads.js           # 500 leads (default)
node stress-test-leads.js 1000      # 1000 leads
node stress-test-leads.js 5000 100  # 5000 leads, batch size 100

# Preview cleanup
node cleanup-test-leads.js

# Clean up (requires --confirm)
node cleanup-test-leads.js --confirm
```

---

## Sample Output

### Lead Generation

```
╔════════════════════════════════════════════════════════════╗
║       STRESS TEST - Lead Generation System                 ║
╚════════════════════════════════════════════════════════════╝

📊 Configuration:
   • Total leads to generate: 1,000
   • Batch size: 50
   • Tag: STRESS_TEST

🔌 Connecting to database...
✅ Database connected

🔍 Fetching existing campaigns, agents, and QR tags...
   • Found 5 campaigns
   • Found 3 agents
   • Found 12 QR tags

🚀 Starting lead generation...

[████████████████████████████████████████] 100.0%
   Batch 20/20: Created 50 leads @ 62.5/s
   Total: 1,000/1,000 | Elapsed: 16s | ETA: 0s

╔════════════════════════════════════════════════════════════╗
║                    GENERATION COMPLETE                     ║
╚════════════════════════════════════════════════════════════╝

📈 Summary:
   • Prospects created: 1,000
   • Activities created: 1,600
   • Total duration: 16s
   • Average rate: 62.5 leads/second
   • Tag: STRESS_TEST

✅ All test leads have been tagged with "STRESS_TEST"
🧹 Use cleanup-test-leads.js to remove them when done
```

### Cleanup Preview

```
╔════════════════════════════════════════════════════════════╗
║         STRESS TEST CLEANUP - DRY RUN MODE                 ║
╚════════════════════════════════════════════════════════════╝

🔍 Scanning for test prospects tagged with "STRESS_TEST"...

📋 Sample of prospects to be deleted:

  ID                                   | Name              | Email
  ------------------------------------------------------------------------
  a1b2c3d4-5678-90ab-cdef-123456789abc | James Smith       | james.smith@acme.com
  b2c3d4e5-6789-01bc-def0-234567890bcd | Mary Johnson      | mary.johnson@tech.com
  ... and 998 more

📊 Summary:
   • Prospects to delete: 1,000
   • Associated activities: 1,600
   • Total records: 2,600

⚠️  This is a PREVIEW ONLY (dry-run mode)

To actually delete these records, run:
  node cleanup-test-leads.js --confirm
```

---

## Configuration Options

### Lead Count

- **Minimum:** 1
- **Maximum:** 100,000
- **Default:** 500
- **Recommended:** 500-5,000 for most testing

### Batch Size

- **Minimum:** 1
- **Maximum:** 500
- **Default:** 50
- **Recommended:** 50-100 for best performance

### Examples

```bash
cd backend

# Small test
./stress-test.sh run 100

# Medium test (good for UI)
./stress-test.sh run 1000

# Large test (performance testing)
./stress-test.sh run 10000

# Custom batch size
./stress-test.sh run 5000 100
```

---

## What Data Gets Generated?

Each test prospect includes:

### Basic Info
- ✅ First name (from realistic dataset)
- ✅ Last name (from realistic dataset)
- ✅ Email (generated from name + company)
- ✅ Phone (US format: 555-123-4567)

### Professional Info
- ✅ Company name
- ✅ Job title
- ✅ Industry

### Lead Details
- ✅ Lead source (qr_code, website, referral, etc.)
- ✅ Lead status (new, contacted, qualified, etc.)
- ✅ Priority (low, medium, high, urgent)
- ✅ Lead score (0-100)
- ✅ Interests

### Location
- ✅ City
- ✅ State
- ✅ Zip code
- ✅ Country

### Additional Data
- ✅ Budget information
- ✅ Demographics
- ✅ Preferences
- ✅ Tags (including **STRESS_TEST**)

### Relationships
- ✅ Campaign assignment (if campaigns exist)
- ✅ Agent assignment (if agents exist)
- ✅ QR tag linking (if QR tags exist)

### Activities
- ✅ "Created" activity for each prospect
- ✅ "Assigned" activity for assigned prospects

---

## Safety Features

### 🏷️ Tagged for Safety

Every test prospect is tagged with `STRESS_TEST`:

```json
{
  "tags": ["STRESS_TEST"],
  // ... other fields
}
```

This means:
- ✅ Easy to identify test data
- ✅ Safe to delete without affecting real leads
- ✅ Can filter out in production queries

### 🔒 Dry-Run by Default

The cleanup script previews before deleting:

```bash
cd backend
node cleanup-test-leads.js          # Safe preview
node cleanup-test-leads.js --confirm  # Actually deletes
```

### 🔄 Atomic Deletion

Uses database transactions:
- ✅ All-or-nothing deletion
- ✅ Automatic rollback on error
- ✅ Deletes activities first, then prospects
- ✅ No orphaned records

---

## Typical Workflow

### Step 1: Generate

```bash
cd backend
./stress-test.sh run 1000
```

**Takes:** ~15-20 seconds
**Creates:** 1,000 prospects + activities

### Step 2: Test

Open your admin dashboard and test:
- Prospect listing
- Filtering and search
- Sorting
- Details view
- Assignment workflows
- Bulk operations

### Step 3: Verify

Preview what will be cleaned:

```bash
cd backend
./stress-test.sh preview
```

### Step 4: Clean Up

Remove all test data:

```bash
cd backend
./stress-test.sh cleanup
```

**Takes:** ~1-2 seconds
**Removes:** All STRESS_TEST tagged data

---

## Troubleshooting

### No campaigns/agents/tags found

**Not a problem!** Leads will still be created, just without those relationships.

To create relationships, seed your database first:

```bash
cd backend
npm run seed
```

### Slow generation

Try increasing batch size:

```bash
cd backend
./stress-test.sh run 1000 100  # Larger batches = faster
```

### Database connection failed

Check your `.env` file has correct credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mktr_db
DB_USER=mktr_user
DB_PASSWORD=your_password
```

### Need help?

```bash
cd backend
./stress-test.sh help
```

Or read the full documentation:
- [STRESS-TEST-README.md](./STRESS-TEST-README.md)

---

## Tips & Tricks

### Progressive Load Testing

Build up load gradually:

```bash
cd backend

./stress-test.sh run 1000    # Start
# ... test ...
./stress-test.sh run 4000    # Add more (5k total)
# ... test again ...
./stress-test.sh run 5000    # Add more (10k total)
# ... final test ...
./stress-test.sh cleanup     # Clean all
```

### Quick Iteration

For development, use small batches:

```bash
cd backend

# Quick cycle
./stress-test.sh run 100
# ... develop ...
./stress-test.sh cleanup

# Repeat
./stress-test.sh run 100
# ... test again ...
./stress-test.sh cleanup
```

### Performance Baseline

Establish a baseline:

```bash
cd backend

# Run with different sizes
time ./stress-test.sh run 1000
time ./stress-test.sh run 5000
time ./stress-test.sh run 10000

# Compare performance over time
```

---

## Questions?

- 📖 **Full Docs:** See [STRESS-TEST-README.md](./STRESS-TEST-README.md)
- 🐛 **Issues:** Open a GitHub issue
- 💬 **Support:** Contact the dev team

---

**Happy Testing! 🚀**




