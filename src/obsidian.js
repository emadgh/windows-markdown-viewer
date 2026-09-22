const WIKI_LINK_PREFIX = "#obsidian:";

function splitAlias(inner) {
  let escaped = false;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      return [inner.slice(0, index), inner.slice(index + 1)];
    }
  }
  return [inner, ""];
}

function defaultLabel(target) {
  const withoutFragment = target.split("#", 1)[0];
  const name = withoutFragment.split(/[\\/]/).pop() || withoutFragment;
  return name.replace(/\.(?:md|markdown)$/i, "") || target;
}

function escapeLabel(label) {
  return label.replace(/([\\\[\]])/g, "\\$1");
}

export function obsidianLinkHref(target) {
  return `${WIKI_LINK_PREFIX}${encodeURIComponent(target)}`;
}

export function parseObsidianHref(href) {
  if (!href.startsWith(WIKI_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_LINK_PREFIX.length));
  } catch {
    return href.slice(WIKI_LINK_PREFIX.length);
  }
}

function protect(source, pattern, protectedBlocks) {
  return source.replace(pattern, (block) => {
    const token = `\uE000${protectedBlocks.length}\uE001`;
    protectedBlocks.push(block);
    return token;
  });
}

/** Convert Obsidian wiki links to safe Markdown links while leaving code intact. */
export function rewriteObsidianLinks(markdown) {
  const protectedBlocks = [];
  let output = protect(
    markdown,
    /(^|\r?\n)[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*?(?:\r?\n[ \t]{0,3}\2[ \t]*(?:\r?\n|$)|$)/g,
    protectedBlocks,
  );
  output = protect(output, /`+[^`\r\n]*`+/g, protectedBlocks);
  output = output.replace(/\[\[([^\]\r\n]+?)\]\]/g, (match, inner, offset, whole) => {
    if (offset > 0 && (whole[offset - 1] === "!" || whole[offset - 1] === "\\")) return match;
    const [rawTarget, rawAlias] = splitAlias(inner);
    const target = rawTarget.trim();
    if (!target) return match;
    const alias = rawAlias.trim() || defaultLabel(target);
    return `[${escapeLabel(alias)}](${obsidianLinkHref(target)})`;
  });
  return output.replace(/\uE000(\d+)\uE001/g, (_, index) => protectedBlocks[Number(index)]);
}