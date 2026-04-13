import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type { Firmware } from "./index";

export type LoadProgress = {
  progress: number; // 0..1
  text: string;
};

/**
 * Loads @mlc-ai/web-llm dynamically so the ~6MB runtime is not part of the
 * initial page bundle. The terminal is fully usable before this ever runs;
 * only `load firmware <id>` triggers the download.
 */
export const loadFirmware = async (
  firmware: Firmware,
  onProgress: (p: LoadProgress) => void,
): Promise<MLCEngineInterface> => {
  onProgress({ progress: 0, text: "fetching cradle runtime..." });
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  const engine = await CreateMLCEngine(firmware.mlcModelId, {
    initProgressCallback: (report) => {
      onProgress({
        progress: typeof report.progress === "number" ? report.progress : 0,
        text: report.text ?? "",
      });
    },
  });
  return engine;
};
