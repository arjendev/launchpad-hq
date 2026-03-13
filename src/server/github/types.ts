export interface GitHubUser {
  login: string;
  avatarUrl: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user: GitHubUser | null;
}

export interface AuthState {
  token: string;
  user: GitHubUser;
}
