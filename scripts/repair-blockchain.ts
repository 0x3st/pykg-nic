#!/usr/bin/env tsx
// Script to repair blockchain integrity by recalculating hashes from a specific block

interface BlockchainLog {
  id: number;
  block_hash: string;
  prev_hash: string;
  action: string;
  actor_name: string | null;
  target_type: string | null;
  target_name: string | null;
  result: string | null;
  details: string | null;
  timestamp: string;
}

// Calculate SHA-256 hash
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calculate block hash from data
async function calculateBlockHash(
  prevHash: string,
  action: string,
  actorName: string | null,
  targetType: string | null,
  targetName: string | null,
  result: string | null,
  details: string | null,
  timestamp: string
): Promise<string> {
  const data = `${prevHash}|${action}|${actorName ?? ''}|${targetType ?? ''}|${targetName ?? ''}|${result ?? ''}|${details ?? ''}|${timestamp}`;
  return sha256(data);
}

async function main() {
  const START_BLOCK_ID = 141;

  console.log('🔧 Blockchain Repair Tool');
  console.log('========================\n');

  // Step 1: Get the last good block (block #140)
  console.log('📖 Reading block #140 (last good block)...');
  const result140 = await fetch('https://pykg-nic.pages.dev/api/logs?limit=1&offset=0', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: 'SELECT * FROM blockchain_logs WHERE id = 140'
    })
  });

  console.log('\n⚠️  This script needs to be run using wrangler d1 execute commands.');
  console.log('Please use the following steps manually:\n');

  console.log('1. Export all blocks from #141 onwards:');
  console.log(`   wrangler d1 execute pykg-nic-db --remote --command "SELECT * FROM blockchain_logs WHERE id >= ${START_BLOCK_ID} ORDER BY id ASC" --json > blocks.json\n`);

  console.log('2. Get block #140 hash:');
  console.log('   wrangler d1 execute pykg-nic-db --remote --command "SELECT block_hash FROM blockchain_logs WHERE id = 140"\n');

  console.log('3. For each block from #141 onwards:');
  console.log('   - Calculate new block_hash using prev block\'s hash');
  console.log('   - Update the block with new hashes\n');

  console.log('Due to D1 limitations, we\'ll provide SQL update statements instead.\n');
  console.log('Generating repair SQL...\n');

  // Since we can't directly access D1 from Node.js easily, let's output the repair instructions
  console.log('Run these commands in sequence:\n');
  console.log('# First, get all affected blocks and calculate new hashes');
  console.log('# Then apply updates one by one to maintain chain integrity\n');

  console.log('Alternatively, use the repair API endpoint approach below.');
}

main().catch(console.error);
