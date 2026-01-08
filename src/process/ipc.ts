/**
 * IPC Protocol Definitions
 * Message types and structures for parent-child process communication
 */

import { CredentialsData } from '../database/models';
import { WorkerStatus } from './types';

/**
 * Base IPC message structure
 */
export interface IPCMessage {
  type: 'command' | 'event' | 'status_request' | 'status_response';
  payload: any;
  timestamp: number;
  messageId?: string;
}

/**
 * Commands from parent to child
 */
export type ParentCommand =
  | { type: 'shutdown'; graceful: boolean }
  | { type: 'status_request' }
  | { type: 'restart_connection' }
  | { type: 'refresh_admins' }
  | { type: 'refresh_permissions' }
  | { type: 'refresh_credentials'; credentials: CredentialsData };

/**
 * Events from child to parent
 */
export type ChildEvent =
  | { type: 'ready'; meshId: string }
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'kicked'; meshId: string }
  | { type: 'connection_failed'; meshId: string; attempt: number }
  | { type: 'error'; error: string }
  | { type: 'status_response'; status: WorkerStatus }
  | { type: 'credentials_updated'; credentials: CredentialsData }
  | { type: 'refresh_requested' }
  | { type: 'intentional_leave'; meshId: string };

/**
 * Create IPC message
 */
export function createIPCMessage(
  type: IPCMessage['type'],
  payload: any,
  messageId?: string
): IPCMessage {
  return {
    type,
    payload,
    timestamp: Date.now(),
    messageId
  };
}

/**
 * Create command message
 */
export function createCommand(command: ParentCommand, messageId?: string): IPCMessage {
  return createIPCMessage('command', command, messageId);
}

/**
 * Create event message
 */
export function createEvent(event: ChildEvent, messageId?: string): IPCMessage {
  return createIPCMessage('event', event, messageId);
}

/**
 * Create status request
 */
export function createStatusRequest(messageId?: string): IPCMessage {
  return createIPCMessage('status_request', null, messageId);
}

/**
 * Create status response
 */
export function createStatusResponse(status: WorkerStatus, messageId?: string): IPCMessage {
  return createIPCMessage('status_response', status, messageId);
}

/**
 * Check if message is a command
 */
export function isCommand(message: any): message is IPCMessage {
  return message && message.type === 'command';
}

/**
 * Check if message is an event
 */
export function isEvent(message: any): message is IPCMessage {
  return message && message.type === 'event';
}

/**
 * Check if message is a status request
 */
export function isStatusRequest(message: any): message is IPCMessage {
  return message && message.type === 'status_request';
}

/**
 * Check if message is a status response
 */
export function isStatusResponse(message: any): message is IPCMessage {
  return message && message.type === 'status_response';
}

/**
 * Parse IPC message safely
 */
export function parseIPCMessage(data: any): IPCMessage | null {
  try {
    if (typeof data === 'object' && data.type && data.timestamp) {
      return data as IPCMessage;
    }
    return null;
  } catch {
    return null;
  }
}
