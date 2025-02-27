import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  parseCommandLineArgs,
  processContent,
  shouldRemoveItem,
  isStandaloneMatch,
  removeBlankLines,
} from "./main.js";

describe("parseCommandLineArgs", () => {
  let originalArgv: string[];

  beforeEach(() => {
    // Save the original process.argv so we can restore it after tests
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should set "dryRun" to true when "--dry-run" flag is present', () => {
    process.argv = ["node", "script", "--dry-run"];
    const config = parseCommandLineArgs();
    expect(config.dryRun).toBe(true);
  });

  it('should set "createBackup" to true when "--backup" flag is present', () => {
    process.argv = ["node", "script", "--backup"];
    const config = parseCommandLineArgs();
    expect(config.createBackup).toBe(true);
  });

  it("should use provided file path and patterns from arguments", () => {
    process.argv = [
      "node",
      "script",
      "--file=custom/path.ts",
      "--patterns=.gov,custom",
    ];
    const config = parseCommandLineArgs();
    expect(config.bangFilePath).toBe("custom/path.ts");
    expect(config.forbiddenPatterns).toEqual([".gov", "custom"]);
  });
});

describe("removeBlankLines", () => {
  it("should remove blank lines from content", () => {
    const content = "line1\n\nline2\n   \nline3";
    const result = removeBlankLines(content);
    expect(result).toBe("line1\nline2\nline3");
  });

  it("should return same content if there are no blank lines", () => {
    const content = "line1\nline2";
    const result = removeBlankLines(content);
    expect(result).toBe(content);
  });
});

describe("isStandaloneMatch", () => {
  it("should return true for an exact standalone match for short patterns", () => {
    // "ru" as a one- or two-letter pattern requires word boundaries
    expect(isStandaloneMatch("this is ru test", "ru")).toBe(true);
  });

  it("should return false when the pattern is only a substring", () => {
    // "rutgers" should not match a standalone "ru"
    expect(isStandaloneMatch("rutgers university", "ru")).toBe(false);
  });

  it("should work for longer patterns by simple inclusion", () => {
    expect(isStandaloneMatch("examplerussiantext", "russian")).toBe(true);
  });
});

describe("shouldRemoveItem", () => {
  // Use the default forbidden patterns from the module for testing.
  const defaultPatterns = [
    ".ru",
    "russia",
    "russian",
    "russisch",
    "-russian",
    "yandex",
  ];

  it("should remove an item when the domain ends with '.ru'", () => {
    const result = shouldRemoveItem(
      "example.ru",
      "SomeService",
      undefined,
      undefined,
      defaultPatterns,
    );
    expect(result.shouldRemove).toBe(true);
    expect(result.reason).toContain(".ru");
  });

  it('should remove an item when the domain starts with "ru."', () => {
    const result = shouldRemoveItem(
      "ru.example",
      "SomeService",
      undefined,
      undefined,
      defaultPatterns,
    );
    expect(result.shouldRemove).toBe(true);
  });

  it('should remove an item when the service contains "Yandex"', () => {
    const result = shouldRemoveItem(
      "example.com",
      "Yandex Search",
      undefined,
      undefined,
      defaultPatterns,
    );
    expect(result.shouldRemove).toBe(true);
  });

  it("should remove an item when URL contains a Russian language parameter", () => {
    const result = shouldRemoveItem(
      "example.com",
      "Service",
      "https://example.com/page?hl=ru",
      undefined,
      defaultPatterns,
    );
    expect(result.shouldRemove).toBe(true);
    expect(result.reason).toContain("URL");
  });

  it("should not remove an item if none of the conditions match", () => {
    const result = shouldRemoveItem(
      "example.com",
      "ValidService",
      "https://example.com",
      "en",
      defaultPatterns,
    );
    expect(result.shouldRemove).toBe(false);
  });
});

describe("processContent", () => {
  it("should remove entries with forbidden patterns and update counts", () => {
    const source = `
{ c: "cmd1", d: "example.ru", extra: "junk", s: "Service1" },
{ c: "cmd2", d: "example.com", extra: "junk", s: "ValidService" },
`;

    // Only remove entries that have domains ending with ".ru"
    const forbiddenPatterns = [".ru"];
    const result = processContent(source, forbiddenPatterns);

    expect(result.totalCount).toBe(2);
    expect(result.removedCount).toBe(1);
    // The removed entry contains "example.ru"
    expect(result.modifiedContent).not.toContain("example.ru");
    // The valid entry remains
    expect(result.modifiedContent).toContain("example.com");
    expect(result.removedItems.length).toBe(1);
    expect(result.removedItems[0]?.domain).toBe("example.ru");
  });

  it("should not remove any entries if none match forbidden patterns", () => {
    const source = `
{ c: "cmd1", d: "example.com", extra: "junk", s: "Service1" },
{ c: "cmd2", d: "test.com", extra: "junk", s: "ValidService" },
`;
    const forbiddenPatterns = [".ru"];
    const result = processContent(source, forbiddenPatterns);

    expect(result.totalCount).toBe(2);
    expect(result.removedCount).toBe(0);
    expect(result.modifiedContent).toContain("example.com");
    expect(result.modifiedContent).toContain("test.com");
    expect(result.removedItems.length).toBe(0);
  });

  it("should remove blank lines from the modified content", () => {
    const source = `
{ c: "cmd1", d: "bad.ru", s: "Service1" },

{ c: "cmd2", d: "good.com", s: "Service2" },
`;
    const result = processContent(source, [".ru"]);
    // The first entry (with "bad.ru") should be removed.
    expect(result.removedCount).toBe(1);
    expect(result.modifiedContent).toContain("good.com");
    expect(result.modifiedContent).not.toContain("bad.ru");

    // Ensure that no blank line remains in the modified content.
    for (const line of result.modifiedContent.split("\n")) {
      expect(line.trim()).not.toBe("");
    }
  });
});

