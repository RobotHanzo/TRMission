import { SERVER_ORIGIN } from './config';

export interface ForcedUpdate {
  mustUpdate: boolean;
  minBuild?: number;
}

/**
 * Ask the server for the minimum accepted build (GET /version/mobile — a health route at the server
 * root, outside /api/v1). Fails OPEN: a network hiccup must never lock a user out of the app.
 */
export async function checkForcedUpdate(build: number): Promise<ForcedUpdate> {
  try {
    const res = await fetch(`${SERVER_ORIGIN}/version/mobile`);
    if (!res.ok) return { mustUpdate: false };
    const data = (await res.json()) as { minBuild: number };
    return { mustUpdate: data.minBuild > build, minBuild: data.minBuild };
  } catch {
    return { mustUpdate: false };
  }
}
