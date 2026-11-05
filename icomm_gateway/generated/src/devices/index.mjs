import reselec3 from './reselec3.mjs';

const profiles = new Map([[reselec3.id, reselec3]]);
export function getProfile(id) {
  const profile = profiles.get(id);
  if (!profile) throw new Error(`Unknown device profile: ${id}`);
  return profile;
}