describe("Integration test with generated bang.test.ts", () => {
  const testFilePath = "src/bang.test.ts";

  // Create a test file before each test
  // (doc.rust-lang.org should not trigger removal)
  beforeEach(async () => {
    const testContent = `
export type Bang = {
  c: string; // Category
  d: string; // Domain
  r: number; // Rank
  s: string; // Service name
  sc: string; // Subcategory
  t: string; // Tag
  u: string; // URL template
};

export const bangs: Bang[] = [
  {
    c: "Research",
    d: "ru.wikipedia.org",
    r: 9,
    s: "Russian Wikipedia",
    sc: "Reference",
    t: "ruwiki",
    u: "https://ru.wikipedia.org/w/index.php?search={{{s}}} ",
  },
  {
    c: "Online Services",
    d: "yandex.ru",
    r: 0,
    s: "Yandex.ru",
    sc: "Search (non-US)",
    t: "\\u044f",
    u: "https://yandex.ru/yandsearch?text={{{s}}}",
  },
  {
    c: "Tech",
    d: "doc.rust-lang.org",
    r: 67,
    s: "Rust Nightly Standard Library Documentation",
    sc: "Languages (other)",
    t: "rustn",
    u: "https://doc.rust-lang.org/nightly/std/?search={{{s}}}",
  },
];
`;

    await import("fs-extra").then((fs) =>
      fs.writeFile(testFilePath, testContent),
    );
  });

  // Clean up the test file after each test
  afterEach(async () => {
    await import("fs-extra").then((fs) => {
      // Remove the test file and any backup
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      if (fs.existsSync(`${testFilePath}.backup`)) {
        fs.unlinkSync(`${testFilePath}.backup`);
      }
    });
  });

  it("should remove Russian and Yandex entries but keep Rust entry", async () => {
    // Set up test environment
    process.env.NODE_ENV = "test";
    const originalArgv = process.argv;

    try {
      // Run the cleaner with specific patterns
      process.argv = ["node", "script", "--file=src/bang.test.ts"];

      // Import the main function dynamically to run it
      const { main } = await import("./main.js");
      await main();

      // Read the modified file
      const fs = await import("fs-extra");
      const modifiedContent = await fs.readFile(testFilePath, "utf-8");

      // Verify that Russian and Yandex entries are removed
      expect(modifiedContent).not.toContain("ru.wikipedia.org");
      expect(modifiedContent).not.toContain("Russian Wikipedia");
      expect(modifiedContent).not.toContain("yandex.ru");
      expect(modifiedContent).not.toContain("Yandex.ru");

      // Verify that Rust entry is kept
      expect(modifiedContent).toContain("doc.rust-lang.org");
      expect(modifiedContent).toContain(
        "Rust Nightly Standard Library Documentation",
      );

      // Verify the structure is maintained
      expect(modifiedContent).toContain("export type Bang =");
      expect(modifiedContent).toContain("export const bangs: Bang[] =");
    } finally {
      // Restore original argv
      process.argv = originalArgv;
      process.env.NODE_ENV = undefined;
    }
  });

  it("should create a backup file when --backup flag is used", async () => {
    // Set up test environment
    process.env.NODE_ENV = "test";
    const originalArgv = process.argv;

    try {
      // Run the cleaner with backup flag
      process.argv = ["node", "script", "--file=src/bang.test.ts", "--backup"];

      // Import the main function dynamically to run it
      const { main } = await import("./main.js");
      await main();

      // Verify backup file exists
      const fs = await import("fs-extra");
      expect(fs.existsSync(`${testFilePath}.backup`)).toBe(true);

      // Verify backup contains original content
      const backupContent = await fs.readFile(
        `${testFilePath}.backup`,
        "utf-8",
      );
      expect(backupContent).toContain("ru.wikipedia.org");
      expect(backupContent).toContain("yandex.ru");
    } finally {
      // Restore original argv
      process.argv = originalArgv;
      process.env.NODE_ENV = undefined;
    }
  });

  it("should not modify the file in dry-run mode", async () => {
    // Set up test environment
    process.env.NODE_ENV = "test";
    const originalArgv = process.argv;

    try {
      // Get original content
      const fs = await import("fs-extra");
      const originalContent = await fs.readFile(testFilePath, "utf-8");

      // Run the cleaner with dry-run flag
      process.argv = ["node", "script", "--file=src/bang.test.ts", "--dry-run"];

      // Import the main function dynamically to run it
      const { main } = await import("./main.js");
      await main();

      // Verify file content is unchanged
      const modifiedContent = await fs.readFile(testFilePath, "utf-8");
      expect(modifiedContent).toBe(originalContent);
    } finally {
      // Restore original argv
      process.argv = originalArgv;
      process.env.NODE_ENV = undefined;
    }
  });
});
