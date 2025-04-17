import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useRef, useState } from "react"
import { useClickAway, useEvent } from "react-use"
import styled from "styled-components"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { vscode } from "@/utils/vscode"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { ClineCheckpointRestore } from "@shared/WebviewMessage"

interface CheckpointOverlayProps {
	messageTs?: number
}

export const CheckpointOverlay = ({ messageTs }: CheckpointOverlayProps) => {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreTaskDisabled, setRestoreTaskDisabled] = useState(false)
	const [restoreWorkspaceDisabled, setRestoreWorkspaceDisabled] = useState(false)
	const [restoreBothDisabled, setRestoreBothDisabled] = useState(false)
	const [showRestoreConfirm, setShowRestoreConfirm] = useState(false)
	const [hasMouseEntered, setHasMouseEntered] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const tooltipRef = useRef<HTMLDivElement>(null)

	// 当点击区域外时，关闭恢复确认框
	useClickAway(containerRef, () => {
		if (showRestoreConfirm) {
			setShowRestoreConfirm(false)
			setHasMouseEntered(false)
		}
	})

	// 处理来自扩展的消息
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		switch (message.type) {
			case "relinquishControl": {
				setCompareDisabled(false)
				setRestoreTaskDisabled(false)
				setRestoreWorkspaceDisabled(false)
				setRestoreBothDisabled(false)
				setShowRestoreConfirm(false)
				break
			}
		}
	}, [])

	useEvent("message", handleMessage)

	// 恢复任务
	const handleRestoreTask = () => {
		setRestoreTaskDisabled(true)
		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: "task" satisfies ClineCheckpointRestore,
		})
	}

	// 恢复工作区
	const handleRestoreWorkspace = () => {
		setRestoreWorkspaceDisabled(true)
		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: "workspace" satisfies ClineCheckpointRestore,
		})
	}

	// 恢复任务和工作区
	const handleRestoreBoth = () => {
		setRestoreBothDisabled(true)
		vscode.postMessage({
			type: "checkpointRestore",
			number: messageTs,
			text: "taskAndWorkspace" satisfies ClineCheckpointRestore,
		})
	}

	// 鼠标进入时设置标志
	const handleMouseEnter = () => {
		setHasMouseEntered(true)
	}

	// 鼠标离开时重置标志并关闭恢复确认框
	const handleMouseLeave = () => {
		if (hasMouseEntered) {
			setShowRestoreConfirm(false)
			setHasMouseEntered(false)
		}
	}

	// 控件鼠标离开事件处理
	const handleControlsMouseLeave = (e: React.MouseEvent) => {
		const tooltipElement = tooltipRef.current

		if (tooltipElement && showRestoreConfirm) {
			const tooltipRect = tooltipElement.getBoundingClientRect()

			// 如果鼠标移向提示框，则不关闭提示框
			if (
				e.clientY >= tooltipRect.top &&
				e.clientY <= tooltipRect.bottom &&
				e.clientX >= tooltipRect.left &&
				e.clientX <= tooltipRect.right
			) {
				return
			}
		}

		setShowRestoreConfirm(false)
		setHasMouseEntered(false)
	}

	return (
		<CheckpointControls onMouseLeave={handleControlsMouseLeave}>
			<VSCodeButton
				title="比较"
				appearance="secondary"
				disabled={compareDisabled}
				style={{ cursor: compareDisabled ? "wait" : "pointer" }}
				onClick={() => {
					setCompareDisabled(true)
					vscode.postMessage({
						type: "checkpointDiff",
						number: messageTs,
					})
				}}>
				<i className="codicon codicon-diff-multiple" style={{ position: "absolute" }} />
			</VSCodeButton>
			<div style={{ position: "relative" }} ref={containerRef}>
				<VSCodeButton
					title="恢复"
					appearance="secondary"
					style={{ cursor: "pointer" }}
					onClick={() => setShowRestoreConfirm(true)}>
					<i className="codicon codicon-discard" style={{ position: "absolute" }} />
				</VSCodeButton>
				{showRestoreConfirm && (
					<RestoreConfirmTooltip ref={tooltipRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
						<RestoreOption>
							<VSCodeButton
								onClick={handleRestoreBoth}
								disabled={restoreBothDisabled}
								style={{
									cursor: restoreBothDisabled ? "wait" : "pointer",
								}}>
								恢复任务和工作区
							</VSCodeButton>
							<p>将任务和项目文件恢复到此时间点的快照</p>
						</RestoreOption>
						<RestoreOption>
							<VSCodeButton
								onClick={handleRestoreTask}
								disabled={restoreTaskDisabled}
								style={{
									cursor: restoreTaskDisabled ? "wait" : "pointer",
								}}>
								仅恢复任务
							</VSCodeButton>
							<p>删除此时间点之后的消息（不影响工作区）</p>
						</RestoreOption>
						<RestoreOption>
							<VSCodeButton
								onClick={handleRestoreWorkspace}
								disabled={restoreWorkspaceDisabled}
								style={{
									cursor: restoreWorkspaceDisabled ? "wait" : "pointer",
								}}>
								仅恢复工作区
							</VSCodeButton>
							<p>将项目文件恢复到此时间点的快照（任务可能会不同步）</p>
						</RestoreOption>
					</RestoreConfirmTooltip>
				)}
			</div>
		</CheckpointControls>
	)
}

export const CheckpointControls = styled.div`
	position: absolute;
	top: 3px;
	right: 6px;
	display: flex;
	gap: 6px;
	opacity: 0;
	background-color: var(--vscode-sideBar-background);
	padding: 3px 0 3px 3px;

	& > vscode-button,
	& > div > vscode-button {
		width: 24px;
		height: 24px;
		position: relative;
	}

	& > vscode-button i,
	& > div > vscode-button i {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
	}
`

const RestoreOption = styled.div`
	&:not(:last-child) {
		margin-bottom: 10px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--vscode-editorGroup-border);
	}

	p {
		margin: 0 0 2px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		line-height: 14px;
	}

	&:last-child p {
		margin: 0 0 -2px 0;
	}

	vscode-button {
		width: 100%;
		margin-bottom: 10px;
	}
`

const RestoreConfirmTooltip = styled.div`
	position: absolute;
	top: calc(100% - 0.5px);
	right: 0;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 12px;
	border-radius: 3px;
	margin-top: 8px;
	width: calc(100vw - 57px);
	min-width: 0px;
	max-width: 100vw;
	z-index: 1000;

	// Add invisible padding to create a safe hover zone
	&::before {
		content: "";
		position: absolute;
		top: -8px; // Same as margin-top
		left: 0;
		right: 0;
		height: 8px;
	}

	// Adjust arrow to be above the padding
	&::after {
		content: "";
		position: absolute;
		top: -6px;
		right: 6px;
		width: 10px;
		height: 10px;
		background: ${CODE_BLOCK_BG_COLOR};
		border-left: 1px solid var(--vscode-editorGroup-border);
		border-top: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: 1; // Ensure arrow stays above the padding
	}

	p {
		margin: 0 0 6px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		white-space: normal;
		word-wrap: break-word;
	}
`
