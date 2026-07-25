// Extract user-facing English strings from webview TSX files.
// Scans all .tsx files under webview-ui/src using Babel AST, collects:
// - JSXText nodes (text between tags)
// - JSXAttribute values for display-related props (title, label, placeholder, etc.)
// Outputs a sorted, deduplicated JSON file with empty Chinese values for manual translation.
// Usage: node scripts/extract-zh-cn-strings.mjs
// Output: locales/zh-cn-candidates.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const traverse = _traverse.default || _traverse;

const WEBVIEW_SRC = path.resolve(__dirname, "../webview-ui/src");
const OUTPUT_FILE = path.resolve(__dirname, "../locales/zh-cn-candidates.json");

const DISPLAY_PROPS = new Set([
	"title",
	"label",
	"placeholder",
	"aria-label",
	"message",
	"subtitle",
	"heading",
	"description",
	"tooltip",
]);

/** Recursively collect all .tsx files under a directory. */
function collectTsxFiles(dir) {
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectTsxFiles(fullPath));
		} else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
			// Skip test/spec/stories files
			if (
				entry.name.includes(".test.") ||
				entry.name.includes(".spec.") ||
				entry.name.includes(".stories.")
			) {
				continue;
			}
			results.push(fullPath);
		}
	}
	return results;
}

/** Check if a string is likely user-facing English text (not code identifier). */
function isLikelyDisplayText(text) {
	const trimmed = text.trim();
	if (!trimmed) return false;
	// Skip very short strings (single chars, abbreviations used as code)
	if (trimmed.length < 2) return false;
	// Skip strings that look like code identifiers (camelCase, snake_case, no spaces, all lowercase)
	if (!/\s/.test(trimmed) && /^[a-z][a-zA-Z0-9_]*$/.test(trimmed)) return false;
	// Skip strings that are purely technical (URLs, file paths, package names)
	if (/^(https?:\/\/|www\.|\.\/|@?[a-z]+\/[a-z]+)/.test(trimmed)) return false;
	// Skip pure numbers or version strings
	if (/^[\d.]+$/.test(trimmed)) return false;
	return true;
}

const strings = new Set();

const files = collectTsxFiles(WEBVIEW_SRC);
console.log(`Scanning ${files.length} files in ${WEBVIEW_SRC}`);

for (const filePath of files) {
	const code = fs.readFileSync(filePath, "utf8");
	let ast;
	try {
		ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});
	} catch {
		console.warn(
			`  SKIP (parse error): ${path.relative(WEBVIEW_SRC, filePath)}`,
		);
		continue;
	}

	traverse(ast, {
		JSXText(path) {
			const raw = path.node.value;
			const trimmed = raw.trim();
			if (isLikelyDisplayText(trimmed)) {
				strings.add(trimmed);
			}
		},
		JSXAttribute(path) {
			if (!t.isStringLiteral(path.node.value)) return;
			const attrName = path.node.name.name;
			if (typeof attrName !== "string" || !DISPLAY_PROPS.has(attrName)) return;
			const value = path.node.value.value;
			if (isLikelyDisplayText(value)) {
				strings.add(value);
			}
		},
	});
}

// Sort and build output object
const sorted = [...strings].sort((a, b) => a.localeCompare(b));
const output = {};
for (const str of sorted) {
	output[str] = "";
}

// Ensure locales directory exists
const localesDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(localesDir)) {
	fs.mkdirSync(localesDir, { recursive: true });
}

fs.writeFileSync(
	OUTPUT_FILE,
	`${JSON.stringify(output, null, "\t")}\n`,
	"utf8",
);
console.log(`\nExtracted ${sorted.length} candidate strings`);
console.log(`Output: ${OUTPUT_FILE}`);
