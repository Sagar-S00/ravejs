/**
 * Script to add an admin user to MongoDB
 * Usage: npx ts-node scripts/add-admin.ts <userId> [addedByUserId]
 */

import { connectDatabase, disconnectDatabase, adminRepo } from './src/index';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: npx ts-node admib.ts <userId> [addedByUserId]');
    console.error('Example: npx ts-node admib.ts 67232178');
    process.exit(1);
  }

  const userId = parseInt(args[0], 10);
  const addedBy = args.length > 1 ? parseInt(args[1], 10) : userId; // Default to self if not specified

  if (isNaN(userId)) {
    console.error('Error: Invalid user ID. Must be a number.');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await connectDatabase();
    console.log('✓ Connected to MongoDB');

    console.log(`\nAdding user ${userId} as admin...`);
    await adminRepo.addAdmin(userId, addedBy);
    console.log(`✓ Successfully added user ${userId} as admin`);

    // Verify it was added
    const isAdmin = await adminRepo.isAdmin(userId);
    if (isAdmin) {
      console.log(`✓ Verified: User ${userId} is now an admin`);
    } else {
      console.log(`⚠ Warning: User ${userId} was added but verification failed`);
    }

    console.log('\n✓ Done!');
  } catch (error: any) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

main().catch(console.error);