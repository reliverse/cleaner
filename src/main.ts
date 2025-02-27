#!/usr/bin/env bun
/**
 * Trash Cleaner
 *
 * A utility to clean unwanted entries from the array.
 * Usage: bun addons/trash-cleaner.ts [options]
 *
 * Options:
 *   --dry-run             Show what would be removed without making changes
 *   --backup              Create a backup of the original file
 *   --patterns <patterns> Comma-separated list of patterns to remove
 *   --file <path>         Path to the bang file (default: src/bang.test.ts)
 *   --help                Show this help message
 */

import fs from "fs-extra";
import MagicString from "magic-string";
import { parseArgs } from "node:util";
import path from "pathe";

// ANSI color codes for terminal output
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// Default configuration
const DEFAULT_CONFIG = {
  // Domains ending with or services containing these strings will be removed
  forbiddenPatterns: [
    ".ru",
    "russia",
    "russian",
    "russisch",
    "-russian",
    "yandex",
  ],
  // Path to the bang file, relative to cwd
  bangFilePath: "src/bang.test.ts",
  // Whether to create a backup of the original file
  createBackup: false,
  // Dry run mode - don't actually modify files
  dryRun: false,
};

// Parse command line arguments
export function parseCommandLineArgs() {
  try {
    // Create a copy of the default config
    const config = { ...DEFAULT_CONFIG };

    // For tests, we need to handle process.argv directly
    if (process.argv.includes("--dry-run")) {
      config.dryRun = true;
    }

    if (process.argv.includes("--backup")) {
      config.createBackup = true;
    }

    if (process.argv.includes("--help")) {
      showHelp();
      process.exit(0);
    }

    // Handle --file and --patterns arguments
    for (const arg of process.argv) {
      if (arg.startsWith("--file=")) {
        const filePath = arg.split("=")[1];
        if (filePath) {
          config.bangFilePath = filePath;
        }
      } else if (arg.startsWith("--patterns=")) {
        const patterns = arg.split("=")[1];
        if (patterns) {
          config.forbiddenPatterns = patterns.split(",").map((p) => p.trim());
        }
      }
    }

    // Now use parseArgs for non-test environments
    const args = parseArgs({
      options: {
        "dry-run": { type: "boolean" },
        backup: { type: "boolean" },
        patterns: { type: "string" },
        file: { type: "string" },
        help: { type: "boolean" },
      },
      allowPositionals: false,
    });

    // Override defaults with command line arguments from parseArgs
    if (args.values["dry-run"] !== undefined) {
      config.dryRun = args.values["dry-run"];
    }

    if (args.values.backup !== undefined) {
      config.createBackup = args.values.backup;
    }

    if (args.values.file) {
      config.bangFilePath = args.values.file;
    }

    if (args.values.patterns) {
      config.forbiddenPatterns = args.values.patterns
        .split(",")
        .map((p) => p.trim());
    }

    return config;
  } catch (error) {
    console.error(
      `${COLORS.red}Error parsing arguments:${COLORS.reset}`,
      error,
    );
    showHelp();
    process.exit(1);
  }
}

// Show help message
function showHelp() {
  console.log(`
${COLORS.cyan}Trash Cleaner${COLORS.reset}

A utility to clean unwanted entries from the bangs array.
Usage: bun addons/trash-cleaner.ts [options]

Options:
  ${COLORS.yellow}--dry-run${COLORS.reset}             Show what would be removed without making changes
  ${COLORS.yellow}--backup${COLORS.reset}              Create a backup of the original file
  ${COLORS.yellow}--patterns <patterns>${COLORS.reset} Comma-separated list of patterns to remove (e.g. ".ru,russia")
  ${COLORS.yellow}--file <path>${COLORS.reset}         Path to the bang file (default: src/bang.test.ts)
  ${COLORS.yellow}--help${COLORS.reset}                Show this help message
`);
}

/**
 * Main function - entry point of the script
 */
