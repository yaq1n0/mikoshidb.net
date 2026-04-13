import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, parseDump, type ParseResult } from "./parse.ts";

describe("slugify()", () => {
  it("lowercases, replaces non-alnum with hyphens, collapses runs", () => {
    expect(slugify("Johnny Silverhand")).toBe("johnny-silverhand");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  --Hello World!--  ")).toBe("hello-world");
  });

  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("a   b___c")).toBe("a-b-c");
  });

  it("maps unicode / special chars to hyphens", () => {
    expect(slugify("Café")).toBe("caf");
  });

  it("maps empty string to empty string", () => {
    expect(slugify("")).toBe("");
  });
});

const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6);

const DUMP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mediawiki>
  <page>
    <title>Main Article</title>
    <ns>0</ns>
    <text>{{Infobox character
|name = Main Character
|aliases = MC, Mainer
}}
The [[Main Article]] is a protagonist in the [[Story]]. MC lives in [[Night City]]. ${LOREM}

==Background==
Background prose here about [[Johnny]]. ${LOREM}

[[Category:Characters]]</text>
  </page>
  <page>
    <title>MC</title>
    <ns>0</ns>
    <redirect title="Main Article"/>
    <text>#REDIRECT [[Main Article]]</text>
  </page>
  <page>
    <title>User:admin</title>
    <ns>2</ns>
    <text>user page content ignored</text>
  </page>
  <page>
    <title>Quest:Sample</title>
    <ns>0</ns>
    <text>${LOREM} ${LOREM}</text>
  </page>
  <page>
    <title>Short Page</title>
    <ns>0</ns>
    <text>Too short.</text>
  </page>
  <page>
    <title>Disambig Page</title>
    <ns>0</ns>
    <text>${LOREM} ${LOREM}[[Category:Disambiguations]]</text>
  </page>
  <page>
    <title>Stub Page</title>
    <ns>0</ns>
    <text>${LOREM} ${LOREM}[[Category:Stub articles]]</text>
  </page>
  <page>
    <title>Twin</title>
    <ns>0</ns>
    <text>${LOREM} ${LOREM}[[Category:Places]]</text>
  </page>
  <page>
    <title>Twin</title>
    <ns>0</ns>
    <text>${LOREM} ${LOREM}[[Category:Places]] Alt content.</text>
  </page>
</mediawiki>
`;

describe("parseDump()", () => {
  let dir: string;
  let dumpPath: string;
  let resultAll: ParseResult;
  let resultRaw: ParseResult;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "opensona-parse-"));
    dumpPath = join(dir, "dump.xml");
    await writeFile(dumpPath, DUMP_XML);
    resultAll = await parseDump(dumpPath);
    resultRaw = await parseDump(dumpPath, new Set(["Main Article"]));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses namespace-0 articles with categories, links, infobox, sections", () => {
    const main = resultAll.articles.find((a) => a.title === "Main Article");
    expect(main).toBeDefined();
    expect(main!.slug).toBe("main-article");
    expect(main!.categories).toContain("Characters");
    expect(main!.links.length).toBeGreaterThan(0);
    expect(main!.sections.length).toBeGreaterThan(0);
    expect(main!.infobox.name).toBeTruthy();
  });

  it("skips non-namespace-0 pages", () => {
    expect(resultAll.articles.find((a) => a.title.startsWith("User:"))).toBeUndefined();
  });

  it("records redirect pages into redirects[], not articles[]", () => {
    expect(resultAll.redirects).toEqual(
      expect.arrayContaining([{ from: "MC", to: "Main Article" }]),
    );
    expect(resultAll.articles.find((a) => a.title === "MC")).toBeUndefined();
  });

  it("drops pages with Quest: title prefix", () => {
    expect(resultAll.articles.find((a) => a.title.startsWith("Quest:"))).toBeUndefined();
  });

  it("drops pages in the Disambiguations exact category", () => {
    expect(resultAll.articles.find((a) => a.title === "Disambig Page")).toBeUndefined();
  });

  it("drops pages whose category starts with a skip prefix (Stub)", () => {
    expect(resultAll.articles.find((a) => a.title === "Stub Page")).toBeUndefined();
  });

  it("drops pages with bodies shorter than 200 chars", () => {
    expect(resultAll.articles.find((a) => a.title === "Short Page")).toBeUndefined();
  });

  it("disambiguates duplicate slugs with -1, -2 suffixes", () => {
    const twins = resultAll.articles.filter((a) => a.title === "Twin");
    expect(twins).toHaveLength(2);
    const slugs = twins.map((a) => a.slug).sort();
    expect(slugs).toEqual(["twin", "twin-1"]);
  });

  it("populates rawText only for titles listed in keepRawSections", () => {
    const main = resultRaw.articles.find((a) => a.title === "Main Article")!;
    const twin = resultRaw.articles.find((a) => a.title === "Twin")!;
    expect(main.sections.some((s) => typeof s.rawText === "string" && s.rawText.length > 0)).toBe(
      true,
    );
    expect(twin.sections.every((s) => s.rawText === undefined)).toBe(true);
  });
});
