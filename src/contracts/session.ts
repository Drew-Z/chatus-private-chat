export type SessionKind = "guest" | "member";

type BaseSession = {
  id: string;
  label: string;
  createdAt: number;
  lastSeen: number;
  expiresAt: number;
};

export type MemberSession = BaseSession & {
  kind: "member";
  principalId: string;
  rootInstanceName: string;
  userStateInstanceName: string;
  registryRevision: number;
};

export type LegacyMemberSession = BaseSession & {
  kind: "member";
};

export type GuestSession = BaseSession & {
  kind: "guest";
  sourceKey: string;
};

export type Session = MemberSession | GuestSession;
export type StoredSession = Session | LegacyMemberSession;
