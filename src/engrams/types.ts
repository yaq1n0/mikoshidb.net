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
}
