import { describe, it, expect } from "vitest";
import { normalize, softNormalize, buildAliasMap, resolveAlias } from "./aliases.ts";
import type { ParsedArticle, Redirect } from "./parse.ts";

const article = (over: Partial<ParsedArticle>): ParsedArticle => ({
  title: "Default",
  slug: "default",
  sections: [],
  categories: [],
  links: [],
  infobox: {},
  ...over,
});

describe("normalize()", () => {
  it("lowercases and strips punctuation/spacing", () => {
    expect(normalize("Jack O'Lantern")).toBe("jackolantern");
  });

  it("is idempotent", () => {
    const once = normalize("V (Protagonist)");
    expect(normalize(once)).toBe(once);
  });

  it("maps empty string to empty string", () => {
    expect(normalize("")).toBe("");
  });

  it("collapses runs of non-alphanumerics", () => {
    expect(normalize("a---b___c")).toBe("abc");
  });

  it("strips unicode letters (non-ASCII dropped)", () => {
    expect(normalize("Café")).toBe("caf");
  });
});

describe("softNormalize()", () => {
  it("lowercases, preserves spacing, trims", () => {
    expect(softNormalize("  Hello World  ")).toBe("hello world");
  });

  it("collapses runs of whitespace", () => {
    expect(softNormalize("a   b\t\tc")).toBe("a b c");
  });

  it("preserves unicode letters", () => {
    expect(softNormalize("Café Noir")).toBe("café noir");
  });

  it("replaces punctuation with spaces and collapses", () => {
    expect(softNormalize("V.T.R.-unit")).toBe("v t r unit");
  });
});

describe("buildAliasMap()", () => {
  it("registers three variants per article title", () => {
    const a = article({ title: "Johnny Silverhand", slug: "johnny-silverhand" });
    const { map } = buildAliasMap([a], []);
    expect(map.get("johnny silverhand")).toBe("johnny-silverhand");
    expect(map.get("johnnysilverhand")).toBe("johnny-silverhand");
    expect(map.get(softNormalize("Johnny Silverhand"))).toBe("johnny-silverhand");
  });

  it("resolves redirects to a known article target", () => {
    const a = article({ title: "V", slug: "v" });
    const redirects: Redirect[] = [{ from: "The Merc", to: "V" }];
    const { map, unresolvedRedirects } = buildAliasMap([a], redirects);
    expect(map.get("the merc")).toBe("v");
    expect(unresolvedRedirects).toBe(0);
  });

  it("increments unresolvedRedirects for dangling redirects", () => {
    const a = article({ title: "V", slug: "v" });
    const { unresolvedRedirects } = buildAliasMap([a], [{ from: "Ghost", to: "Nonexistent" }]);
    expect(unresolvedRedirects).toBe(1);
  });

  it("first write wins on collisions (setIfEmpty)", () => {
    const a = article({ title: "V", slug: "v" });
    const b = article({ title: "V", slug: "v-2" });
    const { map } = buildAliasMap([a, b], []);
    expect(map.get("v")).toBe("v");
  });

  it("splits infobox list fields on , ; • and newline", () => {
    const a = article({
      title: "V",
      slug: "v",
      infobox: { aliases: "Vincent, Valerie; Val • Vee\nV-money" },
    });
    const { map } = buildAliasMap([a], []);
    expect(map.get("vincent")).toBe("v");
    expect(map.get("valerie")).toBe("v");
    expect(map.get("val")).toBe("v");
    expect(map.get("vee")).toBe("v");
    expect(map.get("v money")).toBe("v"); // softNormalize maps - to space
    expect(map.get("vmoney")).toBe("v"); // normalize strips -
  });

  it("drops empty/whitespace infobox pieces", () => {
    const a = article({
      title: "V",
      slug: "v",
      infobox: { name: "   ,   ; Valid" },
    });
    const { map } = buildAliasMap([a], []);
    expect(map.get("valid")).toBe("v");
    // Whitespace-only piece should not be a key.
    expect(map.has("")).toBe(false);
  });

  it("walks all configured infobox list fields", () => {
    const a = article({
      title: "V",
      slug: "v",
      infobox: {
        name: "VFromName",
        aliases: "VFromAliases",
        fullname: "VFromFullname",
        realname: "VFromRealname",
        handle: "VFromHandle",
      },
    });
    const { map } = buildAliasMap([a], []);
    expect(map.get("vfromname")).toBe("v");
    expect(map.get("vfromaliases")).toBe("v");
    expect(map.get("vfromfullname")).toBe("v");
    expect(map.get("vfromrealname")).toBe("v");
    expect(map.get("vfromhandle")).toBe("v");
  });
});

describe("resolveAlias()", () => {
  it("tries lower → soft → aggressive, in that order", () => {
    const aliases = new Map<string, string>([
      ["johnny silverhand", "johnny-silverhand"],
      ["johnnysilverhand", "johnny-silverhand"],
    ]);
    expect(resolveAlias("Johnny Silverhand", aliases)).toBe("johnny-silverhand");
    expect(resolveAlias("Johnny-Silverhand!", aliases)).toBe("johnny-silverhand");
  });

  it("returns null when no variant matches", () => {
    const aliases = new Map<string, string>([["v", "v"]]);
    expect(resolveAlias("unknown", aliases)).toBeNull();
  });
});
