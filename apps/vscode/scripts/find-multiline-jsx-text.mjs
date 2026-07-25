/**
 * Finds multi-line JSX text strings that need translation.
 * Normalizes internal whitespace and checks against the dict.
 */
import fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = nodePath.dirname(__filename);

const traverse = _traverse.default || _traverse;

const WEBVIEW_SRC = nodePath.resolve(__dirname, "../webview-ui/src");
const dictPath = nodePath.resolve(__dirname, "../locales/zh-cn.json");
const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));

function collectTsxFiles(dir) {
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = nodePath.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectTsxFiles(fullPath));
		} else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
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

function isLikelyDisplayText(text) {
	const trimmed = text.trim();
	if (!trimmed) return false;
	if (trimmed.length < 3) return false;
	if (!/\s/.test(trimmed) && /^[a-z][a-zA-Z0-9_]*$/.test(trimmed)) return false;
	if (/^(https?:\/\/|www\.|\.\/)/.test(trimmed)) return false;
	if (/^[a-z][-a-z0-9]+\.[a-z]{2,}/.test(trimmed)) return false;
	if (!/[a-zA-Z]{2,}/.test(trimmed)) return false;
	return true;
}

const files = collectTsxFiles(WEBVIEW_SRC);
const missing = new Map(); // normalized string -> [file:line, ...]

for (const filePath of files) {
	const code = fs.readFileSync(filePath, "utf8");
	let ast;
	try {
		ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
	} catch {
		continue;
	}

	traverse(ast, {
		JSXText(babelPath) {
			const raw = babelPath.node.value;
			const trimmed = raw.trim();
			if (!trimmed) return;
			// Only interested in multi-line strings (contain \n or \t internally)
			if (!/\n|\t/.test(trimmed)) return;
			if (!isLikelyDisplayText(trimmed)) return;

			const normalized = trimmed.replace(/\s+/g, " ");
			// Skip if already in dict (either trimmed or normalized form)
			if (dict[trimmed] || dict[normalized]) return;

			const relativePath = nodePath.relative(WEBVIEW_SRC, filePath);
			if (!missing.has(normalized)) {
				missing.set(normalized, []);
			}
			missing.get(normalized).push(relativePath);
		},
	});
}

console.log(`=== MULTI-LINE JSX TEXT STRINGS MISSING FROM DICT ===`);
console.log(`Count: ${missing.size}`);
console.log("---");
for (const [normalized, files] of [...missing.entries()].sort()) {
	console.log(`\nSTRING: ${JSON.stringify(normalized)}`);
	console.log(`  FILES: ${files.join(", ")}`);
}
