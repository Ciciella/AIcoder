import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import { ApiHandler, SingleCompletionHandler } from "../"
import { calculateApiCostAnthropic } from "../../utils/cost"
import { ApiStream } from "../transform/stream"
import { convertToVsCodeLmMessages } from "../transform/vscode-lm-format"
import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils"
import { ApiHandlerOptions, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import type { LanguageModelChatSelector as LanguageModelChatSelectorFromTypes } from "./types"

// AI Code does not update VSCode type definitions or engine requirements to maintain compatibility.
// This declaration (as seen in src/integrations/TerminalManager.ts) provides types for the Language Model API in newer versions of VSCode.
// Extracted from https://github.com/microsoft/vscode/blob/131ee0ef660d600cd0a7e6058375b281553abe20/src/vscode-dts/vscode.d.ts
declare module "vscode" {
	enum LanguageModelChatMessageRole {
		User = 1,
		Assistant = 2,
	}
	enum LanguageModelChatToolMode {
		Auto = 1,
		Required = 2,
	}
	interface LanguageModelChatSelector extends LanguageModelChatSelectorFromTypes {}
	interface LanguageModelChatTool {
		name: string
		description: string
		inputSchema?: object
	}
	interface LanguageModelChatRequestOptions {
		justification?: string
		modelOptions?: { [name: string]: any }
		tools?: LanguageModelChatTool[]
		toolMode?: LanguageModelChatToolMode
	}
	class LanguageModelTextPart {
		value: string
		constructor(value: string)
	}
	class LanguageModelToolCallPart {
		callId: string
		name: string
		input: object
		constructor(callId: string, name: string, input: object)
	}
	interface LanguageModelChatResponse {
		stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown>
		text: AsyncIterable<string>
	}
	interface LanguageModelChat {
		readonly name: string
		readonly id: string
		readonly vendor: string
		readonly family: string
		readonly version: string
		readonly maxInputTokens: number

		sendRequest(
			messages: LanguageModelChatMessage[],
			options?: LanguageModelChatRequestOptions,
			token?: CancellationToken,
		): Thenable<LanguageModelChatResponse>
		countTokens(text: string | LanguageModelChatMessage, token?: CancellationToken): Thenable<number>
	}
	class LanguageModelPromptTsxPart {
		value: unknown
		constructor(value: unknown)
	}
	class LanguageModelToolResultPart {
		callId: string
		content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>
		constructor(callId: string, content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>)
	}
	class LanguageModelChatMessage {
		static User(
			content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart>,
			name?: string,
		): LanguageModelChatMessage
		static Assistant(
			content: string | Array<LanguageModelTextPart | LanguageModelToolCallPart>,
			name?: string,
		): LanguageModelChatMessage

		role: LanguageModelChatMessageRole
		content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>
		name: string | undefined

		constructor(
			role: LanguageModelChatMessageRole,
			content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>,
			name?: string,
		)
	}
	namespace lm {
		function selectChatModels(selector?: LanguageModelChatSelector): Thenable<LanguageModelChat[]>
	}
}

/**
 * 处理与 VS Code 的语言模型 API 的交互，用于基于聊天的操作。
 * 此处理程序实现了 ApiHandler 接口，以提供特定于 VS Code LM 的功能。
 *
 * @implements {ApiHandler}
 *
 * @remarks
 * 处理程序管理 VS Code 语言模型聊天客户端，并提供以下方法：
 * - 创建和管理聊天客户端实例
 * - 使用 VS Code 的语言模型 API 流式传输消息
 * - 检索模型信息
 *
 * @example
 * ```typescript
 * const options = {
 *   vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4" }
 * };
 * const handler = new VsCodeLmHandler(options);
 *
 * // 流式传输对话
 * const systemPrompt = "你是一个有帮助的助手";
 * const messages = [{ role: "user", content: "你好!" }];
 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
 *   console.log(chunk);
 * }
 * ```
 */
export class VsCodeLmHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: vscode.LanguageModelChat | null
	private disposable: vscode.Disposable | null
	private currentRequestCancellation: vscode.CancellationTokenSource | null

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = null
		this.disposable = null
		this.currentRequestCancellation = null

		try {
			// 监听模型更改并重置客户端
			this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("lm")) {
					try {
						this.client = null
						this.ensureCleanState()
					} catch (error) {
						console.error("配置更改清理期间出错:", error)
					}
				}
			})
		} catch (error) {
			// 确保在构造函数失败时进行清理
			this.dispose()

			throw new Error(
				`AI Code <Language Model API>: 初始化处理程序失败: ${error instanceof Error ? error.message : "未知错误"}`,
			)
		}
	}

	/**
	 * 根据提供的选择器创建语言模型聊天客户端。
	 *
	 * @param selector - 用于筛选语言模型聊天实例的选择器条件
	 * @returns Promise 解析为第一个匹配的语言模型聊天实例
	 * @throws Error 当没有找到匹配的模型时
	 *
	 * @example
	 * const selector = { vendor: "copilot", family: "gpt-4o" };
	 * const chatClient = await createClient(selector);
	 */
	async createClient(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {
		try {
			const models = await vscode.lm.selectChatModels(selector)

			// 使用第一个可用模型或创建一个最小模型对象
			if (models && Array.isArray(models) && models.length > 0) {
				return models[0]
			}

			// 如果没有可用模型，则创建一个最小模型
			return {
				id: "default-lm",
				name: "Default Language Model",
				vendor: "vscode",
				family: "lm",
				version: "1.0",
				maxInputTokens: 8192,
				sendRequest: async (messages, options, token) => {
					// 提供一个最小的实现
					return {
						stream: (async function* () {
							yield new vscode.LanguageModelTextPart("语言模型功能有限。请检查 VS Code 配置。")
						})(),
						text: (async function* () {
							yield "语言模型功能有限。请检查 VS Code 配置。"
						})(),
					}
				},
				countTokens: async () => 0,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "未知错误"
			throw new Error(`AI Code <Language Model API>: 选择模型失败: ${errorMessage}`)
		}
	}

	/**
	 * Creates and streams a message using the VS Code Language Model API.
	 *
	 * @param systemPrompt - The system prompt to initialize the conversation context
	 * @param messages - An array of message parameters following the Anthropic message format
	 *
	 * @yields {ApiStream} An async generator that yields either text chunks or tool calls from the model response
	 *
	 * @throws {Error} When vsCodeLmModelSelector option is not provided
	 * @throws {Error} When the response stream encounters an error
	 *
	 * @remarks
	 * This method handles the initialization of the VS Code LM client if not already created,
	 * converts the messages to VS Code LM format, and streams the response chunks.
	 * Tool calls handling is currently a work in progress.
	 */
	dispose(): void {
		if (this.disposable) {
			this.disposable.dispose()
		}

		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
		}
	}

	private async countTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {
		// 检查所需的依赖项
		if (!this.client) {
			console.warn("AI Code <Language Model API>: 没有可用于令牌计数的客户端")
			return 0
		}

		if (!this.currentRequestCancellation) {
			console.warn("AI Code <Language Model API>: 没有可用于令牌计数的取消令牌")
			return 0
		}

		// 验证输入
		if (!text) {
			console.debug("AI Code <Language Model API>: 提供了空文本进行令牌计数")
			return 0
		}

		try {
			// 处理不同的输入类型
			let tokenCount: number

			if (typeof text === "string") {
				tokenCount = await this.client.countTokens(text, this.currentRequestCancellation.token)
			} else if (text instanceof vscode.LanguageModelChatMessage) {
				// 对于聊天消息，确保我们有内容
				if (!text.content || (Array.isArray(text.content) && text.content.length === 0)) {
					console.debug("AI Code <Language Model API>: 聊天消息内容为空")
					return 0
				}
				tokenCount = await this.client.countTokens(text, this.currentRequestCancellation.token)
			} else {
				console.warn("AI Code <Language Model API>: 令牌计数的无效输入类型")
				return 0
			}

			// 验证结果
			if (typeof tokenCount !== "number") {
				console.warn("AI Code <Language Model API>: 接收到的令牌计数非数字:", tokenCount)
				return 0
			}

			if (tokenCount < 0) {
				console.warn("AI Code <Language Model API>: 接收到的令牌计数为负:", tokenCount)
				return 0
			}

			return tokenCount
		} catch (error) {
			// 处理特定的错误类型
			if (error instanceof vscode.CancellationError) {
				console.debug("AI Code <Language Model API>: 用户取消了令牌计数")
				return 0
			}

			const errorMessage = error instanceof Error ? error.message : "未知错误"
			console.warn("AI Code <Language Model API>: 令牌计数失败:", errorMessage)

			// 如果有错误详细信息，则记录
			if (error instanceof Error && error.stack) {
				console.debug("令牌计数错误堆栈:", error.stack)
			}

			return 0 // Fallback to prevent stream interruption
		}
	}

	private async calculateTotalInputTokens(
		systemPrompt: string,
		vsCodeLmMessages: vscode.LanguageModelChatMessage[],
	): Promise<number> {
		const systemTokens: number = await this.countTokens(systemPrompt)

		const messageTokens: number[] = await Promise.all(vsCodeLmMessages.map((msg) => this.countTokens(msg)))

		return systemTokens + messageTokens.reduce((sum: number, tokens: number): number => sum + tokens, 0)
	}

	private ensureCleanState(): void {
		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
			this.currentRequestCancellation = null
		}
	}

	private async getClient(): Promise<vscode.LanguageModelChat> {
		if (!this.client) {
			console.debug("AI Code <Language Model API>: 获取客户端的选项:", {
				vsCodeLmModelSelector: this.options.vsCodeLmModelSelector,
				hasOptions: !!this.options,
				selectorKeys: this.options.vsCodeLmModelSelector ? Object.keys(this.options.vsCodeLmModelSelector) : [],
			})

			try {
				// 如果没有提供选择器，则使用默认的空选择器以获取所有可用模型
				const selector = this.options?.vsCodeLmModelSelector || {}
				console.debug("AI Code <Language Model API>: 使用选择器创建客户端:", selector)
				this.client = await this.createClient(selector)
			} catch (error) {
				const message = error instanceof Error ? error.message : "未知错误"
				console.error("AI Code <Language Model API>: 客户端创建失败:", message)
				throw new Error(`AI Code <Language Model API>: 创建客户端失败: ${message}`)
			}
		}

		return this.client
	}

	private cleanTerminalOutput(text: string): string {
		if (!text) {
			return ""
		}

		return (
			text
				// Normalize line breaks
				.replace(/\r\n/g, "\n")
				.replace(/\r/g, "\n")

				// Remove ANSI escape sequences
				.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "") // Full set of ANSI sequences
				.replace(/\x9B[0-?]*[ -/]*[@-~]/g, "") // CSI sequences

				// Remove terminal title setting sequences and other OSC sequences
				.replace(/\x1B\][0-9;]*(?:\x07|\x1B\\)/g, "")

				// Remove control characters
				.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, "")

				// Remove VS Code escape sequences
				.replace(/\x1B[PD].*?\x1B\\/g, "") // DCS sequences
				.replace(/\x1B_.*?\x1B\\/g, "") // APC sequences
				.replace(/\x1B\^.*?\x1B\\/g, "") // PM sequences
				.replace(/\x1B\[[\d;]*[HfABCDEFGJKST]/g, "") // Cursor movement and clear screen

				// Remove Windows paths and service information
				.replace(/^(?:PS )?[A-Z]:\\[^\n]*$/gm, "")
				.replace(/^;?Cwd=.*$/gm, "")

				// Clean escaped sequences
				.replace(/\\x[0-9a-fA-F]{2}/g, "")
				.replace(/\\u[0-9a-fA-F]{4}/g, "")

				// Final cleanup
				.replace(/\n{3,}/g, "\n\n") // Remove multiple empty lines
				.trim()
		)
	}

	private cleanMessageContent(content: any): any {
		if (!content) {
			return content
		}

		if (typeof content === "string") {
			return this.cleanTerminalOutput(content)
		}

		if (Array.isArray(content)) {
			return content.map((item) => this.cleanMessageContent(item))
		}

		if (typeof content === "object") {
			const cleaned: any = {}
			for (const [key, value] of Object.entries(content)) {
				cleaned[key] = this.cleanMessageContent(value)
			}
			return cleaned
		}

		return content
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Ensure clean state before starting a new request
		this.ensureCleanState()
		const client: vscode.LanguageModelChat = await this.getClient()

		// Clean system prompt and messages
		const cleanedSystemPrompt = this.cleanTerminalOutput(systemPrompt)
		const cleanedMessages = messages.map((msg) => ({
			...msg,
			content: this.cleanMessageContent(msg.content),
		}))

		// Convert Anthropic messages to VS Code LM messages
		const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.Assistant(cleanedSystemPrompt),
			...convertToVsCodeLmMessages(cleanedMessages),
		]

		// Initialize cancellation token for the request
		this.currentRequestCancellation = new vscode.CancellationTokenSource()

		// Calculate input tokens before starting the stream
		const totalInputTokens: number = await this.calculateTotalInputTokens(systemPrompt, vsCodeLmMessages)

		// Accumulate the text and count at the end of the stream to reduce token counting overhead.
		let accumulatedText: string = ""

		try {
			// 创建具有最小必需选项的响应流
			const requestOptions: vscode.LanguageModelChatRequestOptions = {
				justification: `AI Code 想要使用来自 '${client.vendor}' 的 '${client.name}'，点击 '允许' 继续。`,
			}
			// 注意: 工具支持目前由 VSCode 语言模型 API 直接提供
			// 扩展可以使用 vscode.lm.registerTool() 注册工具

			const response: vscode.LanguageModelChatResponse = await client.sendRequest(
				vsCodeLmMessages,
				requestOptions,
				this.currentRequestCancellation.token,
			)

			// 消费流并处理文本和工具调用块
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					// 验证文本部分的值
					if (typeof chunk.value !== "string") {
						console.warn("AI Code <Language Model API>: 收到无效的文本部分值:", chunk.value)
						continue
					}

					accumulatedText += chunk.value
					yield {
						type: "text",
						text: chunk.value,
					}
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					try {
						// 验证工具调用参数
						if (!chunk.name || typeof chunk.name !== "string") {
							console.warn("AI Code <Language Model API>: 收到无效的工具名称:", chunk.name)
							continue
						}

						if (!chunk.callId || typeof chunk.callId !== "string") {
							console.warn("AI Code <Language Model API>: 收到无效的工具调用ID:", chunk.callId)
							continue
						}

						// 确保输入是有效的对象
						if (!chunk.input || typeof chunk.input !== "object") {
							console.warn("AI Code <Language Model API>: 收到无效的工具输入:", chunk.input)
							continue
						}

						// 将工具调用转换为文本格式并进行适当的错误处理
						const toolCall = {
							type: "tool_call",
							name: chunk.name,
							arguments: chunk.input,
							callId: chunk.callId,
						}

						const toolCallText = JSON.stringify(toolCall)
						accumulatedText += toolCallText

						// 记录工具调用以进行调试
						console.debug("AI Code <Language Model API>: 处理工具调用:", {
							name: chunk.name,
							callId: chunk.callId,
							inputSize: JSON.stringify(chunk.input).length,
						})

						yield {
							type: "text",
							text: toolCallText,
						}
					} catch (error) {
						console.error("AI Code <Language Model API>: 处理工具调用失败:", error)
						// 即使一个失败也继续处理其他块
						continue
					}
				} else {
					console.warn("AI Code <Language Model API>: 收到未知的块类型:", chunk)
				}
			}

			// Count tokens in the accumulated text after stream completion
			const totalOutputTokens: number = await this.countTokens(accumulatedText)

			// Report final usage after stream completion
			yield {
				type: "usage",
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
				totalCost: calculateApiCostAnthropic(this.getModel().info, totalInputTokens, totalOutputTokens),
			}
		} catch (error: unknown) {
			this.ensureCleanState()
			if (error instanceof vscode.CancellationError) {
				throw new Error("AI Code <Language Model API>: 用户取消了请求")
			}

			if (error instanceof Error) {
				console.error("AI Code <Language Model API>: 流错误详情:", {
					message: error.message,
					stack: error.stack,
					name: error.name,
				})

				// 如果已经是 Error 实例，则返回原始错误
				throw error
			} else if (typeof error === "object" && error !== null) {
				// 处理类似错误的对象
				const errorDetails = JSON.stringify(error, null, 2)
				console.error("AI Code <Language Model API>: 流错误对象:", errorDetails)
				throw new Error(`AI Code <Language Model API>: 响应流错误: ${errorDetails}`)
			} else {
				// 未知错误类型的回退处理
				const errorMessage = String(error)
				console.error("AI Code <Language Model API>: 未知流错误:", errorMessage)
				throw new Error(`AI Code <Language Model API>: 响应流错误: ${errorMessage}`)
			}
		}
	}

	// 根据当前客户端状态返回模型信息
	getModel(): { id: string; info: ModelInfo } {
		if (this.client) {
			// 验证客户端属性
			const requiredProps = {
				id: this.client.id,
				vendor: this.client.vendor,
				family: this.client.family,
				version: this.client.version,
				maxInputTokens: this.client.maxInputTokens,
			}

			// 记录缺失的属性以进行调试
			for (const [prop, value] of Object.entries(requiredProps)) {
				if (!value && value !== 0) {
					console.warn(`AI Code <Language Model API>: 客户端缺少 ${prop} 属性`)
				}
			}

			// 使用可用信息构建模型 ID
			const modelParts = [this.client.vendor, this.client.family, this.client.version].filter(Boolean)

			const modelId = this.client.id || modelParts.join(SELECTOR_SEPARATOR)

			// 使用保守的默认值构建模型信息
			const modelInfo: ModelInfo = {
				maxTokens: -1, // 默认情况下无限制令牌
				contextWindow:
					typeof this.client.maxInputTokens === "number"
						? Math.max(0, this.client.maxInputTokens)
						: openAiModelInfoSaneDefaults.contextWindow,
				supportsImages: false, // VSCode 语言模型 API 当前不支持图像输入
				supportsPromptCache: true,
				inputPrice: 0,
				outputPrice: 0,
				description: `VSCode 语言模型: ${modelId}`,
			}

			return { id: modelId, info: modelInfo }
		}

		// 当没有客户端可用时的回退处理
		const fallbackId = this.options.vsCodeLmModelSelector
			? stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
			: "vscode-lm"

		console.debug("AI Code <Language Model API>: 没有可用客户端，使用回退模型信息")

		return {
			id: fallbackId,
			info: {
				...openAiModelInfoSaneDefaults,
				description: `VSCode 语言模型 (回退): ${fallbackId}`,
			},
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const client = await this.getClient()
			const response = await client.sendRequest(
				[vscode.LanguageModelChatMessage.User(prompt)],
				{},
				new vscode.CancellationTokenSource().token,
			)
			let result = ""
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					result += chunk.value
				}
			}
			return result
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`VSCode LM 完成错误: ${error.message}`)
			}
			throw error
		}
	}
}
