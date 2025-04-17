import { useCallback, useRef, useState } from "react"
import { vscode } from "@/utils/vscode"
import { VSCodeButton, VSCodeLink, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEvent } from "react-use"
import { LINKS } from "@/constants"
const AddRemoteServerForm = ({ onServerAdded }: { onServerAdded: () => void }) => {
	const [serverName, setServerName] = useState("")
	const [serverUrl, setServerUrl] = useState("")
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [error, setError] = useState("")
	const [showConnectingMessage, setShowConnectingMessage] = useState(false)

	// 存储提交的值以检查服务器是否已添加
	const submittedValues = useRef<{ name: string } | null>(null)

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message = event.data

			if (
				message.type === "addRemoteServerResult" &&
				isSubmitting &&
				submittedValues.current &&
				message.addRemoteServerResult?.serverName === submittedValues.current.name
			) {
				if (message.addRemoteServerResult.success) {
					// 处理成功
					setIsSubmitting(false)
					setServerName("")
					setServerUrl("")
					submittedValues.current = null
					onServerAdded()
					setShowConnectingMessage(false)
				} else {
					// 处理错误
					setIsSubmitting(false)
					setError(message.addRemoteServerResult.error || "添加服务器失败")
					setShowConnectingMessage(false)
				}
			}
		},
		[isSubmitting, onServerAdded],
	)

	useEvent("message", handleMessage)

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()

		if (!serverName.trim()) {
			setError("服务器名称是必填项")
			return
		}

		if (!serverUrl.trim()) {
			setError("服务器URL是必填项")
			return
		}

		try {
			new URL(serverUrl)
		} catch (err) {
			setError("URL格式无效")
			return
		}

		setError("")

		submittedValues.current = { name: serverName.trim() }

		setIsSubmitting(true)
		setShowConnectingMessage(true)
		vscode.postMessage({
			type: "addRemoteServer",
			serverName: serverName.trim(),
			serverUrl: serverUrl.trim(),
		})
	}

	return (
		<div className="p-4 px-5">
			<div className="text-[var(--vscode-foreground)] mb-2">
				通过提供名称和URL端点添加远程MCP服务器。了解更多{" "}
				<VSCodeLink href={LINKS.DOCUMENTATION.REMOTE_MCP_SERVER_DOCS} style={{ display: "inline" }}>
					点击这里
				</VSCodeLink>
			</div>

			<form onSubmit={handleSubmit}>
				<div className="mb-2">
					<VSCodeTextField
						value={serverName}
						onChange={(e) => {
							setServerName((e.target as HTMLInputElement).value)
							setError("")
						}}
						disabled={isSubmitting}
						className="w-full"
						placeholder="mcp-server">
						服务器名称
					</VSCodeTextField>
				</div>

				<div className="mb-2">
					<VSCodeTextField
						value={serverUrl}
						onChange={(e) => {
							setServerUrl((e.target as HTMLInputElement).value)
							setError("")
						}}
						disabled={isSubmitting}
						placeholder="https://example.com/mcp-server"
						className="w-full mr-4">
						服务器URL
					</VSCodeTextField>
				</div>

				{error && <div className="mb-3 text-[var(--vscode-errorForeground)]">{error}</div>}

				<div className="flex items-center mt-3 w-full">
					<VSCodeButton type="submit" disabled={isSubmitting} className="w-full">
						{isSubmitting ? "添加中..." : "添加服务器"}
					</VSCodeButton>

					{showConnectingMessage && (
						<div className="ml-3 text-[var(--vscode-notificationsInfoIcon-foreground)] text-sm">
							正在连接服务器...这可能需要几秒钟。
						</div>
					)}
				</div>

				<VSCodeButton
					appearance="secondary"
					style={{ width: "100%", marginBottom: "5px", marginTop: 15 }}
					onClick={() => {
						vscode.postMessage({ type: "openMcpSettings" })
					}}>
					编辑配置
				</VSCodeButton>
			</form>
		</div>
	)
}

export default AddRemoteServerForm