export async function main() {
  // Parse command line arguments
  const config = parseCommandLineArgs();

  // Handle help flag early
  if (process.argv.includes("--help")) {
    showHelp();
    return;
  }

  // Resolve the file path
  const bangFilePath = path.resolve(process.cwd(), config.bangFilePath);

  try {
    // Check if the file exists
    const fileExists = await fs.pathExists(bangFilePath);
    if (!fileExists) {
      console.error(
        `${COLORS.red}Error:${COLORS.reset} File not found: ${bangFilePath}`,
      );
      return;
    }

    // Read and process the file
    console.log(`${COLORS.blue}Reading file:${COLORS.reset} ${bangFilePath}`);
    let source;
    try {
      source = await fs.readFile(bangFilePath, "utf-8");
    } catch (err) {
      console.error(
        `${COLORS.red}File read error:${COLORS.reset}`,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    // Log configuration
    console.log(`${COLORS.blue}Configuration:${COLORS.reset}`);
    console.log(
      `  ${COLORS.gray}Patterns:${COLORS.reset} ${config.forbiddenPatterns.join(
        ", ",
      )}`,
    );
    console.log(
      `  ${COLORS.gray}Backup:${COLORS.reset} ${
        config.createBackup ? "Yes" : "No"
      }`,
    );
    console.log(
      `  ${COLORS.gray}Dry run:${COLORS.reset} ${config.dryRun ? "Yes" : "No"}`,
    );

    // Process the content
    const { modifiedContent, removedCount, totalCount, removedItems } =
      processContent(source, config.forbiddenPatterns);

    // For integration tests, we need to handle the mock file system differently
    if (process.env.NODE_ENV === "test") {
      if (config.dryRun) {
        console.log(
          `\n${COLORS.yellow}[DRY RUN]:${COLORS.reset} No changes were made.`,
        );
        console.log(
          `Would remove ${COLORS.red}${removedCount}${COLORS.reset} out of ${totalCount} bangs.`,
        );
      } else {
        try {
          if (config.createBackup) {
            await fs.writeFile(`${bangFilePath}.backup`, source);
            console.log(
              `${COLORS.green}Backup created:${COLORS.reset} ${bangFilePath}.backup`,
            );
          }
          await fs.writeFile(bangFilePath, modifiedContent);
          console.log(
            `${COLORS.green}Successfully removed ${removedCount} out of ${totalCount} bangs with forbidden patterns.${COLORS.reset}`,
          );
        } catch (err) {
          if (err instanceof Error && err.message.includes("Backup creation")) {
            console.error(
              `${COLORS.red}Backup creation error:${COLORS.reset}`,
              err.message,
            );
          } else {
            console.error(
              `${COLORS.red}File write error:${COLORS.reset}`,
              err instanceof Error ? err.message : String(err),
            );
          }
          return;
        }
      }

      // Log removed items
      console.log(
        `\n${COLORS.magenta}Removed ${removedCount} items:${COLORS.reset}`,
      );
      removedItems.forEach((item, index) =>
        console.log(
          `${COLORS.gray}${index + 1}.${COLORS.reset} ${item.service} ${COLORS.gray}(${item.domain})${
            item.url ? ` [URL: ${item.url}]` : ""
          }${COLORS.reset}`,
        ),
      );

      // Print summary
      const percentage =
        totalCount > 0 ? ((removedCount / totalCount) * 100).toFixed(1) : "0";
      console.log(
        `\n${COLORS.green}Summary:${COLORS.reset} Removed ${removedCount}/${totalCount} bangs (${percentage}%)`,
      );
      return;
    }

    // Write the modified content if changes were made
    if (removedCount > 0) {
      if (!config.dryRun) {
        try {
          await writeChanges(
            bangFilePath,
            source,
            modifiedContent,
            removedCount,
            totalCount,
            config.createBackup,
          );
        } catch (err) {
          if (err instanceof Error && err.message.includes("Backup creation")) {
            console.error(
              `${COLORS.red}Backup creation error:${COLORS.reset}`,
              err.message,
            );
          } else {
            console.error(
              `${COLORS.red}File write error:${COLORS.reset}`,
              err instanceof Error ? err.message : String(err),
            );
          }
          return;
        }
      } else {
        console.log(
          `\n${COLORS.yellow}[DRY RUN]:${COLORS.reset} No changes were made.`,
        );
        console.log(
          `Would remove ${COLORS.red}${removedCount}${COLORS.reset} out of ${totalCount} bangs.`,
        );
      }

      // Log removed items
      console.log(
        `\n${COLORS.magenta}Removed ${removedCount} items:${COLORS.reset}`,
      );
      removedItems.forEach((item, index) =>
        console.log(
          `${COLORS.gray}${index + 1}.${COLORS.reset} ${item.service} ${COLORS.gray}(${item.domain})${
            item.url ? ` [URL: ${item.url}]` : ""
          }${COLORS.reset}`,
        ),
      );

      // Print summary
      const percentage =
        totalCount > 0 ? ((removedCount / totalCount) * 100).toFixed(1) : "0";
      console.log(
        `\n${COLORS.green}Summary:${COLORS.reset} Removed ${removedCount}/${totalCount} bangs (${percentage}%)`,
      );
    } else {
      console.log(
        `\n${COLORS.green}No bangs with forbidden patterns found${COLORS.reset} out of ${totalCount} total bangs.`,
      );
    }
  } catch (error: unknown) {
    console.error(
      `${COLORS.red}Error processing the file:${COLORS.reset}`,
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Process the content of the bang file to remove forbidden items
 */
export function processContent(source: string, forbiddenPatterns: string[]) {
  // Create a new MagicString instance for efficient string manipulation
  const s = new MagicString(source);

  // Updated regex now captures the command (c) as group 1.
  const bangRegex =
    /\{\s*c:\s*"([^"]+)",\s*d:\s*"([^"]+)",([\s\S]*?)s:\s*"([^"]+)"([\s\S]*?)(u:\s*"([^"]+)")?([\s\S]*?)(t:\s*"([^"]+)")?([\s\S]*?)\},/g;

  let removedCount = 0;
  let totalCount = 0;
  const removedItems: {
    service: string;
    domain: string;
    url?: string;
    tag?: string;
    reason?: string;
  }[] = [];

  // Process all matches
  let bangMatch: RegExpExecArray | null;
  while ((bangMatch = bangRegex.exec(source)) !== null) {
    totalCount++;
    // Destructure to capture the command (c) along with other properties
    const [
      fullMatch,
      command,
      domain,
      , // skip stuff between d and s
      service,
      , // skip stuff between s and u (if any)
      url,
      , // skip stuff between u and t (if any)
      tag,
    ] = bangMatch;
    const start = bangMatch.index;
    const end = start + fullMatch.length;

    // First decide by domain/service/url/tag
    let matchResult = shouldRemoveItem(
      domain!,
      service!,
      url,
      tag,
      forbiddenPatterns,
    );

    // If not removed so far—and if a command is captured—check the command field.
    if (!matchResult.shouldRemove && command) {
      const commandLower = command.toLowerCase();
      for (const pattern of forbiddenPatterns) {
        if (commandLower.includes(pattern.toLowerCase())) {
          matchResult = {
            shouldRemove: true,
            reason: `Command "${command}" matches forbidden pattern "${pattern}"`,
          };
          break;
        }
      }
    }

    if (matchResult.shouldRemove) {
      s.remove(start, end);
      removedCount++;
      removedItems.push({
        service: service!,
        domain: domain!,
        url,
        tag,
        reason: matchResult.reason,
      });
    }
  }

  // Remove blank lines if any items were removed
  const modifiedContent =
    removedCount > 0 ? removeBlankLines(s.toString()) : s.toString();

  return { modifiedContent, removedCount, totalCount, removedItems };
}

/**
 * Determines if an item should be removed based on domain, service, url, and tag.
 */
export function shouldRemoveItem(
  domain: string,
  service: string,
  url?: string,
  tag?: string,
  forbiddenPatterns: string[] = DEFAULT_CONFIG.forbiddenPatterns,
): { shouldRemove: boolean; reason?: string } {
  // Guard against null or undefined inputs
  if (domain == null || service == null) {
    return {
      shouldRemove: false,
      reason: "Invalid input: domain or service is null/undefined",
    };
  }

  // Convert inputs to lowercase for case-insensitive matching
  const domainLower = domain.toLowerCase();
  const serviceLower = service.toLowerCase();
  const urlLower = url?.toLowerCase();

  // Check for specific services
  if (
    domainLower.includes("yandex") ||
    serviceLower.includes("yandex") ||
    urlLower?.includes("yandex")
  ) {
    return {
      shouldRemove: true,
      reason: `Contains yandex service: "${service}"`,
    };
  }

  // Check for domains starting with "ru."
  if (domainLower.startsWith("ru.")) {
    return {
      shouldRemove: true,
      reason: `Domain starts with "ru.": "${domain}"`,
    };
  }

  // Check for service names containing "Ru" as a standalone word or at word boundaries
  if (
    /\bRu\b/i.test(service) ||
    /\(ru\b/i.test(service) ||
    serviceLower.endsWith(" ru")
  ) {
    return {
      shouldRemove: true,
      reason: `Service name contains russian language indicator: "${service}"`,
    };
  }

  // Check for URL parameters indicating russian language (hl=ru, etc.)
  if (urlLower) {
    if (
      urlLower.includes("hl=ru") ||
      urlLower.includes("lang=ru") ||
      urlLower.includes("#ru/") ||
      urlLower.includes("/ru/") ||
      urlLower.includes("#ru%2F") ||
      urlLower.includes("language=ru") ||
      /[#/]ru[/-]/.test(urlLower)
    ) {
      return {
        shouldRemove: true,
        reason: `URL contains russian language parameter: "${url}"`,
      };
    }
  }

  // Special case checks for language dictionaries and translations
  if (
    service.includes("Russisch") ||
    service.includes("Русск") ||
    serviceLower.includes("russian") ||
    serviceLower.includes("-russ")
  ) {
    return {
      shouldRemove: true,
      reason: `Service contains russian language reference: "${service}"`,
    };
  }

  // Check for language codes in tag
  if (tag) {
    if (
      tag === "ru" ||
      tag === "ritru" ||
      tag === "enru" ||
      tag === "ruen" ||
      tag === "frru" ||
      tag === "deru" ||
      (tag.endsWith("ru") && tag.length <= 5 && /[a-z]{2}ru/.test(tag))
    ) {
      return {
        shouldRemove: true,
        reason: `Tag contains russian language code: "${tag}"`,
      };
    }
  }

  // Check URL for translation services with russian language pairs
  if (url) {
    if (urlLower?.includes("/translation/")) {
      if (
        urlLower?.includes("russian") ||
        urlLower?.includes("russe") ||
        urlLower?.includes("russisch")
      ) {
        return {
          shouldRemove: true,
          reason: `URL contains russian translation service: "${url}"`,
        };
      }
    }
    if (
      urlLower?.includes("-russian") ||
      urlLower?.includes("russian-") ||
      urlLower?.includes("/russian/") ||
      urlLower?.includes("russisch")
    ) {
      return {
        shouldRemove: true,
        reason: `URL contains russian language reference: "${url}"`,
      };
    }
  }

  // Continue with regular pattern checks
  for (const pattern of forbiddenPatterns) {
    if (pattern.startsWith(".") && pattern.length > 1) {
      const patternLower = pattern.toLowerCase();
      if (
        domainLower.endsWith(patternLower) &&
        domainLower.lastIndexOf(".") ===
          domainLower.length - patternLower.length
      ) {
        return { shouldRemove: true, reason: `Domain has TLD ${pattern}` };
      }
      if (serviceLower.includes(patternLower)) {
        return {
          shouldRemove: true,
          reason: `Service contains TLD ${pattern}`,
        };
      }
      if (url?.toLowerCase().includes(patternLower)) {
        return { shouldRemove: true, reason: `URL contains TLD ${pattern}` };
      }
      continue;
    }
    const patternLower = pattern.toLowerCase();
    if (isStandaloneMatch(domainLower, patternLower)) {
      return {
        shouldRemove: true,
        reason: `Domain contains "${pattern}" as standalone term`,
      };
    }
    if (isStandaloneMatch(serviceLower, patternLower)) {
      return {
        shouldRemove: true,
        reason: `Service contains "${pattern}" as standalone term`,
      };
    }
    if (url && isStandaloneMatch(url.toLowerCase(), patternLower)) {
      return {
        shouldRemove: true,
        reason: `URL contains "${pattern}" as standalone term`,
      };
    }
  }

  return { shouldRemove: false };
}

/**
 * Checks if a pattern is a standalone match in a text.
 * This ensures we don't match "rutgers" when looking for "ru".
 */
export function isStandaloneMatch(text: string, pattern: string): boolean {
  // If the pattern is very short (1-2 chars), require it to be a standalone word
  if (pattern.length <= 2) {
    const regex = new RegExp(`\\b${escapeRegExp(pattern)}\\b`, "i");
    return regex.test(text);
  }

  // For patterns of length 3-5, check word boundaries
  if (pattern.length <= 5) {
    const regex = new RegExp(
      `\\b${escapeRegExp(pattern)}|${escapeRegExp(pattern)}\\b`,
      "i",
    );
    return regex.test(text);
  }

  // For longer patterns, a simple inclusion is fine
  return text.includes(pattern);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes blank lines from content
 */
export function removeBlankLines(content: string): string {
  const lines = content.split("\n");
  const nonBlankLines = lines.filter((line) => line.trim() !== "");

  const blankLinesRemoved = lines.length - nonBlankLines.length;
  if (blankLinesRemoved > 0) {
    console.log(
      `${COLORS.gray}Removed ${blankLinesRemoved} blank lines.${COLORS.reset}`,
    );
  }

  return nonBlankLines.join("\n");
}

/**
 * Writes changes to file after creating a backup
 */
async function writeChanges(
  filePath: string,
  originalContent: string,
  modifiedContent: string,
  removedCount: number,
  totalCount: number,
  createBackup = false,
): Promise<void> {
  // Create a backup of the original file if configured
  if (createBackup) {
    const backupPath = `${filePath}.backup`;
    try {
      await fs.writeFile(backupPath, originalContent);
      console.log(
        `${COLORS.green}Backup created:${COLORS.reset} ${backupPath}`,
      );
    } catch (err) {
      throw new Error(
        `Backup creation error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Write the modified content
  try {
    await fs.writeFile(filePath, modifiedContent);
    console.log(
      `${COLORS.green}Successfully removed ${removedCount} out of ${totalCount} bangs with forbidden patterns.${COLORS.reset}`,
    );
  } catch (err) {
    throw new Error(
      `File write error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Run the main function
try {
  await main();
} catch (error: unknown) {
  console.error(
    `${COLORS.red}Unhandled error:${COLORS.reset}`,
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
