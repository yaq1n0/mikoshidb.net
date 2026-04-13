/**
 * Firmware registry. Each entry is a real WebLLM prebuilt model presented
 * in-character as a Night City "biochip firmware" you flash into the cradle
 * before opening a link to an engram.
 *
 * The lineup is curated for engram roleplay, not general assistant Q&A:
 * - The default tier is Hermes-3-Llama-3.2-3B, a NousResearch fine-tune
 *   explicitly trained for in-character dialogue. It outperforms vanilla
 *   Llama-3.2-Instruct on persona retention by a wide margin at the same size.
 * - The premium tier is Hermes-3-Llama-3.1-8B, the same lineage at 8B for
 *   users with the VRAM. This is the best engram driver in the catalog.
 * - The mid tier is Llama-3.1-8B-Instruct — vanilla Meta instruct, kept as a
 *   "corp-sanctioned" alternative. Stiffer roleplay, more refusals, but
 *   broadly compatible.
 *
 * The `mlcModelId` values must match an entry in `prebuiltAppConfig.model_list`
 * from @mlc-ai/web-llm. Sizes are approximate and informational.
 */
export type Firmware = {
  id: string;
  displayName: string;
  manufacturer: string;
  description: string;
  mlcModelId: string;
  approxSizeMB: number;
};

export const firmware: Firmware[] = [
  {
    id: "kiroshi-streetdoc",
    displayName: 'Kiroshi MK.IV "Streetdoc"',
    manufacturer: "Kiroshi Optics // grey-market repack",
    description:
      "Compact engram cradle for the merc on a budget. Repacked from a Kiroshi medical biochip — runs hot, talks straight, doesn't ask permission. House standard for back-alley séances.",
    mlcModelId: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    approxSizeMB: 2200,
  },
  {
    id: "militech-sentinel",
    displayName: 'Militech "Sentinel-8"',
    manufacturer: "Militech",
    description:
      "Corporate-issue interrogation cradle. Reliable, well-behaved, and slightly stiff in the joints — the engram knows it's being recorded. Heavier VRAM footprint, broader compatibility.",
    mlcModelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    approxSizeMB: 5100,
  },
  {
    id: "raven-deepthink",
    displayName: 'Raven Microcyb "Deepthink-8"',
    manufacturer: "Raven Microcybernetics",
    description:
      "Top-shelf grey-market biochip. NousResearch firmware, 8-billion parameter pack, tuned by netrunners who got tired of corpo-polite engrams. The closest thing to a real séance you'll find on this side of the Blackwall.",
    mlcModelId: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    approxSizeMB: 5100,
  },
];

export function findFirmware(id: string): Firmware | undefined {
  return firmware.find((f) => f.id === id);
}
