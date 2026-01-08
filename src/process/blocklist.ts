/**
 * Mesh Blocklist Manager
 * Manages temporarily and permanently blocked meshes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BlockedMesh, BlocklistData } from './types';

export class MeshBlocklist {
  private blockedMeshes: Map<string, BlockedMesh> = new Map();
  private persistPath: string;
  private blocklistDuration: number;  // Default 1 hour in milliseconds

  constructor(persistPath?: string, blocklistDuration: number = 3600000) {
    this.persistPath = persistPath || path.join(process.cwd(), 'config', 'blocklist.json');
    this.blocklistDuration = blocklistDuration;
  }

  /**
   * Load blocklist from file
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const data: BlocklistData = JSON.parse(content);
      
      // Load blocked meshes
      for (const [meshId, mesh] of Object.entries(data.blockedMeshes || {})) {
        this.blockedMeshes.set(meshId, mesh);
      }

      // Clean up expired blocks
      this.cleanupExpiredBlocks();

      console.log(`[Blocklist] Loaded ${this.blockedMeshes.size} blocked meshes`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[Blocklist] No existing blocklist file, starting fresh');
      } else {
        console.error(`[Blocklist] Failed to load: ${error.message}`);
      }
    }
  }

  /**
   * Save blocklist to file
   */
  async save(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.persistPath);
      await fs.mkdir(dir, { recursive: true });

      // Convert map to object
      const data: BlocklistData = {
        blockedMeshes: Object.fromEntries(this.blockedMeshes)
      };

      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error: any) {
      console.error(`[Blocklist] Failed to save: ${error.message}`);
    }
  }

  /**
   * Block a mesh
   */
  async block(
    meshId: string,
    reason: 'connection_failures' | 'kicked',
    duration?: number
  ): Promise<void> {
    const now = Date.now();
    const mesh: BlockedMesh = {
      meshId,
      reason,
      blockedAt: now,
      blockedUntil: reason === 'kicked' ? null : now + (duration || this.blocklistDuration)
    };

    this.blockedMeshes.set(meshId, mesh);
    await this.save();

    if (reason === 'kicked') {
      console.log(`[Blocklist] Permanently blocked mesh ${meshId} (kicked)`);
    } else {
      const hours = ((duration || this.blocklistDuration) / 3600000).toFixed(1);
      console.log(`[Blocklist] Blocked mesh ${meshId} for ${hours} hours (${reason})`);
    }
  }

  /**
   * Check if mesh is blocked
   */
  isBlocked(meshId: string): boolean {
    const mesh = this.blockedMeshes.get(meshId);
    
    if (!mesh) {
      return false;
    }

    // Permanent block (kicked)
    if (mesh.blockedUntil === null) {
      return true;
    }

    // Check if temporary block has expired
    if (Date.now() > mesh.blockedUntil) {
      this.blockedMeshes.delete(meshId);
      this.save().catch(err => console.error('[Blocklist] Failed to save after unblock:', err));
      return false;
    }

    return true;
  }

  /**
   * Unblock a mesh
   */
  async unblock(meshId: string): Promise<boolean> {
    const existed = this.blockedMeshes.delete(meshId);
    if (existed) {
      await this.save();
      console.log(`[Blocklist] Unblocked mesh ${meshId}`);
    }
    return existed;
  }

  /**
   * Get blocked mesh info
   */
  getBlockedMesh(meshId: string): BlockedMesh | undefined {
    return this.blockedMeshes.get(meshId);
  }

  /**
   * Get all blocked meshes
   */
  getAllBlocked(): BlockedMesh[] {
    return Array.from(this.blockedMeshes.values());
  }

  /**
   * Get count of blocked meshes
   */
  getBlockedCount(): number {
    return this.blockedMeshes.size;
  }

  /**
   * Clean up expired temporary blocks
   */
  cleanupExpiredBlocks(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [meshId, mesh] of this.blockedMeshes.entries()) {
      // Skip permanent blocks
      if (mesh.blockedUntil === null) {
        continue;
      }

      // Remove expired blocks
      if (now > mesh.blockedUntil) {
        this.blockedMeshes.delete(meshId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Blocklist] Cleaned up ${cleaned} expired blocks`);
      this.save().catch(err => console.error('[Blocklist] Failed to save after cleanup:', err));
    }
  }

  /**
   * Get time remaining for temporary block (in milliseconds)
   */
  getTimeRemaining(meshId: string): number | null {
    const mesh = this.blockedMeshes.get(meshId);
    
    if (!mesh) {
      return null;
    }

    // Permanent block
    if (mesh.blockedUntil === null) {
      return null;
    }

    const remaining = mesh.blockedUntil - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Clear all blocks (use with caution)
   */
  async clearAll(): Promise<void> {
    this.blockedMeshes.clear();
    await this.save();
    console.log('[Blocklist] Cleared all blocked meshes');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    permanent: number;
    temporary: number;
  } {
    let permanent = 0;
    let temporary = 0;

    for (const mesh of this.blockedMeshes.values()) {
      if (mesh.blockedUntil === null) {
        permanent++;
      } else {
        temporary++;
      }
    }

    return {
      total: this.blockedMeshes.size,
      permanent,
      temporary
    };
  }
}
