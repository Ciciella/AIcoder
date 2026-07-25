/**
 * Finds template literals (backtick strings) WITHOUT interpolation that contain
 * user-facing English text. These are NOT handled by the zh-cn-translate plugin
 * (which only handles StringLiteral, JSXText, JSXAttribute).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const traverse = _traverse.default || _traverse;

const WEBVIEW_SRC = path.resolve(__dirname, "../webview-ui/src");
const dictPath = path.resolve(__dirname, "../locales/zh-cn.json");
const dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));

function collectTsxFiles(dir) {
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
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
	// Must have spaces (sentences/phrases) or be a known UI word
	if (!/\s/.test(trimmed) && /^[a-z][a-zA-Z0-9_]*$/.test(trimmed)) return false;
	// Skip URLs, paths
	if (/^(https?:\/\/|www\.|\.\/)/.test(trimmed)) return false;
	// Skip pure technical strings
	if (/^[a-z][-a-z0-9]+\.[a-z]{2,}/.test(trimmed)) return false;
	// Must contain at least one English word
	if (!/[a-zA-Z]{2,}/.test(trimmed)) return false;
	return true;
}

const files = collectTsxFiles(WEBVIEW_SRC);
const templateStrings = new Set();

for (const filePath of files) {
	const code = fs.readFileSync(filePath, "utf8");
	let ast;
	try {
		ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
	} catch {
		continue;
	}

	traverse(ast, {
		TemplateLiteral(nodePath) {
			// Only interested in template literals WITHOUT expressions (no ${...})
			if (nodePath.node.expressions.length > 0) return;

			// Get the raw string content
			const raw = nodePath.node.quasis[0].value.cooked;
			if (!isLikelyDisplayText(raw)) return;

			const trimmed = raw.trim();
			// Skip if already in dict
			if (dict[trimmed]) return;

			const relativePath = path.relative(WEBVIEW_SRC, filePath);
			templateStrings.add(`${relativePath}: ${JSON.stringify(trimmed)}`);
		},
	});
}

console.log(`=== TEMPLATE LITERALS WITHOUT INTERPOLATION (not in dict) ===`);
console.log(`Count: ${templateStrings.size}`);
console.log("---");
for (const s of [...templateStrings].sort()) {
	console.log(s);
}
