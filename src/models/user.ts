/**
 * User model for Rave API
 */

export interface User {
  id: number;
  displayName?: string;
  handle?: string;
  online?: boolean;
}

export class UserModel {
  id: number;
  displayName?: string;
  handle?: string;
  online?: boolean;

  constructor(data: Partial<User>) {
    this.id = data.id || 0;
    this.displayName = data.displayName;
    this.handle = data.handle;
    this.online = data.online;
  }

  static fromDict(data: Record<string, any>): UserModel {
    return new UserModel({
      id: data.id,
      displayName: data.displayName,
      handle: data.handle,
      online: data.online
    });
  }

  toDict(): Record<string, any> {
    const result: Record<string, any> = { id: this.id };
    if (this.displayName !== undefined) result.displayName = this.displayName;
    if (this.handle !== undefined) result.handle = this.handle;
    if (this.online !== undefined) result.online = this.online;
    return result;
  }
}

