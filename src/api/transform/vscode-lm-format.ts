import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"

/**
 * 安全地将值转换为普通对象。
 */
export function asObjectSafe(value: any): object {
	// Handle null/undefined
	if (!value) {
		return {}
	}

	try {
		// 处理可能是 JSON 的字符串
		if (typeof value === "string") {
			return JSON.parse(value)
		}

		// 处理已存在的对象
		if (typeof value === "object") {
			return Object.assign({}, value)
		}

		return {}
	} catch (error) {
		console.warn("AI Code <Language Model API>: 解析对象失败:", error)
		return {}
	}
}

export function convertToVsCodeLmMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
): vscode.LanguageModelChatMessage[] {
	const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = []

	for (const anthropicMessage of anthropicMessages) {
		// 处理简单的字符串消息
		if (typeof anthropicMessage.content === "string") {
			vsCodeLmMessages.push(
				anthropicMessage.role === "assistant"
					? vscode.LanguageModelChatMessage.Assistant(anthropicMessage.content)
					: vscode.LanguageModelChatMessage.User(anthropicMessage.content),
			)
			continue
		}

		// 处理复杂的消息结构
		switch (anthropicMessage.role) {
			case "user": {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// 先处理工具消息，然后处理非工具消息
				const contentParts = [
					// 将工具消息转换为 ToolResultParts
					...toolMessages.map((toolMessage) => {
						// 将工具结果内容处理为 TextParts
						const toolContentParts: vscode.LanguageModelTextPart[] =
							typeof toolMessage.content === "string"
								? [new vscode.LanguageModelTextPart(toolMessage.content)]
								: (toolMessage.content?.map((part) => {
										if (part.type === "image") {
											return new vscode.LanguageModelTextPart(
												`[Image (${part.source?.type || "Unknown source-type"}): ${part.source?.media_type || "unknown media-type"} 不被 VSCode LM API 支持]`,
											)
										}
										return new vscode.LanguageModelTextPart(part.text)
									}) ?? [new vscode.LanguageModelTextPart("")])

						return new vscode.LanguageModelToolResultPart(toolMessage.tool_use_id, toolContentParts)
					}),

					// 在工具消息之后将非工具消息转换为 TextParts
					...nonToolMessages.map((part) => {
						if (part.type === "image") {
							return new vscode.LanguageModelTextPart(
								`[Image (${part.source?.type || "Unknown source-type"}): ${part.source?.media_type || "unknown media-type"} 不被 VSCode LM API 支持]`,
							)
						}
						return new vscode.LanguageModelTextPart(part.text)
					}),
				]

				// 添加包含所有内容部分的用户消息
				vsCodeLmMessages.push(vscode.LanguageModelChatMessage.User(contentParts))
				break
			}

			case "assistant": {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// 先处理工具消息，然后处理非工具消息
				const contentParts = [
					// 首先将工具消息转换为 ToolCallParts
					...toolMessages.map(
						(toolMessage) =>
							new vscode.LanguageModelToolCallPart(
								toolMessage.id,
								toolMessage.name,
								asObjectSafe(toolMessage.input),
							),
					),

					// 在工具消息之后将非工具消息转换为 TextParts
					...nonToolMessages.map((part) => {
						if (part.type === "image") {
							return new vscode.LanguageModelTextPart("[图片生成不被 VSCode LM API 支持]")
						}
						return new vscode.LanguageModelTextPart(part.text)
					}),
				]

				// 将助手消息添加到消息列表中
				vsCodeLmMessages.push(vscode.LanguageModelChatMessage.Assistant(contentParts))
				break
			}
		}
	}

	return vsCodeLmMessages
}

export function convertToAnthropicRole(
	vsCodeLmMessageRole: vscode.LanguageModelChatMessageRole,
): Anthropic.Messages.MessageParam["role"] | null {
	switch (vsCodeLmMessageRole) {
		case vscode.LanguageModelChatMessageRole.Assistant:
			return "assistant"
		case vscode.LanguageModelChatMessageRole.User:
			return "user"
		default:
			return null
	}
}

export function convertToAnthropicMessage(vsCodeLmMessage: vscode.LanguageModelChatMessage): Anthropic.Messages.Message {
	const anthropicRole = convertToAnthropicRole(vsCodeLmMessage.role)
	if (anthropicRole !== "assistant") {
		throw new Error("AI Code <Language Model API>: 仅支持助手消息。")
	}

	return {
		id: crypto.randomUUID(),
		type: "message",
		model: "vscode-lm",
		role: anthropicRole,
		content: vsCodeLmMessage.content
			.map((part): Anthropic.ContentBlock | null => {
				if (part instanceof vscode.LanguageModelTextPart) {
					return {
						type: "text",
						text: part.value,
						citations: null,
					}
				}

				if (part instanceof vscode.LanguageModelToolCallPart) {
					return {
						type: "tool_use",
						id: part.callId || crypto.randomUUID(),
						name: part.name,
						input: asObjectSafe(part.input),
					}
				}

				return null
			})
			.filter((part): part is Anthropic.ContentBlock => part !== null),
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	}
}
