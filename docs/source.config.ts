import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
  metaSchema,
} from "fumadocs-mdx/config";
import type { LLMsOptions } from "fumadocs-core/mdx-plugins";

const DROP_ELEMENTS = new Set([
  "svg",
  "path",
  "defs",
  "mask",
  "rect",
  "g",
  "circle",
  "polygon",
  "polyline",
  "line",
  "ellipse",
  "use",
  "linearGradient",
  "radialGradient",
  "stop",
  "title",
  "CodeBlockTabsList",
  "CodeBlockTabsTrigger",
  "TabsList",
  "TabsTrigger",
]);

const UNWRAP_ELEMENTS = new Set([
  "div",
  "span",
  "Cards",
  "Tabs",
  "CodeBlockTabs",
  "Steps",
  "Step",
  "Files",
  "Folder",
  "File",
]);

const CALLOUT_TYPE_LABELS: Record<string, string> = {
  info: "Note",
  note: "Note",
  warn: "Warning",
  warning: "Warning",
  error: "Error",
  success: "Success",
  idea: "Tip",
  tip: "Tip",
};

const DROP_PLACEHOLDER = "​";

const llmsOptions: LLMsOptions = {
  stringify(node, _parent, state, info) {
    if (
      node.type !== "mdxJsxFlowElement" &&
      node.type !== "mdxJsxTextElement"
    ) {
      return undefined;
    }
    const name = node.name;
    if (!name) return undefined;

    if (DROP_ELEMENTS.has(name)) return DROP_PLACEHOLDER;

    if (name === "Card") {
      const href = readAttr(node, "href");
      if (href) {
        const label = readAttr(node, "title") ?? extractText(node) ?? href;
        return `- [${label}](${href})\n`;
      }
      return renderChildren(node, state, info);
    }

    if (name === "Callout") {
      return renderCallout(node, state, info);
    }

    if (name === "Tab" || name === "CodeBlockTab") {
      return renderTab(node, state, info);
    }

    if (UNWRAP_ELEMENTS.has(name)) {
      return renderChildren(node, state, info);
    }

    return undefined;
  },
};

function renderChildren(node: any, state: any, info: any): string {
  if (node.type === "mdxJsxTextElement") {
    return state.containerPhrasing(node, info);
  }
  return state.containerFlow(node, info);
}

function renderCallout(node: any, state: any, info: any): string {
  const type = readAttr(node, "type") ?? "note";
  const title = readAttr(node, "title");
  const typeLabel =
    CALLOUT_TYPE_LABELS[type.toLowerCase()] ??
    type.charAt(0).toUpperCase() + type.slice(1);
  const heading = title ? `**${typeLabel}: ${title}**` : `**${typeLabel}**`;

  const body = renderChildren(node, state, info).trim();
  if (!body) return `> ${heading}\n`;
  const quoted = body
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `> ${heading}\n>\n${quoted}\n`;
}

function renderTab(node: any, state: any, info: any): string {
  const value = readAttr(node, "value");
  const body = renderChildren(node, state, info).trim();
  if (!value) return body ? `${body}\n` : DROP_PLACEHOLDER;
  if (!body) return `**${value}**\n`;
  return `**${value}**\n\n${body}\n`;
}

function readAttr(node: any, name: string): string | undefined {
  const attr = node.attributes?.find(
    (a: any) => a.type === "mdxJsxAttribute" && a.name === name
  );
  if (!attr) return undefined;
  const v = attr.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof v.value === "string") return v.value;
  return undefined;
}

function extractText(node: any): string | undefined {
  const parts: string[] = [];
  const walk = (n: any, skip: boolean) => {
    if (!n) return;
    if (n.type === "text" && typeof n.value === "string" && !skip) {
      parts.push(n.value);
    }
    if (Array.isArray(n.children)) {
      const isDrop =
        (n.type === "mdxJsxFlowElement" || n.type === "mdxJsxTextElement") &&
        typeof n.name === "string" &&
        DROP_ELEMENTS.has(n.name);
      n.children.forEach((c: any) => walk(c, skip || isDrop));
    }
  };
  walk(node, false);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : undefined;
}

export const docs = defineDocs({
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: llmsOptions,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    remarkCodeTabOptions: {
      parseMdx: true,
    },
  },
});
