export function fetchRules(options?: {
  root?: string;
  token?: string;
  get?: (url: string, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}): Promise<number>;
