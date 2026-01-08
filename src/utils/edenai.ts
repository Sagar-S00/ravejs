/**
 * EdenAI Utilities for Rave Bot
 * Handles EdenAI Perplexity integration with group chat support
 */

import axios from 'axios';

// =========================
// CONFIG
// =========================

const EDENAI_API_KEY = process.env.EDENAI_API_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYjczNzMwZDEtMDQ1Ny00ZjJhLTljOGEtNzczMzIwZDZmMWNlIiwidHlwZSI6ImZyb250X2FwaV90b2tlbiJ9.Oqqk9Ihpee6iim5JuPVHr1vEaImqKYSfdiNo3jMoYVE";

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

// =========================
// EDENAI INTEGRATION
// =========================

/**
 * Get AI response using EdenAI streaming API for a given mesh.
 * 
 * @param meshId - The mesh/room ID to get response for
 * @returns AI-generated response text, or null if error
 */
export async function getResponse(meshId: string): Promise<string | null> {
    try {
        const messages = getThreadMessages(meshId);

        // Find the last user message from thread
        let currentUserInput: string | null = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "user") {
                currentUserInput = messages[i].content;
                break;
            }
        }

        if (!currentUserInput) {
            console.warn(`No user input found for mesh ${meshId}`);
            return null;
        }

        // Convert messages to EdenAI format (exclude system message and current user message)
        const previousHistory: Array<{ role: string; message: string }> = [];
        for (const msg of messages) {
            if (msg.role === "system") {
                continue;
            }
            if (msg.role === "user" && msg.content === currentUserInput) {
                continue;
            }
            previousHistory.push({
                role: msg.role,
                message: msg.content
            });
        }

        const headers = {
            'authority': 'api.edenai.run',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
            'authorization': `Bearer ${EDENAI_API_KEY}`,
            'content-type': 'application/json',
            'origin': 'https://app.edenai.run',
            'referer': 'https://app.edenai.run/',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        };

        const jsonData = {
            providers: "perplexityai",
            text: currentUserInput,
            temperature: 0.1,
            max_tokens: 1000,
            settings: {
                perplexityai: "sonar-pro"
            },
            previous_history: previousHistory,
            chatbot_global_action: SYSTEM_PROMPT,
            response_as_dict: false
        };

        const response = await axios.post(
            'https://api.edenai.run/v2/text/chat/stream',
            jsonData,
            {
                headers,
                responseType: 'stream',
                timeout: 60000
            }
        );

        if (response.status === 200) {
            let sentence = '';

            // Handle streaming response
            for await (const chunk of response.data as any) {
                const line = chunk.toString('utf8');
                if (line) {
                    try {
                        const responseData = JSON.parse(line);
                        const text = responseData.text || '';
                        sentence += text;
                    } catch (e) {
                        // Ignore JSON parse errors in stream
                    }
                }
            }

            const aiResponse = sentence;
            if (aiResponse) {
                addMessage(meshId, "assistant", aiResponse);
            }

            return aiResponse || null;
        } else {
            console.error(`EdenAI API returned status code ${response.status}`);
            return null;
        }
    } catch (error: any) {
        console.error(`Error getting streaming AI response for mesh ${meshId}:`, error);
        return null;
    }
}

/**
 * Clear thread history for a mesh
 */
export function clearThread(meshId: string): void {
    threadCache.delete(meshId);
}
