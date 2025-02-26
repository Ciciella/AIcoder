import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../../../src/shared/ExtensionMessage"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { validateApiConfiguration } from "../../utils/validate"
import { vscode } from "../../utils/vscode"
import ApiOptions from "../settings/ApiOptions"
import { FormattedMessage } from "react-intl"

const WelcomeView = () => {
	const { apiConfiguration } = useExtensionState()

	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [email, setEmail] = useState("")
	const [isSubscribed, setIsSubscribed] = useState(false)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = () => {
		vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
	}

	const handleSubscribe = () => {
		if (email) {
			vscode.postMessage({ type: "subscribeEmail", text: email })
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(apiConfiguration))
	}, [apiConfiguration])

	// Add message handler for subscription confirmation
	const handleMessage = useCallback((e: MessageEvent) => {
		const message: ExtensionMessage = e.data
		if (message.type === "emailSubscribed") {
			setIsSubscribed(true)
			setEmail("")
		}
	}, [])

	useEvent("message", handleMessage)

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
			}}>
			<div
				style={{
					height: "100%",
					padding: "0 20px",
					overflow: "auto",
				}}>
				<h2>
					<FormattedMessage id="welcome.title" defaultMessage="Hi, I'm AI Code" />
				</h2>
				<p>
					感谢Claude 3.7
					Sonnet的自主编码能力突破，我可以执行各种任务，并且可以使用创建和编辑文件、探索复杂项目、使用浏览器以及执行终端命令的工具（当然，需要您的许可）。我甚至可以使用MCP创建新工具并扩展我自己的能力。
				</p>

				<b>
					<FormattedMessage
						id="welcome.apiProvider"
						defaultMessage="To get started, this extension needs an API provider for Claude 3.7 Sonnet."
					/>
				</b>

				<div style={{ marginTop: "15px" }}>
					<ApiOptions showModelOptions={false} />
					<VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: "3px" }}>
						<FormattedMessage id="welcome.letsGo" defaultMessage="Let's go!" />
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default WelcomeView
