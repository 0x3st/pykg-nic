// Blockchain-style immutable audit log system

export interface BlockchainLog {
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
  created_at: string;
}

export interface AddLogParams {
  action: string;
  actorName?: string | null;
  targetType?: string | null;
  targetName?: string | null;
  result?: string | null;
  details?: Record<string, unknown> | null;
}

// Calculate SHA-256 hash
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get the latest block hash from the chain
export async function getLatestBlockHash(db: D1Database): Promise<string> {
  const result = await db.prepare(
    'SELECT block_hash FROM blockchain_logs ORDER BY id DESC LIMIT 1'
  ).first<{ block_hash: string }>();

  return result?.block_hash || '0'; // Genesis block has prev_hash of "0"
}

// Calculate block hash from data
export async function calculateBlockHash(
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

// Add a new log entry to the blockchain
export async function addBlockchainLog(
  db: D1Database,
  params: AddLogParams
): Promise<{ success: boolean; blockHash?: string; error?: string }> {
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 50;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const timestamp = new Date().toISOString();

      // Get the latest block hash within a batch operation for better atomicity
      const prevHash = await getLatestBlockHash(db);
      const detailsStr = params.details ? JSON.stringify(params.details) : null;
      const resultStr = params.result ?? 'success';

      const blockHash = await calculateBlockHash(
        prevHash,
        params.action,
        params.actorName ?? null,
        params.targetType ?? null,
        params.targetName ?? null,
        resultStr,
        detailsStr,
        timestamp
      );

      // Insert the new block
      await db.prepare(`
        INSERT INTO blockchain_logs
        (block_hash, prev_hash, action, actor_name, target_type, target_name, result, details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        blockHash,
        prevHash,
        params.action,
        params.actorName ?? null,
        params.targetType ?? null,
        params.targetName ?? null,
        resultStr,
        detailsStr,
        timestamp
      ).run();

      // Verify the chain integrity after insertion
      // Get the block we just inserted and the one before it
      const insertedBlock = await db.prepare(
        'SELECT * FROM blockchain_logs WHERE block_hash = ?'
      ).bind(blockHash).first<BlockchainLog>();

      if (!insertedBlock) {
        throw new Error('Failed to verify inserted block');
      }

      // If this is not the genesis block, verify the prev_hash points to the actual previous block
      if (insertedBlock.id > 1) {
        const actualPrevBlock = await db.prepare(
          'SELECT * FROM blockchain_logs WHERE id = ?'
        ).bind(insertedBlock.id - 1).first<BlockchainLog>();

        if (actualPrevBlock && actualPrevBlock.block_hash !== insertedBlock.prev_hash) {
          // Race condition detected! Delete this block and retry
          console.warn(`[Blockchain] Race condition detected on attempt ${attempt + 1}, retrying...`);
          await db.prepare('DELETE FROM blockchain_logs WHERE id = ?').bind(insertedBlock.id).run();

          // Wait a bit before retrying
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
            continue;
          } else {
            throw new Error('Max retries reached due to race conditions');
          }
        }
      }

      return { success: true, blockHash };
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) {
        console.error('Failed to add blockchain log after retries:', e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  return { success: false, error: 'Failed after max retries' };
}

// Verify the integrity of the blockchain
export async function verifyChain(
  db: D1Database
): Promise<{ valid: boolean; totalBlocks: number; invalidAt?: number }> {
  const { results } = await db.prepare(
    'SELECT * FROM blockchain_logs ORDER BY id ASC'
  ).all<BlockchainLog>();

  if (!results || results.length === 0) {
    return { valid: true, totalBlocks: 0 };
  }

  let expectedPrevHash = '0';

  for (let i = 0; i < results.length; i++) {
    const block = results[i];

    // Check prev_hash matches
    if (block.prev_hash !== expectedPrevHash) {
      return { valid: false, totalBlocks: results.length, invalidAt: block.id };
    }

    // Recalculate and verify block hash
    const calculatedHash = await calculateBlockHash(
      block.prev_hash,
      block.action,
      block.actor_name,
      block.target_type,
      block.target_name,
      block.result,
      block.details,
      block.timestamp
    );

    if (calculatedHash !== block.block_hash) {
      return { valid: false, totalBlocks: results.length, invalidAt: block.id };
    }

    expectedPrevHash = block.block_hash;
  }

  return { valid: true, totalBlocks: results.length };
}

// Get logs with pagination
export async function getLogs(
  db: D1Database,
  options: {
    limit?: number;
    offset?: number;
    action?: string;
    actorName?: string;
    targetType?: string;
  } = {}
): Promise<{ logs: BlockchainLog[]; total: number }> {
  const limit = Math.min(options.limit || 50, 100);
  const offset = options.offset || 0;

  let whereClause = '1=1';
  const params: (string | number)[] = [];

  if (options.action) {
    whereClause += ' AND action = ?';
    params.push(options.action);
  }

  if (options.actorName) {
    whereClause += ' AND actor_name = ?';
    params.push(options.actorName);
  }

  if (options.targetType) {
    whereClause += ' AND target_type = ?';
    params.push(options.targetType);
  }

  const { results } = await db.prepare(`
    SELECT * FROM blockchain_logs
    WHERE ${whereClause}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all<BlockchainLog>();

  const countResult = await db.prepare(`
    SELECT COUNT(*) as count FROM blockchain_logs WHERE ${whereClause}
  `).bind(...params).first<{ count: number }>();

  return {
    logs: results || [],
    total: countResult?.count || 0
  };
}

// Action type constants for consistency
export const BlockchainActions = {
  // User actions
  USER_REGISTER: 'user_register',
  USER_BAN: 'user_ban',
  USER_UNBAN: 'user_unban',
  ADMIN_GRANT: 'admin_grant',
  ADMIN_REVOKE: 'admin_revoke',
  // Domain actions
  DOMAIN_REGISTER: 'domain_register',
  DOMAIN_APPROVE: 'domain_approve',
  DOMAIN_REJECT: 'domain_reject',
  DOMAIN_SUSPEND: 'domain_suspend',
  DOMAIN_ACTIVATE: 'domain_activate',
  DOMAIN_DELETE: 'domain_delete',
  // Appeal actions
  APPEAL_SUBMIT: 'appeal_submit',
  APPEAL_APPROVE: 'appeal_approve',
  APPEAL_REJECT: 'appeal_reject',
  // Setting actions
  SETTING_UPDATE: 'setting_update',
} as const;

export type BlockchainAction = typeof BlockchainActions[keyof typeof BlockchainActions];
