// packages/opensona/src/build/pack-graph.ts
// Serialize a GraphArtifact to three gzipped JSON files + a manifest.

import { createHash } from "node:crypto";
import { gzipSync as zlibGzipSync } from "node:zlib";
import type { FileMeta, Manifest, OpensonaConfig, Timeline, TimelineMeta } from "../types.ts";
import type { GraphArtifact } from "./graph.ts";
import { countEdges } from "./graph.ts";

export type PackedFile = {
  path: string;
  data: Uint8Array;
  meta: FileMeta;
};

export type PackGraphResult = {
  manifest: Manifest;
  files: PackedFile[];
};

const sha256 = (bytes: Uint8Array): string => {
  return createHash("sha256").update(bytes).digest("hex");
};

const gzip = (text: string): Uint8Array => {
  return zlibGzipSync(Buffer.from(text, "utf-8"));
};

const adjacencyToObject = (map: Map<string, Set<string>>): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [k, v] of map) out[k] = [...v];
  return out;
};

const nodeMapToArray = <T>(map: Map<string, T>): T[] => {
  return [...map.values()];
};

export type PackGraphOptions = {
  timeline: Timeline;
  timelineMeta: TimelineMeta;
  config: OpensonaConfig;
};

export const packGraph = async (
  graph: GraphArtifact,
  options: PackGraphOptions,
): Promise<PackGraphResult> => {
  const { timeline, timelineMeta, config } = options;

  const nodesPayload = {
    articles: nodeMapToArray(graph.nodes.articles),
    sections: nodeMapToArray(graph.nodes.sections),
    categories: nodeMapToArray(graph.nodes.categories),
  };

  const edgesPayload = {
    links: adjacencyToObject(graph.edges.links),
    contains: adjacencyToObject(graph.edges.contains),
    inCategory: adjacencyToObject(graph.edges.inCategory),
    inEvent: adjacencyToObject(graph.edges.inEvent),
    mentions: adjacencyToObject(graph.edges.mentions),
  };

  const aliasesPayload: Record<string, string> = {};
  for (const [k, v] of graph.aliases) aliasesPayload[k] = v;

  const nodesBytes = gzip(JSON.stringify(nodesPayload));
  const edgesBytes = gzip(JSON.stringify(edgesPayload));
  const aliasesBytes = gzip(JSON.stringify(aliasesPayload));

  const files: PackedFile[] = [
    {
      path: "graph-nodes.json.gz",
      data: nodesBytes,
      meta: {
        path: "graph-nodes.json.gz",
        sizeBytes: nodesBytes.byteLength,
        sha256: sha256(nodesBytes),
      },
    },
    {
      path: "graph-edges.json.gz",
      data: edgesBytes,
      meta: {
        path: "graph-edges.json.gz",
        sizeBytes: edgesBytes.byteLength,
        sha256: sha256(edgesBytes),
      },
    },
    {
      path: "aliases.json.gz",
      data: aliasesBytes,
      meta: {
        path: "aliases.json.gz",
        sizeBytes: aliasesBytes.byteLength,
        sha256: sha256(aliasesBytes),
      },
    },
  ];

  const totalBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
  if (totalBytes > config.maxBundleBytes) {
    throw new Error(
      `Packed bundle is ${totalBytes} bytes, exceeding maxBundleBytes=${config.maxBundleBytes}`,
    );
  }

  const manifest: Manifest = {
    version: 2,
    retrieval: "graph",
    buildDate: new Date().toISOString(),
    source: config.source,
    license: config.license,
    graph: {
      sectionMaxChars: config.graph.sectionMaxChars,
      leadMaxChars: config.graph.leadMaxChars,
      deadLinkCount: graph.deadLinkCount,
    },
    counts: {
      articles: graph.nodes.articles.size,
      sections: graph.nodes.sections.size,
      categories: graph.nodes.categories.size,
      aliases: graph.aliases.size,
      edges: countEdges(graph.edges),
      events: graph.nodes.events.size,
    },
    timeline,
    timelineMeta,
    files: {
      nodes: files[0].meta,
      edges: files[1].meta,
      aliases: files[2].meta,
    },
  };

  return { manifest, files };
};
