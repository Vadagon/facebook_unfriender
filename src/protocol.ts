export const BRIDGE = {
  probeSession: "PANEL_SESSION_PROBE",
  fetchFriendPage: "FRIEND_PAGE_FETCH",
  removeFriend: "FRIEND_REMOVE_COMMIT",
  readEntitlement: "ENTITLEMENT_READ",
  verifyEntitlement: "ENTITLEMENT_VERIFY",
  launchCheckout: "CHECKOUT_LAUNCH",
  launchReview: "REVIEW_LAUNCH",
  submitDiagnostic: "DIAGNOSTIC_SUBMIT",
  openFacebookFriends: "FACEBOOK_FRIENDS_OPEN",
  entitlementUpdated: "ENTITLEMENT_UPDATED"
} as const;

export const VAULT = {
  preferences: "friend_sweep_v2_preferences",
  roster: "friend_sweep_v2_roster",
  entitlement: "friend_sweep_v2_entitlement",
  dailyMeter: "friend_sweep_v2_daily_meter",
  reviewSeen: "friend_sweep_v2_review_seen"
} as const;

export type FriendRecord = {
  id: string;
  name: string;
  url: string;
  avatar?: string;
  meta?: string;
  handle?: string;
};

export type Entitlement = {
  unlimited: boolean;
  used: number;
  limit: number;
  remaining: number;
};

export type RosterCache = {
  version: number;
  accountId: string;
  friends: FriendRecord[];
  cursor: string | null;
  hasMore: boolean;
  updatedAt: number;
};

export async function askWorker<T = Record<string, unknown>>(
  message: Record<string, unknown>
): Promise<T | null> {
  return chrome.runtime.sendMessage(message).catch(() => null) as Promise<T | null>;
}
