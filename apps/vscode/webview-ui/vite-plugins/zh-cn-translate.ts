import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import _generate from "@babel/generator";
import { parse } from "@babel/parser";
// @babel/traverse and @babel/generator export CommonJS default exports.
// In ESM context (vite config), we need to access .default.
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import type { Plugin } from "vite";

const traverse =
	(_traverse as unknown as { default: typeof _traverse }).default || _traverse;
const generate =
	(_generate as unknown as { default: typeof _generate }).default || _generate;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Only these JSX attribute names have their string values translated.
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

// Cache: source code → transformed code (avoids re-parsing unchanged files)
const cache = new Map<string, string>();

interface ZhcnTranslateOptions {
	/** Enable Chinese translation. Defaults to checking CLINE_ZH_CN env var. */
	enabled?: boolean;
}

/**
 * Vite plugin that translates user-facing English strings to Chinese at build time.
 *
 * Uses Babel AST to precisely target JSXText nodes and display-related JSX
 * attributes, leaving code identifiers and non-display strings untouched.
 *
 * Enabled when `options.enabled` is true, or when CLINE_ZH_CN=true env var is set.
 * Pass `enabled` from vite.config.ts using Vite's `loadEnv` to pick up `.env` files.
 */
export function zhcnTranslate(options?: ZhcnTranslateOptions): Plugin {
	const enabled = options?.enabled ?? process.env.CLINE_ZH_CN === "true";

	if (!enabled) {
		// Return a no-op plugin when disabled (zero overhead)
		return { name: "zh-cn-translate" };
	}

	// Load translation dictionary once
	const dictPath = resolve(__dirname, "../../locales/zh-cn.json");
	const dict: Record<string, string> = JSON.parse(
		readFileSync(dictPath, "utf8"),
	);

	// Build a quick-check regex from dictionary keys to skip files that
	// contain no translatable strings (avoids unnecessary AST parsing).
	const dictKeys = Object.keys(dict);
	if (dictKeys.length === 0) {
		return { name: "zh-cn-translate" };
	}
	const escapedKeys = dictKeys.map((k) =>
		k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	);
	const quickCheckPattern = new RegExp(escapedKeys.join("|"));

	return {
		name: "zh-cn-translate",
		enforce: "pre",
		transform(code, id) {
			// Only process TypeScript/TSX source files
			if (!id.endsWith(".tsx") && !id.endsWith(".ts")) return null;
			if (id.includes("node_modules")) return null;
			// Skip test/spec/story files
			if (
				id.includes(".test.") ||
				id.includes(".spec.") ||
				id.includes(".stories.")
			)
				return null;

			// Quick pre-check: does the file contain any dictionary keys?
			if (!quickCheckPattern.test(code)) return null;

			// Cache hit?
			if (cache.has(code)) {
				return { code: cache.get(code) ?? code, map: null };
			}

			// Parse the source into an AST
			let ast: t.Node;
			try {
				ast = parse(code, {
					sourceType: "module",
					plugins: ["jsx", "typescript"],
				});
			} catch {
				// If parsing fails, skip this file (don't break the build)
				return null;
			}

			let hasChanges = false;

			traverse(ast, {
				// JSX text content: <button>Save</button> → <button>保存</button>
				JSXText(path) {
					const raw = path.node.value;
					const trimmed = raw.trim();
					if (!trimmed) return; // Skip pure whitespace
					// Normalize internal whitespace (newlines/tabs from multi-line
					// JSX) to single spaces so multi-line text can match dict keys
					const normalized = trimmed.replace(/\s+/g, " ");
					const translation = dict[trimmed] || dict[normalized];
					if (translation) {
						// Preserve leading/trailing whitespace from the original
						const leading = raw.slice(0, raw.indexOf(trimmed));
						const trailing = raw.slice(raw.indexOf(trimmed) + trimmed.length);
						path.node.value = leading + translation + trailing;
						hasChanges = true;
					}
				},
				// JSX display attributes: title="Save" → title="保存"
				JSXAttribute(path) {
					if (!t.isStringLiteral(path.node.value)) return;
					const attrName = path.node.name.name;
					if (typeof attrName !== "string" || !DISPLAY_PROPS.has(attrName))
						return;
					if (dict[path.node.value.value]) {
						path.node.value = t.stringLiteral(dict[path.node.value.value]);
						hasChanges = true;
					}
				},
				// General string literals: variable assignments, conditionals, etc.
				// Handles cases like:
				//   const heading = lazyMode ? "I guess I'm here to help" : "What can I do for you?"
				//   const label = "Settings"
				//   { title: "Save" }
				StringLiteral(path) {
					const parent = path.parent;

					// Skip if this is a JSXAttribute value (already handled above)
					if (t.isJSXAttribute(parent) && parent.value === path.node) return;

					// Skip import/export module specifiers
					if (
						t.isImportDeclaration(parent) ||
						t.isExportNamedDeclaration(parent)
					)
						return;

					// Skip require() calls
					if (
						t.isCallExpression(parent) &&
						t.isIdentifier(parent.callee) &&
						parent.callee.name === "require"
					)
						return;

					// Skip switch case tests: case "Settings":
					if (t.isSwitchCase(parent) && parent.test === path.node) return;

					// Skip object property keys (only translate values, not keys)
					if (
						t.isObjectProperty(parent) &&
						parent.key === path.node &&
						!parent.computed
					)
						return;

					// Skip member expression properties: obj["property"]
					if (
						t.isMemberExpression(parent) &&
						parent.property === path.node &&
						!parent.computed
					)
						return;

					// Skip binary expressions (comparisons like ===, concatenations like +)
					// to avoid breaking if (mode === "Settings") or "prefix" + suffix
					if (t.isBinaryExpression(parent)) return;

					// Translate if in dictionary
					if (dict[path.node.value]) {
						path.node.value = dict[path.node.value];
						hasChanges = true;
					}
				},
			});

			if (!hasChanges) return null;

			// Generate the modified source code
			const output = generate(ast, {
				retainLines: true,
				jsescOption: { minimal: true },
			});

			cache.set(code, output.code);
			return { code: output.code, map: null };
		},
	};
}
