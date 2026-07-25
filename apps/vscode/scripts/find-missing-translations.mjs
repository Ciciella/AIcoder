/**
 * Compares zh-cn-candidates.json with zh-cn.json dictionary
 * Outputs all missing strings, categorized by transatability
 */
import fs from "node:fs";
import path from "node:path";

const __dirname = path
	.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""))
	.replace(/\\/g, "/");

const dictPath = path.join(__dirname, "..", "locales", "zh-cn.json");
const candPath = path.join(__dirname, "..", "locales", "zh-cn-candidates.json");

const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));
const cand = JSON.parse(fs.readFileSync(candPath, "utf8"));
const candKeys = Array.isArray(cand) ? cand : Object.keys(cand);

// Categories
const translatable = []; // User-facing strings that should be translated
const technical = []; // Technical strings (URLs, paths, code identifiers)
const languageNames = []; // Language name strings (already in native script)

const technicalPatterns = [
	/^https?:\/\//, // URLs
	/^\/[a-z]/, // File paths
	/^[a-z][-a-z0-9]*\.[a-z]{2,}/, // Domain names
	/\.(json|ts|tsx|js|jsx|py|md|txt|sh|mjs|cjs)$/, // File extensions
	/^--?[a-z]/, // CLI flags
	/^node_modules/, // Node paths
	/^[a-z]+:\/\//, // Protocol URLs
	/^~/, // Home directory paths
	/^[a-z][-a-zA-Z0-9]*$/, // kebab-case identifiers (likely code)
	/^codicon-/, // Codicon icon names
	/^[a-z]+Api$/, // API variable names
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional non-ASCII detection for language names
const languagePattern = / - [^\x00-\x7F]/; // "Language - Native Script" pattern

for (const s of candKeys) {
	if (dict[s]) continue; // Already translated
	if (s.length < 3) continue; // Too short

	// Skip multi-line strings
	if (s.includes("\n") || s.includes("\t")) continue;

	// Categorize
	if (languagePattern.test(s)) {
		languageNames.push(s);
	} else if (technicalPatterns.some((p) => p.test(s))) {
		technical.push(s);
	} else if (s.length < 10 && !/[.!?]$/.test(s)) {
		// Short strings without sentence-ending punctuation
		// Could be labels, but also could be code - need manual review
		translatable.push(s);
	} else {
		translatable.push(s);
	}
}

console.log("=== TRANSLATABLE (needs translation) ===");
console.log(`Count: ${translatable.length}`);
console.log("---");
for (const s of translatable) console.log(s);

console.log("\n=== LANGUAGE NAMES (skip - already native) ===");
console.log(`Count: ${languageNames.length}`);
for (const s of languageNames) console.log(`  ${s}`);

console.log("\n=== TECHNICAL (skip - code/paths/URLs) ===");
console.log(`Count: ${technical.length}`);
for (const s of technical) console.log(`  ${s}`);

console.log(`\n=== SUMMARY ===`);
console.log(`Already translated: ${Object.keys(dict).length}`);
console.log(`Candidates total: ${candKeys.length}`);
console.log(`Missing translatable: ${translatable.length}`);
console.log(`Missing technical (skip): ${technical.length}`);
console.log(`Missing language names (skip): ${languageNames.length}`);
