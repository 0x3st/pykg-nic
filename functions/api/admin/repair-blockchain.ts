// /api/admin/repair-blockchain - Repair blockchain integrity
import type { Env } from '../../lib/types';
import type { BlockchainLog } from '../../lib/blockchain';
import { requireAdmin, successResponse, errorResponse } from '../../lib/auth';
import { calculateBlockHash } from '../../lib/blockchain';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const authResult = await requireAdmin(request, env);
  if (authResult instanceof Response) {
    return authResult;
  }

  let body: { startFromId?: number; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const startFromId = body.startFromId || 141;
  const dryRun = body.dryRun ?? true; // Default to dry run for safety

  try {
    console.log(`[Blockchain Repair] Starting repair from block #${startFromId}, dryRun=${dryRun}`);

    // Get all blocks starting from the specified block
    const { results: blocksToRepair } = await env.DB.prepare(`
      SELECT * FROM blockchain_logs WHERE id >= ? ORDER BY id ASC
    `).bind(startFromId).all<BlockchainLog>();

    if (!blocksToRepair || blocksToRepair.length === 0) {
      return successResponse({ message: 'No blocks to repair', repaired: 0 });
    }

    // Get the previous block (should be correct)
    const prevBlock = await env.DB.prepare(
      'SELECT * FROM blockchain_logs WHERE id = ?'
    ).bind(startFromId - 1).first<BlockchainLog>();

    if (!prevBlock) {
      return errorResponse('Cannot find previous block to start repair', 400);
    }

    console.log(`[Blockchain Repair] Found ${blocksToRepair.length} blocks to repair`);
    console.log(`[Blockchain Repair] Starting from prev_hash: ${prevBlock.block_hash.substring(0, 16)}...`);

    let currentPrevHash = prevBlock.block_hash;
    const updates: Array<{ id: number; oldHash: string; newHash: string; oldPrev: string; newPrev: string }> = [];

    // Calculate new hashes for each block
    for (const block of blocksToRepair) {
      const newBlockHash = await calculateBlockHash(
        currentPrevHash,
        block.action,
        block.actor_name,
        block.target_type,
        block.target_name,
        block.result,
        block.details,
        block.timestamp
      );

      if (block.prev_hash !== currentPrevHash || block.block_hash !== newBlockHash) {
        updates.push({
          id: block.id,
          oldHash: block.block_hash,
          newHash: newBlockHash,
          oldPrev: block.prev_hash,
          newPrev: currentPrevHash
        });
      }

      currentPrevHash = newBlockHash;
    }

    console.log(`[Blockchain Repair] Calculated ${updates.length} blocks need updating`);

    if (dryRun) {
      return successResponse({
        dryRun: true,
        blocksToRepair: updates.length,
        totalBlocks: blocksToRepair.length,
        updates: updates.map(u => ({
          id: u.id,
          changes: {
            prev_hash: {
              from: u.oldPrev.substring(0, 16) + '...',
              to: u.newPrev.substring(0, 16) + '...',
              changed: u.oldPrev !== u.newPrev
            },
            block_hash: {
              from: u.oldHash.substring(0, 16) + '...',
              to: u.newHash.substring(0, 16) + '...',
              changed: u.oldHash !== u.newHash
            }
          }
        }))
      });
    }

    // Apply updates
    let repaired = 0;
    for (const update of updates) {
      await env.DB.prepare(`
        UPDATE blockchain_logs
        SET block_hash = ?, prev_hash = ?
        WHERE id = ?
      `).bind(update.newHash, update.newPrev, update.id).run();
      repaired++;
      console.log(`[Blockchain Repair] Updated block #${update.id}`);
    }

    console.log(`[Blockchain Repair] Repair completed, ${repaired} blocks updated`);

    return successResponse({
      repaired,
      totalBlocks: blocksToRepair.length,
      startedFrom: startFromId
    });
  } catch (e) {
    console.error('[Blockchain Repair] Error:', e);
    return errorResponse('Failed to repair blockchain', 500);
  }
};
