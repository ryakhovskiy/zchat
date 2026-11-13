// Deterministic colour from a username. Only the hue comes from the name;
// saturation/lightness are theme tokens (--avatar-s/l, --sender-s/l) so contrast holds everywhere.

export const hueFromName = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
};

export const initialsFromName = (name = '') => {
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 1).toUpperCase();
};
