// Minimal type declarations for Babel packages that don't ship their own types.
// @babel/parser and @babel/types have bundled types; these two do not.
// Using `export default` to match the ESM import style in zh-cn-translate.ts.

declare module "@babel/traverse" {
	import type { Node } from "@babel/types";

	// Path type is permissive (any) since visitors are type-narrowed at runtime
	// via t.isStringLiteral() and similar checks from @babel/types.
	// biome-ignore lint/suspicious/noExplicitAny: permissive path type narrowed at runtime
	type TraversalPath = any;

	type Visitor = Record<string, (path: TraversalPath) => void>;

	const traverse: (ast: Node, visitor: Visitor) => void;
	export default traverse;
}

declare module "@babel/generator" {
	import type { Node } from "@babel/types";

	interface GeneratorOptions {
		retainLines?: boolean;
		jsescOption?: Record<string, unknown>;
		[source: string]: unknown;
	}

	interface GeneratorResult {
		code: string;
		map: unknown | null;
	}

	const generate: (
		ast: Node,
		options?: GeneratorOptions,
		code?: string,
	) => GeneratorResult;
	export default generate;
}
