/**
 * Credentials Manager Module
 * Handles loading and saving credentials to/from JSON file
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface Credentials {
  email: string;
  deviceId: string;
  ssaid: string;
  parseId?: string;
  parseToken?: string;
  authToken?: string;
  userId?: number;
  peerId?: string; // Format: {id}_{deviceId}
}

const DEFAULT_CREDENTIALS_PATH = path.join(process.cwd(), 'config', 'credentials.json');

/**
 * Strip "r: " prefix from token if present
 */
function stripTokenPrefix(token?: string): string | undefined {
  if (!token) return token;
  return token.startsWith('r: ') ? token.substring(3) : token;
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(credentialsPath: string): Promise<void> {
  const dir = path.dirname(credentialsPath);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Load credentials from JSON file
 * 
 * @param credentialsPath - Path to credentials file (default: ./config/credentials.json)
 * @returns Credentials object or null if file doesn't exist
 */
export async function loadCredentials(credentialsPath: string = DEFAULT_CREDENTIALS_PATH): Promise<Credentials | null> {
  try {
    const data = await fs.readFile(credentialsPath, 'utf-8');
    const credentials = JSON.parse(data) as Credentials;
    
    // Validate required fields
    if (!credentials.email || !credentials.deviceId || !credentials.ssaid) {
      throw new Error("Invalid credentials file: missing required fields");
    }
    
    return credentials;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - that's okay
      return null;
    }
    throw error;
  }
}

/**
 * Save credentials to JSON file
 * 
 * @param credentials - Credentials object to save
 * @param credentialsPath - Path to credentials file (default: ./config/credentials.json)
 */
export async function saveCredentials(
  credentials: Credentials,
  credentialsPath: string = DEFAULT_CREDENTIALS_PATH
): Promise<void> {
  await ensureConfigDir(credentialsPath);
  
  // Create a clean copy without undefined values
  const cleanCredentials: Record<string, any> = {
    email: credentials.email,
    deviceId: credentials.deviceId,
    ssaid: credentials.ssaid
  };
  
  if (credentials.parseId) {
    cleanCredentials.parseId = credentials.parseId;
  }
  if (credentials.parseToken) {
    // Strip "r: " prefix before saving
    cleanCredentials.parseToken = stripTokenPrefix(credentials.parseToken);
  }
  if (credentials.authToken) {
    // Strip "r: " prefix before saving
    cleanCredentials.authToken = stripTokenPrefix(credentials.authToken);
  }
  if (credentials.userId !== undefined) {
    cleanCredentials.userId = credentials.userId;
  }
  if (credentials.peerId) {
    cleanCredentials.peerId = credentials.peerId;
  }
  
  const data = JSON.stringify(cleanCredentials, null, 2);
  await fs.writeFile(credentialsPath, data, 'utf-8');
}

/**
 * Delete credentials file
 * 
 * @param credentialsPath - Path to credentials file (default: ./config/credentials.json)
 */
export async function deleteCredentials(credentialsPath: string = DEFAULT_CREDENTIALS_PATH): Promise<void> {
  try {
    await fs.unlink(credentialsPath);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File doesn't exist - that's okay
  }
}

