/**
 * State message models for Rave API
 */

import { MeshStateModel } from './mesh';

export interface UserState {
  userId: number;
  whenJoined?: number;
  isLeader?: boolean;
  order?: number;
  voipEnabled?: boolean;
}

export interface Vote {
  url: string;
  users: Record<string, any>[];
  numVotes?: number;
  oldestVoteTime?: number;
  order?: number;
}

export interface StateMessage {
  meshState?: MeshStateModel;
  users: UserState[];
  votes: Vote[];
  likeskips: Record<string, any>[];
  kicks: Record<string, any>[];
  clearedVotes: Record<string, any>[];
  voteOriginator?: number;
  metadata?: Record<string, any>;
}

export class UserStateModel {
  userId: number;
  whenJoined?: number;
  isLeader?: boolean;
  order?: number;
  voipEnabled?: boolean;

  constructor(data: Partial<UserState>) {
    this.userId = data.userId || 0;
    this.whenJoined = data.whenJoined;
    this.isLeader = data.isLeader;
    this.order = data.order;
    this.voipEnabled = data.voipEnabled;
  }

  static fromDict(data: Record<string, any>): UserStateModel {
    return new UserStateModel({
      userId: data.user_id,
      whenJoined: data.when_joined,
      isLeader: data.is_leader,
      order: data.order,
      voipEnabled: data.voip_enabled
    });
  }

  toDict(): Record<string, any> {
    const result: Record<string, any> = { user_id: this.userId };
    if (this.whenJoined !== undefined) result.when_joined = this.whenJoined;
    if (this.isLeader !== undefined) result.is_leader = this.isLeader;
    if (this.order !== undefined) result.order = this.order;
    if (this.voipEnabled !== undefined) result.voip_enabled = this.voipEnabled;
    return result;
  }
}

export class VoteModel {
  url: string;
  users: Record<string, any>[];
  numVotes?: number;
  oldestVoteTime?: number;
  order?: number;

  constructor(data: Partial<Vote>) {
    this.url = data.url || '';
    this.users = data.users || [];
    this.numVotes = data.numVotes;
    this.oldestVoteTime = data.oldestVoteTime;
    this.order = data.order;
  }

  static fromDict(data: Record<string, any>): VoteModel {
    return new VoteModel({
      url: data.url || '',
      users: data.users || [],
      numVotes: data.num_votes,
      oldestVoteTime: data.oldest_vote_time,
      order: data.order
    });
  }

  toDict(): Record<string, any> {
    const result: Record<string, any> = {
      url: this.url,
      users: this.users
    };
    if (this.numVotes !== undefined) result.num_votes = this.numVotes;
    if (this.oldestVoteTime !== undefined) result.oldest_vote_time = this.oldestVoteTime;
    if (this.order !== undefined) result.order = this.order;
    return result;
  }
}

export class StateMessageModel {
  meshState?: MeshStateModel;
  users: UserStateModel[];
  votes: VoteModel[];
  likeskips: Record<string, any>[];
  kicks: Record<string, any>[];
  clearedVotes: Record<string, any>[];
  voteOriginator?: number;
  metadata?: Record<string, any>;

  constructor(data: Partial<StateMessage> = {}) {
    this.meshState = data.meshState;
    this.users = data.users?.map(u => new UserStateModel(u)) || [];
    this.votes = data.votes?.map(v => new VoteModel(v)) || [];
    this.likeskips = data.likeskips || [];
    this.kicks = data.kicks || [];
    this.clearedVotes = data.clearedVotes || [];
    this.voteOriginator = data.voteOriginator;
    this.metadata = data.metadata;
  }

  static fromDict(data: Record<string, any>): StateMessageModel {
    let meshState: MeshStateModel | undefined;
    if (data.mesh_state) {
      meshState = MeshStateModel.fromDict(data.mesh_state);
    }

    const users = (data.users || []).map((u: Record<string, any>) => UserStateModel.fromDict(u));
    const votes = (data.votes || []).map((v: Record<string, any>) => VoteModel.fromDict(v));

    return new StateMessageModel({
      meshState,
      users: users.map((u: UserStateModel) => ({
        userId: u.userId,
        whenJoined: u.whenJoined,
        isLeader: u.isLeader,
        order: u.order,
        voipEnabled: u.voipEnabled
      })),
      votes: votes.map((v: VoteModel) => ({
        url: v.url,
        users: v.users,
        numVotes: v.numVotes,
        oldestVoteTime: v.oldestVoteTime,
        order: v.order
      })),
      likeskips: data.likeskips || [],
      kicks: data.kicks || [],
      clearedVotes: data.cleared_votes || [],
      voteOriginator: data.vote_originator,
      metadata: data.__metadata
    });
  }

  toDict(): Record<string, any> {
    const result: Record<string, any> = {
      users: this.users.map(u => u.toDict()),
      votes: this.votes.map(v => v.toDict()),
      likeskips: this.likeskips,
      kicks: this.kicks,
      cleared_votes: this.clearedVotes
    };
    if (this.meshState !== undefined) {
      result.mesh_state = this.meshState.toDict();
    }
    if (this.voteOriginator !== undefined) {
      result.vote_originator = this.voteOriginator;
    }
    if (this.metadata !== undefined) {
      result.__metadata = this.metadata;
    }
    return result;
  }
}

