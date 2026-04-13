/**
 * Very small command tokenizer. Splits on whitespace, respects double quotes
 * for multi-word args, and lowercases the leading command.
 */
export type ParsedCommand = {
  command: string;
  args: string[];
  raw: string;
};

export const parse = (input: string): ParsedCommand | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const tokens: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of trimmed) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (buf) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  if (tokens.length === 0) return null;

  return {
    command: tokens[0]!.toLowerCase(),
    args: tokens.slice(1),
    raw: trimmed,
  };
};
