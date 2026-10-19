import { supabase } from '@/utils/supabase';

export type CommunityPerson = {
  id: string;
  username: string;
  displayName: string;
};

export type CommunityInvite = {
  id: string;
  person: CommunityPerson;
};

export type Community = {
  id: string;
  name: string;
  owned: boolean;
  owner: CommunityPerson;
  members: CommunityPerson[];
  invites: CommunityInvite[];
};

export type IncomingCommunityInvite = {
  id: string;
  communityId: string;
  communityName: string;
  from: CommunityPerson;
};

export type CommunityList = {
  membershipCount: number;
  communities: Community[];
  invites: IncomingCommunityInvite[];
  friends: CommunityPerson[];
};

const EMPTY_LIST: CommunityList = {
  membershipCount: 0,
  communities: [],
  invites: [],
  friends: [],
};

export async function listMyCommunities() {
  const { data, error } = await supabase.rpc('list_my_communities');
  if (error) {
    throw error;
  }
  return (data ?? EMPTY_LIST) as CommunityList;
}

export async function createCommunity(name: string) {
  const { error } = await supabase.rpc('create_community', { community_name: name });
  if (error) {
    throw error;
  }
}

export async function inviteToCommunity(communityId: string, friendId: string) {
  const { error } = await supabase.rpc('invite_to_community', {
    target_community: communityId,
    friend_id: friendId,
  });
  if (error) {
    throw error;
  }
}

export async function respondToCommunityInvite(inviteId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_to_community_invite', {
    target_invite: inviteId,
    accept,
  });
  if (error) {
    throw error;
  }
}

export async function leaveCommunity(communityId: string) {
  const { error } = await supabase.rpc('leave_community', { target_community: communityId });
  if (error) {
    throw error;
  }
}

export async function deleteCommunity(communityId: string) {
  const { error } = await supabase.rpc('delete_community', { target_community: communityId });
  if (error) {
    throw error;
  }
}
