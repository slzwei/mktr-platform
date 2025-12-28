# Lead Capture Stress Testing System

A comprehensive stress testing system for the MKTR Platform's lead capture and prospects management feature. Generate thousands of realistic test leads, test system performance, and safely clean up when done.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Detailed Usage](#detailed-usage)
- [Components](#components)
- [Configuration](#configuration)
- [Performance Metrics](#performance-metrics)
- [Safety Features](#safety-features)
- [Troubleshooting](#troubleshooting)
- [Example Workflows](#example-workflows)

---

## Overview

The stress testing system consists of three main components:

1. **stress-test-leads.js** - Generates thousands of realistic test prospects
2. **cleanup-test-leads.js** - Safely removes all test data
3. **stress-test.sh** - User-friendly wrapper script

All test data is tagged with `STRESS_TEST` for safe identification and removal.

---

## Features

### Lead Generation
- ✅ Generates realistic test prospects with complete data profiles
- ✅ Batch processing for high-performance (50-100+ leads/second)
- ✅ Automatic assignment to existing campaigns, agents, and QR tags
- ✅ Creates associated ProspectActivity records
- ✅ Real-time progress tracking with progress bars
- ✅ Configurable count and batch size
- ✅ Comprehensive data: names, emails, companies, job titles, industries, locations, etc.

### Safe Cleanup
- ✅ Dry-run mode by default (preview before deletion)
- ✅ Requires explicit `--confirm` flag to delete
- ✅ Transaction-based atomic deletion
- ✅ Shows samples of what will be deleted
- ✅ Only targets `STRESS_TEST` tagged data

### User Experience
- ✅ Beautiful CLI with progress bars and colors
- ✅ Real-time statistics and ETA
- ✅ Detailed summary reports
- ✅ Simple bash wrapper for common tasks

---

## Quick Start

### 1. Generate Test Leads

```bash
cd backend
./stress-test.sh run 1000
```

This generates 1000 realistic test leads in your database.

### 2. Test Your Features

Now you can:
- View leads in the admin dashboard
- Test filtering, sorting, and search
- Test lead assignment workflows
- Evaluate UI performance with large datasets
- Test API endpoints under load

### 3. Preview Cleanup

Before deleting, preview what will be removed:

```bash
cd backend
./stress-test.sh preview
```

### 4. Clean Up

When you're done testing:

```bash
cd backend
./stress-test.sh cleanup
```

---

## Detailed Usage

### Lead Generation Script

**Direct Node.js Usage:**

```bash
cd backend
node stress-test-leads.js [count] [batchSize]
```

**Parameters:**
- `count` - Number of leads to generate (default: 500, max: 100,000)
- `batchSize` - Leads per batch (default: 50, max: 500)

**Examples:**

```bash
# Generate 500 leads (default)
cd backend
node stress-test-leads.js

# Generate 1000 leads
cd backend
node stress-test-leads.js 1000

# Generate 5000 leads with batch size of 100
cd backend
node stress-test-leads.js 5000 100
```

**Output:**

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

---

### Cleanup Script

**Preview Mode (Safe - Default):**

```bash
cd backend
node cleanup-test-leads.js
```

This shows what will be deleted without actually deleting anything.

**Delete Mode (Requires Confirmation):**

```bash
cd backend
node cleanup-test-leads.js --confirm
```

**Example Preview Output:**

```
╔════════════════════════════════════════════════════════════╗
║         STRESS TEST CLEANUP - DRY RUN MODE                 ║
╚════════════════════════════════════════════════════════════╝

🔍 Scanning for test prospects tagged with "STRESS_TEST"...

📋 Sample of prospects to be deleted:

  ID                                   | Name                    | Email                         | Created
  ------------------------------------------------------------------------------------------------------------------------
  a1b2c3d4-5678-90ab-cdef-123456789abc | James Smith             | james.smith@acmecorp.com      | 2024-11-25
  b2c3d4e5-6789-01bc-def0-234567890bcd | Mary Johnson            | mary.johnson@techstart.com    | 2024-11-25
  ... and 998 more

📊 Summary:
   • Prospects to delete: 1,000
   • Associated activities: 1,600
   • Total records: 2,600

⚠️  This is a PREVIEW ONLY (dry-run mode)

To actually delete these records, run:
  node cleanup-test-leads.js --confirm
```

**Example Deletion Output:**

```
╔════════════════════════════════════════════════════════════╗
║         STRESS TEST CLEANUP - DELETION MODE                ║
╚════════════════════════════════════════════════════════════╝

🗑️  WARNING: This will permanently delete test data!

📋 Sample of prospects to be deleted:
  [... sample shown ...]

📊 Deletion summary:
   • Prospects: 1,000
   • Activities: 1,600
   • Total records: 2,600

⏳ Starting deletion in 3 seconds...
⏳ 2...
⏳ 1...

🚀 Deleting test data...

   Deleting prospect activities...
   ✅ Deleted 1,600 activities
   Deleting prospects...
   ✅ Deleted 1,000 prospects
   ✅ Transaction committed

╔════════════════════════════════════════════════════════════╗
║                   CLEANUP COMPLETE                         ║
╚════════════════════════════════════════════════════════════╝

✅ Successfully deleted:
   • 1,000 prospects
   • 1,600 activities
   • Total: 2,600 records
   • Duration: 2.3s

🎉 Database cleaned successfully!
```

---

### Bash Wrapper Script

The wrapper provides a simple interface for common operations.

**Commands:**

```bash
cd backend

# Generate test leads
./stress-test.sh run <count> [batchSize]

# Preview cleanup
./stress-test.sh preview

# Clean up test data
./stress-test.sh cleanup

# Show help
./stress-test.sh help
```

**Examples:**

```bash
cd backend

# Generate 1000 leads
./stress-test.sh run 1000

# Generate 2000 leads with batch size of 100
./stress-test.sh run 2000 100

# Preview what will be cleaned
./stress-test.sh preview

# Clean up
./stress-test.sh cleanup
```

---

## Components

### 1. stress-test-leads.js

**Purpose:** Generates realistic test prospects for stress testing.

**Key Features:**
- Realistic data generation using curated datasets
- Batch processing for performance
- Auto-assignment to campaigns, agents, and QR tags
- Progress tracking with real-time statistics
- Creates associated ProspectActivity records

**Data Generated:**
- First/last names from common US names
- Realistic email addresses based on name + company
- Phone numbers in standard format
- Companies from diverse industries
- Job titles appropriate for B2B leads
- Industry classifications
- Location data (20 major US cities)
- Budget information
- Demographics
- Preferences and interests
- Lead scoring
- Tags (including STRESS_TEST)

### 2. cleanup-test-leads.js

**Purpose:** Safely removes all stress test data from the database.

**Key Features:**
- Dry-run mode by default (safe preview)
- Requires explicit confirmation to delete
- Transaction-based deletion (all-or-nothing)
- Shows samples before deletion
- Only targets STRESS_TEST tagged prospects
- Deletes both prospects and their activities

**Safety Mechanisms:**
- Default mode is preview-only
- `--confirm` flag required for actual deletion
- 3-second countdown before deletion
- Atomic transaction (rollback on error)
- Only deletes records with STRESS_TEST tag

### 3. stress-test.sh

**Purpose:** User-friendly wrapper for common operations.

**Key Features:**
- Simple command interface
- Input validation
- Colored output for clarity
- Help documentation
- Error checking

---

## Configuration

### Environment Variables

The scripts use the same database configuration as your backend:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mktr_db
DB_USER=mktr_user
DB_PASSWORD=mktr_password
```

### Adjustable Parameters

**Lead Generation:**
- Count: 1 - 100,000 leads
- Batch size: 1 - 500 leads per batch

**Recommended Settings:**

| Use Case | Count | Batch Size | Notes |
|----------|-------|------------|-------|
| Quick test | 100 | 50 | Fast, for basic testing |
| Dashboard testing | 500-1000 | 50 | Good for UI testing |
| Performance testing | 5000-10000 | 100 | Stress test performance |
| Load testing | 50000+ | 100-200 | Heavy load scenarios |

---

## Performance Metrics

### Expected Performance

**Lead Generation:**
- **Small batch (100 leads):** ~2-3 seconds @ 40-50/s
- **Medium batch (1000 leads):** ~15-20 seconds @ 50-65/s
- **Large batch (10000 leads):** ~2-3 minutes @ 55-70/s
- **Extra large (50000 leads):** ~12-15 minutes @ 55-70/s

**Cleanup:**
- **Deletion speed:** ~1000-2000 records/second
- **1000 prospects:** ~1-2 seconds
- **10000 prospects:** ~5-8 seconds

### Performance Factors

**Faster:**
- Larger batch sizes (up to a point)
- Fewer existing campaigns/agents/tags (less FK overhead)
- SSD storage
- Local database

**Slower:**
- Very small batch sizes (< 20)
- Many indexes on prospects table
- Remote database with network latency
- Concurrent database operations

---

## Safety Features

### Tagged Data
All test prospects are tagged with `STRESS_TEST` in their tags array:

```json
{
  "tags": ["STRESS_TEST"]
}
```

This makes them easily identifiable and safe to remove without affecting real data.

### Dry-Run by Default
The cleanup script runs in preview mode by default:

```bash
cd backend
node cleanup-test-leads.js  # Preview only, no deletion
```

You must explicitly confirm to delete:

```bash
cd backend
node cleanup-test-leads.js --confirm  # Actually deletes
```

### Atomic Transactions
Cleanup uses database transactions to ensure:
- All-or-nothing deletion
- Automatic rollback on error
- Data consistency

### Cascading Deletion
The cleanup process:
1. First deletes ProspectActivity records (no orphans)
2. Then deletes Prospect records
3. Commits only if both succeed

---

## Troubleshooting

### Issue: "Database connection failed"

**Solution:**
- Check your `.env` file has correct database credentials
- Ensure database server is running
- Verify network connectivity

```bash
cd backend
# Test database connection
node -e "import('./src/database/connection.js').then(m => m.testConnection())"
```

### Issue: "No campaigns/agents/tags found"

**Impact:** Test leads won't have relationships assigned.

**Solution:**
- This is not an error, just a warning
- Leads will be created without campaignId, assignedAgentId, or qrTagId
- To have relationships, seed your database first:

```bash
cd backend
npm run seed
```

### Issue: Slow generation speed

**Causes:**
- Very small batch size
- Remote database with high latency
- Heavy concurrent load on database

**Solutions:**
- Increase batch size: `node stress-test-leads.js 1000 100`
- Use local database for testing
- Stop other intensive database operations

### Issue: "Out of memory" error

**Causes:**
- Very large batch size with very large count
- Insufficient system memory

**Solutions:**
- Reduce batch size
- Generate in smaller batches
- Increase Node.js heap size: `NODE_OPTIONS=--max-old-space-size=4096 node stress-test-leads.js 50000`

### Issue: Cleanup doesn't find test leads

**Check:**

```bash
cd backend
node cleanup-test-leads.js  # Should show count
```

**Possible causes:**
- No test leads exist (already cleaned)
- Database connection issue
- Wrong database selected

### Issue: "JSON_CONTAINS" function error

**Cause:** SQLite doesn't support `JSON_CONTAINS` function.

**Solution:**
The scripts are designed for PostgreSQL. For SQLite, you'll need to modify the query in `cleanup-test-leads.js`:

Replace:
```javascript
where: sequelize.where(
  sequelize.fn('JSON_CONTAINS', sequelize.col('tags'), JSON.stringify('STRESS_TEST')),
  1
)
```

With:
```javascript
where: sequelize.where(
  sequelize.fn('', sequelize.col('tags')),
  { [Op.like]: '%STRESS_TEST%' }
)
```

---

## Example Workflows

### Workflow 1: Dashboard UI Testing

**Goal:** Test the admin prospects dashboard with realistic data.

```bash
cd backend

# 1. Generate 1000 test leads
./stress-test.sh run 1000

# 2. Open admin dashboard and test:
#    - Filtering by status, priority, source
#    - Sorting by different columns
#    - Pagination
#    - Search functionality
#    - Bulk operations

# 3. When done, clean up
./stress-test.sh preview   # Check what will be deleted
./stress-test.sh cleanup   # Remove test data
```

### Workflow 2: Performance Testing

**Goal:** Test system performance under heavy load.

```bash
cd backend

# 1. Generate a large dataset
./stress-test.sh run 10000

# 2. Test performance:
#    - API response times
#    - Database query performance
#    - UI rendering speed
#    - Memory usage

# 3. Generate more if needed
./stress-test.sh run 5000  # Adds 5000 more

# 4. Clean up when done
./stress-test.sh cleanup
```

### Workflow 3: API Development

**Goal:** Test API endpoints with realistic data.

```bash
cd backend

# 1. Generate test data
./stress-test.sh run 500

# 2. Test API endpoints:
#    GET /api/prospects - List all
#    GET /api/prospects?leadStatus=new - Filter
#    GET /api/prospects/:id - Get details
#    PATCH /api/prospects/:id/assign - Assignment

# 3. Clean up
./stress-test.sh cleanup
```

### Workflow 4: Load Testing

**Goal:** Test system under extreme load.

```bash
cd backend

# 1. Generate very large dataset
./stress-test.sh run 50000

# 2. Run load tests with Artillery/k6
#    - Concurrent API requests
#    - Dashboard load testing
#    - Database performance monitoring

# 3. Generate more if needed for progressive load
./stress-test.sh run 25000  # Now at 75k total

# 4. Clean up
./stress-test.sh preview   # Verify count
./stress-test.sh cleanup   # Remove all test data
```

### Workflow 5: Development Testing

**Goal:** Iterative development with quick test cycles.

```bash
cd backend

# Quick cycle
./stress-test.sh run 100     # Generate quick test set
# ... develop and test ...
./stress-test.sh cleanup     # Clean up

# Repeat as needed
./stress-test.sh run 200     # Different size
# ... test again ...
./stress-test.sh cleanup
```

---

## Advanced Usage

### Custom Batch Sizes

Optimize for your system:

```bash
cd backend

# Small batches (safer, slower)
node stress-test-leads.js 1000 25

# Large batches (faster, more memory)
node stress-test-leads.js 10000 200
```

### Progressive Testing

Build up load gradually:

```bash
cd backend

./stress-test.sh run 1000    # Start with 1k
# Test system
./stress-test.sh run 4000    # Add 4k more (5k total)
# Test again
./stress-test.sh run 5000    # Add 5k more (10k total)
# Final tests
./stress-test.sh cleanup     # Remove all
```

### Partial Cleanup

If you want to keep some test data, manually delete by date:

```sql
-- Delete old test data, keep recent
DELETE FROM prospect_activities 
WHERE prospect_id IN (
  SELECT id FROM prospects 
  WHERE tags LIKE '%STRESS_TEST%' 
  AND created_at < NOW() - INTERVAL '1 day'
);

DELETE FROM prospects 
WHERE tags LIKE '%STRESS_TEST%' 
AND created_at < NOW() - INTERVAL '1 day';
```

---

## Best Practices

1. **Always preview before cleanup**
   ```bash
   cd backend
   ./stress-test.sh preview  # Check first
   ./stress-test.sh cleanup  # Then delete
   ```

2. **Start small, scale up**
   - Start with 100-500 leads
   - Test your use case
   - Scale up as needed

3. **Monitor system resources**
   - Watch database connections
   - Monitor memory usage
   - Check disk space

4. **Clean up when done**
   - Don't leave test data in production
   - Clean up before deploying
   - Clean up before backups

5. **Use appropriate batch sizes**
   - Default (50) is good for most cases
   - Increase for better performance
   - Decrease if hitting memory limits

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [Quick Start Guide](./STRESS-TEST-QUICK-START.md)
3. Open an issue on GitHub
4. Contact the development team

---

## License

MIT License - see LICENSE file for details.




