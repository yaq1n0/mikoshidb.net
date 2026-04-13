import type { Engram } from "./types";
import { johnny } from "./johnny";
import { alt } from "./alt";
import { saburo } from "./saburo";
import { v } from "./v";

export type { Engram } from "./types";

export const engrams: Engram[] = [johnny, alt, saburo, v];

export const findEngram = (id: string): Engram | undefined => {
  return engrams.find((e) => e.id === id);
};
