export type UserRole = 'admin' | 'karyawan' | 'umum' | 'leader' | 'super_admin';

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  full_name?: string;
  created_at: string;
  updated_at: string;
  tiktok_username?: string | null;
  instagram_username?: string | null;
  youtube_channel_id?: string | null;
  extra_tiktok_usernames?: string[];
  extra_instagram_usernames?: string[];
  extra_youtube_channel_ids?: string[];
}

export interface SocialMetrics {
  id: string;
  user_id: string;
  platform: 'tiktok' | 'instagram' | 'youtube';
  username: string;
  likes: number;
  views: number;
  comments: number;
  saves: number;
  video_title?: string;
  video_url?: string;
  created_at: string;
  updated_at: string;
  video_posted_at: string;
}

export interface DashboardData {
  username: string;
  user_role: UserRole;
  metrics: {
    tiktok: SocialMetrics[];
  };
}

// Aggregated metrics shape returned by /api/get-metrics for dashboard
export interface DashboardMetrics {
  tiktok_followers: number;
  tiktok_likes: number;
  last_updated?: string;
}

// Campaign types
export interface Campaign {
  id: string;
  name: string;
  heads?: string[]; // Head user names
  start_date: string; // ISO
  end_date?: string | null; // ISO
  created_at: string;
  updated_at: string;
}

export interface CampaignParticipant {
  id: string;
  campaign_id: string;
  user_id?: string | null;
  tiktok_username: string; // normalized
  created_at: string;
}

export type Interval = 'daily' | 'weekly' | 'monthly';

export interface TimeSeriesPoint {
  date: string; // ISO date (start of interval)
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface CampaignMetricsResponse {
  interval: Interval;
  start_date: string;
  end_date: string;
  totals: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  };
  series: TimeSeriesPoint[];
  participants: Array<{ username: string; views: number; likes: number; comments: number; shares: number; saves: number }>;
}
