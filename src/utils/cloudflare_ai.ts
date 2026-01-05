/**
 * Cloudflare AI Utilities for Rave Bot
 * Handles Cloudflare Workers AI integration with group chat support
 */

import axios, { AxiosInstance } from 'axios';

// =========================
// CONFIG
// =========================

const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY || "DFAAcdEVHAKaV0ZhTFPoZYc7BMcEGi6-S2WTusuV";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "3860b8a7aef7b8c166e09fe254939799";
const CLOUDFLARE_MODEL = "@hf/nousresearch/hermes-2-pro-mistral-7b";

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1`;

// Default system prompt (can be overridden)
let SYSTEM_PROMPT = "You are Akane, a goth character with a dry, disinterested personality.";

/**
 * Set the system prompt for AI responses
 */
export function setSystemPrompt(prompt: string): void {
  SYSTEM_PROMPT = prompt;
}

/**
 * Get the current system prompt
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

// =========================
// THREAD CACHE
// =========================

interface ThreadMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ThreadCache {
  messages: ThreadMessage[];
  lastAccess: number;
}

// Thread cache: keyed by mesh_id (room_id), TTL 24 hours
const threadCache = new Map<string, ThreadCache>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function cleanupCache(): void {
  const now = Date.now();
  for (const [meshId, cache] of threadCache.entries()) {
    if (now - cache.lastAccess > CACHE_TTL) {
      threadCache.delete(meshId);
    }
  }
}

// Cleanup cache every hour
setInterval(cleanupCache, 60 * 60 * 1000);

// =========================
// THREAD MANAGEMENT
// =========================

function getThreadMessages(meshId: string): ThreadMessage[] {
  const cache = threadCache.get(meshId);
  if (cache) {
    cache.lastAccess = Date.now();
    return cache.messages;
  }
  
  // Initialize with system prompt
  const messages: ThreadMessage[] = [
    { role: "system", content: SYSTEM_PROMPT }
  ];
  threadCache.set(meshId, {
    messages,
    lastAccess: Date.now()
  });
  return messages;
}

function addMessage(meshId: string, role: "user" | "assistant", content: string): void {
  const messages = getThreadMessages(meshId);
  messages.push({ role, content });
  const cache = threadCache.get(meshId);
  if (cache) {
    cache.lastAccess = Date.now();
  }
}

/**
 * Add a user message to the thread
 */
export function addUserMessage(meshId: string, userName: string, message: string): void {
  const formattedMessage = `${userName}: ${message}`;
  addMessage(meshId, "user", formattedMessage);
}

/**
 * Get AI response using Cloudflare Workers AI
 * 
 * @param meshId - The mesh/room ID to get response for
 * @returns AI-generated response text, or null if error
 */
export async function getResponse(meshId: string): Promise<string | null> {
  try {
    const messages = getThreadMessages(meshId);
    
    // Convert messages to OpenAI-compatible format
    const openaiMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    // Use Cloudflare Workers AI via OpenAI-compatible API
    // Format matches OpenAI chat completions API
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: CLOUDFLARE_MODEL,
        messages: openaiMessages
      },
      {
        headers: {
          "Authorization": `Bearer ${CLOUDFLARE_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );
    
    if (response.status !== 200) {
      throw new Error(`API returned status ${response.status}`);
    }
    
    const aiResponse = response.data?.choices?.[0]?.message?.content;
    
    if (!aiResponse) {
      return null;
    }
    
    // Add AI response to thread history
    addMessage(meshId, "assistant", aiResponse);
    
    return aiResponse;
  } catch (error: any) {
    console.error(`Error getting AI response for mesh ${meshId}:`, error);
    return null;
  }
}

/**
 * Clear thread history for a mesh
 */
export function clearThread(meshId: string): void {
  threadCache.delete(meshId);
}

