import getUrls from 'get-urls';

/**
 * Detects URLs in text and converts them to markdown-style links
 * If URLs are already in markdown format [text](url), they are preserved
 * @param text The text that may contain URLs
 * @returns The text with plain URLs converted to markdown format
 */
export function linkifyText(text: string): string {
  if (!text) return text;

  // Process markdown-style links first: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const markdownLinks: Array<{
    index: number;
    length: number;
    text: string;
    url: string;
  }> = [];

  // Find all markdown links first
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    const [fullMatch, linkText, linkUrl] = match;
    markdownLinks.push({
      index: match.index,
      length: fullMatch.length,
      text: linkText,
      url: linkUrl,
    });
  }

  // Get all URLs from the text using get-urls
  const allUrls = Array.from(getUrls(text));

  // Filter out URLs that are part of markdown links
  const standaloneUrls = allUrls.filter((url) => {
    // Check if this URL is part of any markdown link
    return !markdownLinks.some((link) => link.url === url);
  });

  // Create a copy of the text that we'll modify
  let result = text;

  // Sort standalone URLs by length (descending) to avoid replacing parts of longer URLs
  const sortedUrls = [...standaloneUrls].sort((a, b) => b.length - a.length);

  // Replace each standalone URL with a markdown link
  for (const url of sortedUrls) {
    // Create a markdown link with the URL as both the text and the link
    const markdownLink = `[${url}](${url})`;

    // Replace all occurrences of the URL with the markdown link
    // But make sure we're not replacing inside an existing markdown link
    const regex = new RegExp(`(?<!!\\[.*?\\]\\(.*?)${escapeRegExp(url)}`, 'g');
    result = result.replace(regex, markdownLink);
  }

  return result;
}

/**
 * Escapes special characters in a string for use in a RegExp
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
