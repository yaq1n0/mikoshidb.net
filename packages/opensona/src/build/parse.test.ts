import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, parseDump } from "./parse.ts";

describe("slugify()", () => {
  it("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(slugify("Night City")).toBe("night-city");
    expect(slugify("V's Apartment")).toBe("v-s-apartment");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(slugify("---Hello   World!!!---")).toBe("hello-world");
  });

  it("returns empty string for input that has no alphanumerics", () => {
    expect(slugify("!!! ---")).toBe("");
  });
});

const DUMP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" xml:lang="en">
  <page>
    <title>Arasaka</title>
    <ns>0</ns>
    <revision>
      <text>${"Arasaka is a megacorporation. ".repeat(20)}

== History ==

${"It was founded long ago. ".repeat(20)}

[[Category:Corporations]]</text>
    </revision>
  </page>
  <page>
    <title>Old Redirect</title>
    <ns>0</ns>
    <redirect />
    <revision>
      <text>#REDIRECT [[Arasaka]]</text>
    </revision>
  </page>
  <page>
    <title>User talk:Someone</title>
    <ns>3</ns>
    <revision>
      <text>${"talk page body ".repeat(20)}</text>
    </revision>
  </page>
  <page>
    <title>Quest:Do The Thing</title>
    <ns>0</ns>
    <revision>
      <text>${"Quest body text. ".repeat(20)}</text>
    </revision>
  </page>
  <page>
    <title>Tiny</title>
    <ns>0</ns>
    <revision>
      <text>Too short</text>
    </revision>
  </page>
</mediawiki>
`;

// Three articles whose titles all slugify to "night-city"
const DUPLICATE_SLUG_DUMP = `<?xml version="1.0" encoding="UTF-8"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" xml:lang="en">
  <page>
    <title>Night City</title>
    <ns>0</ns>
    <revision>
      <text>${"Night City is a megacity in the Free State of California. ".repeat(4)}
[[Category:Locations]]</text>
    </revision>
  </page>
  <page>
    <title>Night-City</title>
    <ns>0</ns>
    <revision>
      <text>${"Night-City alternate article about the same Californian city. ".repeat(4)}
[[Category:Locations]]</text>
    </revision>
  </page>
  <page>
    <title>night city</title>
    <ns>0</ns>
    <revision>
      <text>${"night city lowercase version describing the same urban sprawl. ".repeat(4)}
[[Category:Locations]]</text>
    </revision>
  </page>
</mediawiki>
`;

// One article for each SKIP_CATEGORY_PREFIXES entry + Quest: title
const SKIP_CATEGORIES_DUMP = `<?xml version="1.0" encoding="UTF-8"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" xml:lang="en">
  <page>
    <title>Arasaka (disambiguation)</title>
    <ns>0</ns>
    <revision>
      <text>${"Arasaka may refer to any of the following articles listed below. ".repeat(4)}
[[Category:Disambiguation pages]]</text>
    </revision>
  </page>
  <page>
    <title>Short Stub</title>
    <ns>0</ns>
    <revision>
      <text>${"This is a stub article about a minor character in Night City. ".repeat(4)}
[[Category:Stub articles]]</text>
    </revision>
  </page>
  <page>
    <title>Real World Info</title>
    <ns>0</ns>
    <revision>
      <text>${"This article contains real world production information about the game. ".repeat(4)}
[[Category:Real World content]]</text>
    </revision>
  </page>
  <page>
    <title>Behind the Scenes</title>
    <ns>0</ns>
    <revision>
      <text>${"This article contains behind the scenes development content. ".repeat(4)}
[[Category:Behind the Scenes content]]</text>
    </revision>
  </page>
  <page>
    <title>Gameplay Mechanics</title>
    <ns>0</ns>
    <revision>
      <text>${"Gameplay mechanics describe how the player interacts with the world. ".repeat(4)}
[[Category:Gameplay mechanics]]</text>
    </revision>
  </page>
  <page>
    <title>Quest:Do The Thing</title>
    <ns>0</ns>
    <revision>
      <text>${"Quest body text describing objectives and rewards for this mission. ".repeat(4)}
[[Category:Quests]]</text>
    </revision>
  </page>
</mediawiki>
`;

describe("parseDump()", () => {
  it("yields only ns=0, non-redirect, non-skipped, non-trivial articles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-dump-"));
    const path = join(dir, "dump.xml");
    await writeFile(path, DUMP_XML);
    try {
      const articles = await parseDump(path);
      expect(articles).toHaveLength(1);
      const a = articles[0];
      expect(a.title).toBe("Arasaka");
      expect(a.slug).toBe("arasaka");
      expect(a.categories).toContain("Corporations");
      expect(a.sections.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("populates rawText on sections for requested titles only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-dump-"));
    const path = join(dir, "dump.xml");
    await writeFile(path, DUMP_XML);
    try {
      const articles = await parseDump(path, new Set(["Arasaka"]));
      const arasaka = articles.find((a) => a.title === "Arasaka")!;
      const hasRaw = arasaka.sections.some(
        (s) => typeof s.rawText === "string" && s.rawText.length > 0,
      );
      expect(hasRaw).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("appends -1 and -2 suffixes for duplicate slugs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-dup-"));
    const path = join(dir, "dump.xml");
    await writeFile(path, DUPLICATE_SLUG_DUMP);
    try {
      const articles = await parseDump(path);
      expect(articles).toHaveLength(3);
      const slugs = articles.map((a) => a.slug).sort();
      expect(slugs).toContain("night-city");
      expect(slugs).toContain("night-city-1");
      expect(slugs).toContain("night-city-2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops articles matching every SKIP_CATEGORY_PREFIXES entry and Quest: title prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-skip-"));
    const path = join(dir, "dump.xml");
    await writeFile(path, SKIP_CATEGORIES_DUMP);
    try {
      const articles = await parseDump(path);
      // All 6 articles in SKIP_CATEGORIES_DUMP should be dropped
      expect(articles).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parses pages whose <text> body is wrapped in a CDATA section", async () => {
    const body =
      "Arasaka is a megacorporation. ".repeat(20) +
      "\n\n== History ==\n\n" +
      "It was founded long ago. ".repeat(20) +
      "\n\n[[Category:Corporations]]";
    // CDATA content must not contain "]]>" — we only use plain prose and wiki links.
    const cdataDump =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" xml:lang="en">\n` +
      `  <page>\n` +
      `    <title>Arasaka</title>\n` +
      `    <ns>0</ns>\n` +
      `    <revision>\n` +
      `      <text><![CDATA[${body}]]></text>\n` +
      `    </revision>\n` +
      `  </page>\n` +
      `</mediawiki>\n`;

    const dir = await mkdtemp(join(tmpdir(), "opensona-cdata-"));
    const path = join(dir, "dump.xml");
    await writeFile(path, cdataDump);
    try {
      const articles = await parseDump(path);
      expect(articles).toHaveLength(1);
      expect(articles[0].title).toBe("Arasaka");
      expect(articles[0].categories).toContain("Corporations");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects when the dump XML is malformed (SAX error)", async () => {
    const malformed = `<?xml version="1.0" encoding="UTF-8"?>\n<mediawiki><page><title>Broken</title>`;
    const dir = await mkdtemp(join(tmpdir(), "opensona-bad-"));
    const path = join(dir, "dump.xml");
    await writeFile(path, malformed);
    try {
      await expect(parseDump(path)).rejects.toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
