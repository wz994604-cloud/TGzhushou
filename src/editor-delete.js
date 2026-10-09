// Quill embeds occupy one Delta unit; strings use UTF-16 code units.
// Segment the complete text so formatting runs cannot split a visible emoji.
export function deletionRange(ops, range) {
  const text = ops.map(op => typeof op.insert === 'string' ? op.insert : '\uFFFC').join('');
  const limit = Math.max(0, text.length - 1); // Keep Quill's terminal newline.
  const start = Math.min(limit, Math.max(0, range.index));
  const end = Math.min(limit, start + Math.max(0, range.length));
  const segments = [...new Intl.Segmenter(undefined, { granularity:'grapheme' }).segment(text.slice(0, limit))];
  if (end > start) {
    const first = segments.find(s => s.index + s.segment.length > start);
    const last = segments.find(s => s.index < end && s.index + s.segment.length >= end);
    return { index:first.index, length:last.index + last.segment.length - first.index };
  }
  if (start === 0) return { index:0, length:0 };
  const previous = segments.find(s => s.index < start && s.index + s.segment.length >= start);
  return previous ? { index:previous.index, length:previous.segment.length } : { index:start, length:0 };
}
