#!/usr/bin/env node

/**
 * Cleanup Script - Remove Stress Test Leads
 * 
 * Safely removes all test prospects tagged with "STRESS_TEST".
 * Runs in dry-run mode by default for safety.
 * 
 * Usage:
 *   node cleanup-test-leads.js          # Preview what will be deleted (safe)
 *   node cleanup-test-leads.js --confirm # Actually delete the test data
 * 
 * Safety Features:
 *   - Dry-run mode by default (preview only)
 *   - Requires explicit --confirm flag to delete
 *   - Uses transactions for atomic deletion
 *   - Shows sample of what will be deleted
 *   - Only deletes prospects tagged with "STRESS_TEST"
 */

import { sequelize } from './src/database/connection.js';
import Prospect from './src/models/Prospect.js';
import ProspectActivity from './src/models/ProspectActivity.js';
import { Op } from 'sequelize';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatNumber(num) {
  return num.toLocaleString();
}

async function getTestProspects() {
  // Find all prospects with STRESS_TEST tag
  const prospects = await Prospect.findAll({
    where: sequelize.where(
      sequelize.fn('JSON_CONTAINS', sequelize.col('tags'), JSON.stringify('STRESS_TEST')),
      1
    ),
    attributes: ['id', 'firstName', 'lastName', 'email', 'company', 'createdAt'],
    order: [['createdAt', 'DESC']],
    limit: 1000 // Safety limit for display
  });

  return prospects;
}

async function getTestProspectsCount() {
  // Count all prospects with STRESS_TEST tag
  const count = await Prospect.count({
    where: sequelize.where(
      sequelize.fn('JSON_CONTAINS', sequelize.col('tags'), JSON.stringify('STRESS_TEST')),
      1
    )
  });

  return count;
}

async function getActivitiesCount(prospectIds) {
  if (prospectIds.length === 0) return 0;
  
  const count = await ProspectActivity.count({
    where: {
      prospectId: {
        [Op.in]: prospectIds
      }
    }
  });

  return count;
}

function displaySample(prospects, limit = 10) {
  console.log('\n📋 Sample of prospects to be deleted:\n');
  console.log('  ID                                   | Name                    | Email                         | Created');
  console.log('  ' + '-'.repeat(120));
  
  const sample = prospects.slice(0, limit);
  for (const prospect of sample) {
    const id = prospect.id.substring(0, 36);
    const name = `${prospect.firstName} ${prospect.lastName}`.padEnd(24).substring(0, 24);
    const email = (prospect.email || '').padEnd(30).substring(0, 30);
    const created = new Date(prospect.createdAt).toISOString().split('T')[0];
    console.log(`  ${id} | ${name} | ${email} | ${created}`);
  }
  
  if (prospects.length > limit) {
    console.log(`  ... and ${formatNumber(prospects.length - limit)} more`);
  }
  console.log('');
}

// ============================================================================
// CLEANUP FUNCTIONS
// ============================================================================

async function previewCleanup() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         STRESS TEST CLEANUP - DRY RUN MODE                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('🔍 Scanning for test prospects tagged with "STRESS_TEST"...\n');

  try {
    // Connect to database
    await sequelize.authenticate();

    // Get test prospects
    const prospects = await getTestProspects();
    const totalCount = await getTestProspectsCount();
    
    if (totalCount === 0) {
      console.log('✅ No test prospects found. Database is clean!\n');
      return;
    }

    // Get activities count
    const prospectIds = prospects.map(p => p.id);
    const activitiesCount = await getActivitiesCount(prospectIds);

    // Display sample
    displaySample(prospects);

    // Summary
    console.log('📊 Summary:');
    console.log(`   • Prospects to delete: ${formatNumber(totalCount)}`);
    console.log(`   • Associated activities: ${formatNumber(activitiesCount)}`);
    console.log(`   • Total records: ${formatNumber(totalCount + activitiesCount)}`);
    console.log('');
    console.log('⚠️  This is a PREVIEW ONLY (dry-run mode)');
    console.log('');
    console.log('To actually delete these records, run:');
    console.log('  node cleanup-test-leads.js --confirm');
    console.log('');

  } catch (error) {
    console.error('\n❌ Error during preview:');
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

async function performCleanup() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         STRESS TEST CLEANUP - DELETION MODE                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('🗑️  WARNING: This will permanently delete test data!\n');

  const startTime = Date.now();

  try {
    // Connect to database
    await sequelize.authenticate();

    // Get test prospects first (for display)
    const prospects = await getTestProspects();
    const totalCount = await getTestProspectsCount();

    if (totalCount === 0) {
      console.log('✅ No test prospects found. Nothing to delete.\n');
      return;
    }

    // Get activities count
    const prospectIds = prospects.map(p => p.id);
    const activitiesCount = await getActivitiesCount(prospectIds);

    // Display what will be deleted
    displaySample(prospects, 5);
    
    console.log('📊 Deletion summary:');
    console.log(`   • Prospects: ${formatNumber(totalCount)}`);
    console.log(`   • Activities: ${formatNumber(activitiesCount)}`);
    console.log(`   • Total records: ${formatNumber(totalCount + activitiesCount)}`);
    console.log('');

    // Countdown
    console.log('⏳ Starting deletion in 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('⏳ 2...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('⏳ 1...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('');

    // Perform deletion in transaction
    console.log('🚀 Deleting test data...\n');
    
    const transaction = await sequelize.transaction();
    
    try {
      // Delete activities first (foreign key constraint)
      console.log('   Deleting prospect activities...');
      const activitiesDeleted = await ProspectActivity.destroy({
        where: {
          prospectId: {
            [Op.in]: prospectIds
          }
        },
        transaction
      });
      console.log(`   ✅ Deleted ${formatNumber(activitiesDeleted)} activities`);

      // Delete prospects
      console.log('   Deleting prospects...');
      const prospectsDeleted = await Prospect.destroy({
        where: sequelize.where(
          sequelize.fn('JSON_CONTAINS', sequelize.col('tags'), JSON.stringify('STRESS_TEST')),
          1
        ),
        transaction
      });
      console.log(`   ✅ Deleted ${formatNumber(prospectsDeleted)} prospects`);

      // Commit transaction
      await transaction.commit();
      console.log('   ✅ Transaction committed');

      const duration = Date.now() - startTime;
      const durationSeconds = (duration / 1000).toFixed(1);

      // Final summary
      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║                   CLEANUP COMPLETE                         ║');
      console.log('╚════════════════════════════════════════════════════════════╝\n');
      console.log('✅ Successfully deleted:');
      console.log(`   • ${formatNumber(prospectsDeleted)} prospects`);
      console.log(`   • ${formatNumber(activitiesDeleted)} activities`);
      console.log(`   • Total: ${formatNumber(prospectsDeleted + activitiesDeleted)} records`);
      console.log(`   • Duration: ${durationSeconds}s`);
      console.log('');
      console.log('🎉 Database cleaned successfully!\n');

    } catch (error) {
      await transaction.rollback();
      console.log('   ❌ Transaction rolled back');
      throw error;
    }

  } catch (error) {
    console.error('\n❌ Error during cleanup:');
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

const args = process.argv.slice(2);
const confirmFlag = args.includes('--confirm');

if (confirmFlag) {
  performCleanup();
} else {
  previewCleanup();
}




