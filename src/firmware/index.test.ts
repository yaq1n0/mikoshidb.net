import { describe, expect, it } from "vitest";
import { findFirmware, firmware } from "@/firmware";

describe("firmware catalog", () => {
  it("has three entries with well-formed mlcModelIds and positive sizes", () => {
    expect(firmware).toHaveLength(3);
    for (const f of firmware) {
      expect(f.mlcModelId).toMatch(/^[A-Za-z0-9._-]+-MLC$/);
      expect(f.approxSizeMB).toBeGreaterThan(0);
    }
  });

  it("findFirmware returns a matching record or undefined", () => {
    expect(findFirmware("kiroshi-streetdoc")?.id).toBe("kiroshi-streetdoc");
    expect(findFirmware("??")).toBeUndefined();
  });
});
