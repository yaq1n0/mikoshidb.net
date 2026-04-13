/**
 * Select the longest prefix of chunks that fits within a character budget.
 *
 * Why: on chat resume, the restored history is piled on top of a fresh
 * preamble each turn — unbounded preambles that "just fit" on turn 1 blow up
 * on turn 2. Capping at assembly time keeps both fresh-load and resume paths
 * inside the context window. The first chunk is always kept (even if it alone
 * exceeds the budget) so retrieval never silently returns empty.
 */
export const budgetChunks = <T extends { chunk: { header: string; text: string } }>(
  chunks: T[],
  budget: number,
): T[] => {
  const out: T[] = [];
  let total = 0;
  for (const c of chunks) {
    const cost = c.chunk.header.length + c.chunk.text.length + 1;
    if (out.length > 0 && total + cost > budget) break;
    out.push(c);
    total += cost;
  }
  return out;
};
