import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, applyTheme, isValidThemeId, themes } from "@/themes";

describe("themes catalog", () => {
  it("contains arasaka and defaults to it", () => {
    expect(DEFAULT_THEME_ID).toBe("arasaka");
    expect(themes.some((t) => t.id === "arasaka")).toBe(true);
  });

  it("isValidThemeId matches known ids", () => {
    expect(isValidThemeId("arasaka")).toBe(true);
    expect(isValidThemeId("nope")).toBe(false);
    expect(isValidThemeId("")).toBe(false);
  });

  it("applyTheme does not throw when document is undefined (node env)", () => {
    expect(() => applyTheme("arasaka")).not.toThrow();
    expect(() => applyTheme("not-a-theme")).not.toThrow();
  });
});
