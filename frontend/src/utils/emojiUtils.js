export const textToEmoji = (text) => {
  if (!text) return '';

  const emojiMap = {
    ':)': '🙂',
    ':-)': '🙂',
    ':D': '😃',
    ':-D': '😃',
    ':(': '🙁',
    ':-(': '🙁',
    ':P': '😛',
    ':-P': '😛',
    ';)': '😉',
    ';-)': '😉',
    ':O': '😮',
    ':-O': '😮',
    '<3': '❤️',
    ':|': '😐',
    ':/': '😕'
  };

  // Create a regex pattern that matches any of the keys
  // We escape special characters in the keys and join them with OR
  // Sort by length specific first to avoid partial matches (e.g. :-) vs :) )
  const pattern = Object.keys(emojiMap)
    .sort((a, b) => b.length - a.length)
    .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  const regex = new RegExp(pattern, 'g');

  return text.replace(regex, (match) => emojiMap[match]);
};
