export interface Engram {
  id: string;
  displayName: string;
  handle: string;
  era: string;
  bio: string;
  /**
   * Long-form system prompt that sets voice, era, known relationships, and
   * explicit knowledge cut-off points (engrams are frozen snapshots).
   */
  systemPrompt: string;
  /**
   * Timeline event ID used as RAG temporal cutoff.
   * Chunks with latestEventOrder > this event's order are excluded from retrieval.
   * Set after running `rag:prebuild` — IDs come from the generated timeline.
   */
  cutoffEventId: string;
  /** Tags to exclude from RAG results (e.g. "phantom-liberty" for pre-DLC engrams). */
  excludeTags?: string[];
}
