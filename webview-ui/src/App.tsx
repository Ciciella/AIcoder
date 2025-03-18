import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../src/shared/ExtensionMessage"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import AccountView from "./components/account/AccountView"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { vscode } from "./utils/vscode"
import McpView from "./components/mcp/McpView"
import enMessages from "./locales/en.json"
import zhCNMessages from "./locales/zh-CN.json"
import { IntlProvider } from "react-intl"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

// 定义消息类型
type MessageType = {
	[key: string]: string
}

// 定义消息对象的类型
type MessagesType = {
	en: MessageType
	"zh-CN": MessageType
}

// 定义允许的语言环境
type Locale = keyof MessagesType

const messages: MessagesType = {
	en: enMessages,
	"zh-CN": zhCNMessages,
}

const AppContent = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement, telemetrySetting, vscMachineId } = useExtensionState()
	const [showSettings, setShowSettings] = useState(false)
	const [showHistory, setShowHistory] = useState(false)
	const [showMcp, setShowMcp] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	const handleMessage = useCallback((e: MessageEvent) => {
		const message: ExtensionMessage = e.data
		switch (message.type) {
			case "action":
				switch (message.action!) {
					case "settingsButtonClicked":
						setShowSettings(true)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(false)
						break
					case "historyButtonClicked":
						setShowSettings(false)
						setShowHistory(true)
						setShowMcp(false)
						setShowAccount(false)
						break
					case "mcpButtonClicked":
						setShowSettings(false)
						setShowHistory(false)
						setShowMcp(true)
						setShowAccount(false)
						break
					case "accountLoginClicked":
						setShowSettings(false)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(true)
						break
					case "chatButtonClicked":
						setShowSettings(false)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(false)
						break
				}
				break
		}
	}, [])

	useEvent("message", handleMessage)

	// useEffect(() => {
	// 	if (telemetrySetting === "enabled") {
	// 		posthog.identify(vscMachineId)
	// 		posthog.opt_in_capturing()
	// 	} else {
	// 		posthog.opt_out_capturing()
	// 	}
	// }, [telemetrySetting, vscMachineId])

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	return (
		<>
			{showWelcome ? (
				<WelcomeView />
			) : (
				<>
					{showSettings && <SettingsView onDone={() => setShowSettings(false)} />}
					{showHistory && <HistoryView onDone={() => setShowHistory(false)} />}
					{showMcp && <McpView onDone={() => setShowMcp(false)} />}
					{showAccount && <AccountView onDone={() => setShowAccount(false)} />}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						showHistoryView={() => {
							setShowSettings(false)
							setShowMcp(false)
							setShowHistory(true)
						}}
						isHidden={showSettings || showHistory || showMcp || showAccount}
						showAnnouncement={showAnnouncement}
						hideAnnouncement={() => {
							setShowAnnouncement(false)
						}}
					/>
				</>
			)}
		</>
	)
}

const App = () => {
	const [locale, setLocale] = useState<Locale>("zh-CN")

	const toggleLanguage = useCallback(() => {
		setLocale((prevLocale) => (prevLocale === "en" ? "zh-CN" : "en"))
	}, [])

	useEffect(() => {
		console.log("当前语言:", locale)
		console.log("当前消息:", messages[locale])
		console.log("欢迎标题:", messages[locale]["welcome.title"])
	}, [locale])

	return (
		<IntlProvider key={locale} messages={messages[locale]} locale={locale}>
			{/* <div style={{ position: 'fixed', top: 10, right: 10, zIndex: 1000 }}>
				<VSCodeButton onClick={toggleLanguage}>
					{locale === 'en' ? 'Switch to Chinese' : '切换到英文'}
				</VSCodeButton>
			</div> */}
			<ExtensionStateContextProvider>
				<FirebaseAuthProvider>
					<AppContent />
				</FirebaseAuthProvider>
			</ExtensionStateContextProvider>
		</IntlProvider>
	)
}

export default App
