import React from 'react';
import { hueFromName, initialsFromName } from '../../utils/avatar';
import './Avatar.css';

/** Initials on a username-derived colour, optional online dot. size: sm | md | lg | xl */
export const Avatar = ({ name, size = 'md', online = null, isGroup = false, className = '' }) => (
  <span
    className={`avatar avatar--${size} ${className}`.trim()}
    style={{ '--avatar-hue': hueFromName(name) }}
    data-testid="avatar"
  >
    <span className="avatar-initials" aria-hidden="true">
      {isGroup ? '#' : initialsFromName(name)}
    </span>
    {online !== null && (
      <span className={`avatar-dot ${online ? 'avatar-dot--online' : ''}`} data-online={online ? 'true' : 'false'} />
    )}
  </span>
);
