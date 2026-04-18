export type ZoneStatus = 'safe' | 'warring' | 'dangerous';

export interface Zone {
  id: string;
  name: string;
  status: ZoneStatus;
  coordinates: { lat: number; lng: number }[];
  description: string;
  location?: string;
}

export interface Resource {
  id: string;
  type: 'shelter' | 'medical' | 'food' | 'water';
  name: string;
  lat: number;
  lng: number;
  description: string;
  location?: string;
  contact?: string;
}

export interface Poll {
  id: string;
  question: string;
  options: string[];
  createdAt: string;
  expiresAt: string;
  active: boolean;
}

export interface PollResponse {
  pollId: string;
  userId: string;
  optionIndex: number;
  timestamp: string;
}

export interface UserProfile {
  uid: string;
  fullName: string;
  idType: 'aadhar' | 'pan' | 'voter_id';
  idNumber: string;
  isVerified: boolean;
  familyMembers: FamilyMember[];
}

export interface FamilyMember {
  id: string;
  fullName: string;
  relation: string;
  idType: 'aadhar' | 'pan' | 'voter_id';
  idNumber: string;
  isVerified: boolean;
}
