import React from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { useTheme } from '../../contexts/ThemeContext';
import './EmojiPicker.css';

/** emoji-mart themed from tokens (see EmojiPicker.css). `fluid` fills its container (phones). */
export const EmojiPicker = ({ onSelect, fluid = false, skinTone = true }) => {
  const { colorScheme } = useTheme();
  return (
    <div className={`emoji-picker-host ${fluid ? 'emoji-picker-host--fluid' : ''}`} data-testid="emoji-picker">
      <Picker
        data={data}
        theme={colorScheme}
        onEmojiSelect={onSelect}
        previewPosition="none"
        skinTonePosition={skinTone ? 'search' : 'none'}
        dynamicWidth={fluid}
        maxFrequentRows={2}
      />
    </div>
  );
};
