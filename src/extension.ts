// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PromptStorage } from './storage';
import { PromptData, PromptInput } from './types';
import { PromptUtils, PromptValidator } from './validation';

// メインのWebviewパネルクラス
class PromptTemplatePanel {
	public static currentPanel: PromptTemplatePanel | undefined;
	public static readonly viewType = 'promptTemplateManager';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionUri: vscode.Uri;
	private _disposables: vscode.Disposable[] = [];
	private promptManager: PromptManager;

	public static createOrShow(extensionUri: vscode.Uri, promptManager: PromptManager) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// パネルが既に開いている場合は表示
		if (PromptTemplatePanel.currentPanel) {
			PromptTemplatePanel.currentPanel._panel.reveal(column);
			return;
		}

		// 新しいパネルを作成
		const panel = vscode.window.createWebviewPanel(
			PromptTemplatePanel.viewType,
			'Prompt Template Manager',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [extensionUri]
			}
		);

		PromptTemplatePanel.currentPanel = new PromptTemplatePanel(panel, extensionUri, promptManager);
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, promptManager: PromptManager) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this.promptManager = promptManager;

		// パネルのHTMLコンテンツを設定
		this._update();

		// パネルが閉じられた時のリスナーを設定
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Webviewからのメッセージを処理
		this._panel.webview.onDidReceiveMessage(
			async (message) => {
				await this._handleWebviewMessage(message);
			},
			null,
			this._disposables
		);

		// 初期データを送信
		this._sendPromptsToWebview();
	}

	public dispose() {
		PromptTemplatePanel.currentPanel = undefined;

		// パネルをクリーンアップ
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public refresh() {
		this._sendPromptsToWebview();
	}

	private async _sendPromptsToWebview() {
		const prompts = this.promptManager.getCurrentDisplayPrompts();
		console.log(`WebViewにプロンプトを送信: ${prompts.length}件`, prompts);
		await this._panel.webview.postMessage({
			type: 'updatePrompts',
			prompts: prompts,
			selectedPromptId: this.promptManager.getSelectedPromptId(),
			isSearching: this.promptManager.isSearching()
		});
	}

	private async _handleWebviewMessage(message: any) {
		switch (message.type) {
			case 'ready':
				// Webview初期化完了時にデータを送信
				// ウィンドウ再開時は選択状態と検索状態をクリア
				this.promptManager.setSelectedPrompt(null);
				this.promptManager.clearSearchState();
				await this._sendPromptsToWebview();
				break;

			case 'searchPrompts':
				const searchQuery = message.query;
				const searchOptions = message.options || {};
				console.log(`検索実行: クエリ="${searchQuery}", オプション:`, searchOptions);
				
				// 検索時は選択状態をクリア
				this.promptManager.setSelectedPrompt(null);
				
				// 検索状態を設定
				if (searchQuery && searchQuery.trim() !== '') {
					this.promptManager.setSearchState(searchQuery, searchOptions);
				} else {
					this.promptManager.clearSearchState();
				}
				
				const searchResults = this.promptManager.getCurrentDisplayPrompts();
				await this._panel.webview.postMessage({
					type: 'updatePrompts',
					prompts: searchResults,
					selectedPromptId: this.promptManager.getSelectedPromptId(),
					isSearching: this.promptManager.isSearching(),
					searchQuery: searchQuery,
					searchHighlight: true
				});
				break;

			case 'selectPrompt':
				const promptId = message.id;
				console.log(`プロンプト選択: ID=${promptId}`);
				
				// 選択中プロンプトを設定
				this.promptManager.setSelectedPrompt(promptId);
				
				// 選択されたプロンプトデータを取得（全プロンプトから検索）
				const allPrompts = this.promptManager.getPrompts();
				const selectedPrompt = allPrompts.find(p => p.id === promptId);
				if (selectedPrompt) {
					// プロンプト一覧を更新（検索状態を保持し、選択中プロンプトが上位に移動）
					await this._sendPromptsToWebview();
					
					// プロンプト詳細を表示（使用回数は増加させない）
					await this._panel.webview.postMessage({
						type: 'showPromptDetail',
						prompt: selectedPrompt
					});
				} else {
					console.error(`プロンプトが見つかりません: ID=${promptId}`);
				}
				break;

			case 'createPrompt':
				await this._showCreatePromptDialog();
				break;

			case 'deletePrompt':
				await this._deletePrompt(message.id);
				break;

			case 'copyPrompt':
				const copyPromptId = message.id;
				console.log(`プロンプトコピー: ID=${copyPromptId}`);
				
				// 使用回数を増加
				const copyIncrementSuccess = await this.promptManager.incrementUsage(copyPromptId);
				if (copyIncrementSuccess) {
					console.log(`コピー使用回数増加成功: ID=${copyPromptId}`);
					// プロンプト一覧を更新（使用回数順に再ソート）
					await this._sendPromptsToWebview();
				}
				
				await this._copyPromptToClipboard(message.content);
				break;

			case 'executePrompt':
				const executePromptId = message.promptId;
				console.log(`プロンプト実行: ID=${executePromptId}`);
				
				// 使用回数を増加
				if (executePromptId) {
					const executeIncrementSuccess = await this.promptManager.incrementUsage(executePromptId);
					if (executeIncrementSuccess) {
						console.log(`実行使用回数増加成功: ID=${executePromptId}`);
						// プロンプト一覧を更新（使用回数順に再ソート）
						await this._sendPromptsToWebview();
					}
				}
				
				await this._executePrompt(message.content);
				break;

			case 'updatePrompt':
				await this._updatePrompt(message.id, message.updates);
				break;

			default:
				console.warn('Unknown message type:', message.type);
		}
	}

	private async _showCreatePromptDialog() {
		console.log('プロンプト作成ダイアログを開始');
		const title = await vscode.window.showInputBox({
			prompt: 'プロンプトのタイトルを入力してください',
			placeHolder: 'タイトル'
		});

		if (!title) {
			console.log('タイトルが未入力のため作成をキャンセル');
			return;
		}

		const content = await vscode.window.showInputBox({
			prompt: 'プロンプトの内容を入力してください',
			placeHolder: 'プロンプトの内容...'
		});

		if (!content) {
			console.log('内容が未入力のため作成をキャンセル');
			return;
		}

		console.log(`プロンプト作成中: タイトル="${title}", 内容="${content}"`);
		const result = await this.promptManager.addPrompt({
			title,
			content
		});

		if (result) {
			console.log('プロンプト作成成功:', result);
			// 新規作成したプロンプトを選択状態に
			this.promptManager.setSelectedPrompt(result.id);
			await this._sendPromptsToWebview();
			
			// 新規作成したプロンプトの詳細を表示
			await this._panel.webview.postMessage({
				type: 'showPromptDetail',
				prompt: result
			});
		} else {
			console.log('プロンプト作成失敗');
		}
	}



	private async _deletePrompt(id: string) {
		const prompt = this.promptManager.getPrompts().find(p => p.id === id);
		if (!prompt) return;

		// 削除対象が選択中のプロンプトかどうかをチェック
		const wasSelected = this.promptManager.isSelectedPrompt(id);

		// 確認なしで削除
		const success = await this.promptManager.deletePrompt(id);
		if (success) {
			// 選択中のプロンプトが削除された場合は選択をクリア
			if (wasSelected) {
				this.promptManager.setSelectedPrompt(null);
				// 詳細パネルをクリア
				await this._panel.webview.postMessage({
					type: 'clearPromptDetail'
				});
			}
			await this._sendPromptsToWebview();
		}
	}

	private async _copyPromptToClipboard(content: string) {
		await vscode.env.clipboard.writeText(content);
	}

	private async _executePrompt(content: string) {
		// ここで実際のAIチャット入力欄への挿入処理を実装
		await vscode.env.clipboard.writeText(content);
	}

	private async _updatePrompt(id: string, updates: any) {
		const success = await this.promptManager.updatePrompt(id, updates);
		if (success) {
			await this._sendPromptsToWebview();
			
			// 更新されたプロンプトの詳細を再表示
			const updatedPrompt = this.promptManager.getPrompts().find(p => p.id === id);
			if (updatedPrompt) {
				await this._panel.webview.postMessage({
					type: 'showPromptDetail',
					prompt: updatedPrompt
				});
			}
		}
	}

	private _update() {
		this._panel.webview.html = this._getHtmlForWebview();
	}

	private _getHtmlForWebview(): string {
		return `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Prompt Template Manager</title>
	<style>
		* {
			box-sizing: border-box;
		}
		
		body { 
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			margin: 0;
			padding: 0;
			font-size: var(--vscode-font-size);
		}
		
		.container {
			display: flex;
			height: calc(100vh - 40px);
			gap: 1px;
			min-height: 400px;
			flex-direction: row; /* デフォルトは横並び */
		}


		
		.panel {
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}
		
		.search-panel {
			flex: 0 0 280px;
			padding: 16px;
			overflow: hidden;
			height: 100%;
			display: flex;
			flex-direction: column;
		}
		
		.detail-panel {
			flex: 1;
			padding: 16px;
			overflow-y: auto;
			height: 100%;
		}
		
		.variable-panel {
			flex: 0 0 280px;
			padding: 16px;
			overflow: hidden;
			height: 100%;
			display: flex;
			flex-direction: column;
		}
		
		.search-header {
			flex: none;
			margin-bottom: 12px;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		/* 非表示時のヘッダー中央寄せ */
		.container.search-hidden .search-header,
		.container.detail-hidden .search-header,
		.container.variable-hidden .variable-header {
			justify-content: center;
		}
		
		.add-button {
			width: 100%;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 10px 16px;
			border-radius: 4px;
			cursor: pointer;
			margin-bottom: 12px;
			font-size: 13px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		
		.add-button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		
		.search-box {
			width: 100%;
			padding: 8px 12px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			font-size: 13px;
		}
		
		.search-box:focus {
			border-color: var(--vscode-focusBorder);
			outline: none;
		}
		
		.prompt-list {
			flex: 1;
			overflow-y: auto;
			margin-top: 12px;
		}
		
		.prompt-item {
			background: var(--vscode-list-inactiveSelectionBackground);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			padding: 12px;
			margin-bottom: 8px;
			cursor: pointer;
			transition: all 0.2s ease;
			position: relative;
		}
		
		.prompt-item:hover {
			background: var(--vscode-list-hoverBackground);
			border-color: var(--vscode-list-hoverForeground);
		}
		
		.prompt-item.selected {
			background: var(--vscode-list-activeSelectionBackground);
			border-color: var(--vscode-focusBorder);
			color: var(--vscode-list-activeSelectionForeground);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder);
		}
		
		.prompt-title {
			font-weight: bold;
			font-size: 14px;
			margin-bottom: 4px;
			color: var(--vscode-foreground);
		}
		
		.prompt-summary {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			margin-bottom: 6px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		
		.prompt-meta {
			display: flex;
			justify-content: flex-start;
			align-items: center;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		}
		
		.usage-count {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 6px;
			border-radius: 10px;
		}
		
		.favorite-icon {
			color: #FFD700;
		}
		
		.tags {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			margin-top: 6px;
		}
		
		.tag {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			padding: 2px 6px;
			border-radius: 3px;
			font-size: 10px;
		}
		
		.detail-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 16px;
			padding-bottom: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		
		.detail-title {
			font-size: 18px;
			font-weight: bold;
			margin: 0;
			color: var(--vscode-foreground);
		}
		
		.detail-actions {
			display: flex;
			gap: 8px;
		}
		
		.action-button {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none;
			padding: 6px 12px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
		}
		
		.action-button:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		
		.detail-content {
			background: var(--vscode-textCodeBlock-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 16px;
			margin-bottom: 16px;
			font-family: var(--vscode-editor-font-family);
			font-size: 13px;
			line-height: 1.5;
			white-space: pre-wrap;
			word-wrap: break-word;
		}
		
		.editable {
			cursor: pointer;
			border: 1px solid transparent;
			border-radius: 3px;
			padding: 4px;
			transition: all 0.2s ease;
		}
		
		.editable:hover {
			background-color: var(--vscode-list-hoverBackground);
			border-color: var(--vscode-input-border);
		}
		
		.editing {
			background-color: var(--vscode-input-background);
			border-color: var(--vscode-focusBorder);
			cursor: text;
		}
		
		.edit-input {
			width: 100%;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-focusBorder);
			border-radius: 3px;
			padding: 4px 8px;
			font-size: inherit;
			font-family: inherit;
			resize: none;
			outline: none;
		}
		
		.edit-textarea {
			min-height: 100px;
			font-family: var(--vscode-editor-font-family);
		}
		
		.variable-highlight {
			background: var(--vscode-editor-selectionHighlightBackground);
			color: var(--vscode-editor-foreground);
			padding: 2px 4px;
			border-radius: 3px;
			border: 1px solid var(--vscode-focusBorder);
			font-weight: bold;
		}
		
		.detail-meta {
			display: flex;
			gap: 12px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}
		
		.meta-item {
			display: flex;
		}
		
		.variable-header {
			flex: none;
			margin-bottom: 12px;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		
		.variable-title {
			font-size: 16px;
			font-weight: bold;
			margin: 0 0 8px 0;
			color: var(--vscode-foreground);
		}
		
		.variable-list {
			margin-bottom: 16px;
		}
		
		.variable-item {
			margin-bottom: 12px;
		}
		
		.variable-label {
			display: block;
			font-size: 12px;
			font-weight: bold;
			margin-bottom: 4px;
			color: var(--vscode-foreground);
		}
		
		.variable-input {
			width: 100%;
			padding: 6px 8px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
			font-size: 12px;
		}
		
		.variable-input:focus {
			border-color: var(--vscode-focusBorder);
			outline: none;
		}
		
		.execute-button {
			width: 100%;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 10px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 13px;
			font-weight: bold;
		}
		
		.execute-button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		
		.execute-button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		
		.empty-state {
			text-align: center;
			padding: 40px 20px;
			color: var(--vscode-descriptionForeground);
		}
		
		.empty-icon {
			font-size: 48px;
			margin-bottom: 16px;
		}
		
		.scrollbar {
			scrollbar-width: thin;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}
		
		.scrollbar::-webkit-scrollbar {
			width: 8px;
		}
		
		.scrollbar::-webkit-scrollbar-track {
			background: transparent;
		}
		
		.scrollbar::-webkit-scrollbar-thumb {
			background-color: var(--vscode-scrollbarSlider-background);
			border-radius: 4px;
		}
		
		.scrollbar::-webkit-scrollbar-thumb:hover {
			background-color: var(--vscode-scrollbarSlider-hoverBackground);
		}



		/* 通知 */
		.notification {
			position: fixed;
			top: 20px;
			right: 20px;
			background: var(--vscode-notifications-background);
			border: 1px solid var(--vscode-notifications-border);
			color: var(--vscode-notifications-foreground);
			padding: 12px 16px;
			border-radius: 4px;
			min-width: 200px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
			z-index: 2000;
			transform: translateX(100%);
			transition: transform 0.3s ease;
		}

		.notification.show {
			transform: translateX(0);
		}

		.notification-success {
			border-left: 4px solid #4CAF50;
		}

		.notification-error {
			border-left: 4px solid #f44336;
		}

		.notification-warning {
			border-left: 4px solid #ff9800;
		}

		.notification-info {
			border-left: 4px solid #2196F3;
		}

		/* パネル切り替えボタン */
		.panel-toggle-btn {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none;
			padding: 4px 8px;
			border-radius: 3px;
			cursor: pointer;
			font-size: 11px;
			min-width: 24px;
			height: 24px;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.panel-toggle-btn:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		.panel-header-title {
			flex: 1;
			margin: 0;
			font-size: 14px;
			font-weight: bold;
			color: var(--vscode-foreground);
		}

		/* 非表示状態のパネル */
		.panel.hidden {
			display: none !important;
		}

		/* パネルが非表示の時のレイアウト調整 */
		.container.search-hidden .search-panel {
			flex: 0 0 auto;
			width: 50px;
		}

		.container.search-hidden .search-content,
		.container.search-hidden .prompt-list {
			display: none;
		}

		.container.search-hidden .panel-header-title {
			display: none;
		}

		.container.detail-hidden .detail-panel {
			flex: 0 0 auto;
			width: 50px;
		}

		.container.detail-hidden #promptDetail {
			display: none;
		}

		.container.detail-hidden .panel-header-title {
			display: none;
		}

		.container.variable-hidden .variable-panel {
			flex: 0 0 auto;
			width: 50px;
		}

		.container.variable-hidden #variablePanel {
			display: none;
		}

		.container.variable-hidden .panel-header-title {
			display: none;
		}


			.search-panel.collapsed {
				display: block !important;
				flex: 0 0 auto !important;
				height: 35vh !important;
				width: 100% !important;
				overflow: visible !important;
			}
		}

		/* 極超極小画面（250px以下）：最小機能表示 */
		@media screen and (max-width: 250px) {
			.container {
				flex-direction: column !important;
				height: 100vh !important;
				display: flex !important;
			}
			
			.search-panel {
				flex: 1 !important;
				width: 100% !important;
				min-height: 20vh;
				max-height: 30vh;
				padding: 4px;
			}
			
			.detail-panel {
				flex: 2 !important;
				width: 100% !important;
				min-height: 40vh;
				padding: 4px;
			}
			
			.variable-panel {
				flex: 1 !important;
				width: 100% !important;
				min-height: 20vh;
				max-height: 30vh;
				padding: 4px;
			}
			
			.add-button {
				font-size: 10px;
				padding: 6px 8px;
				margin-bottom: 4px;
				width: 100%;
			}
			
			.search-box {
				font-size: 11px;
				padding: 4px 6px;
				width: 100%;
			}
			
			.prompt-item {
				padding: 2px;
				margin-bottom: 1px;
			}
			
			.prompt-title {
				font-size: 9px;
			}
			
			.prompt-summary {
				font-size: 8px;
			}
			
			.detail-title {
				font-size: 10px;
			}
			
			.detail-content {
				padding: 2px;
				font-size: 8px;
			}
			
			.execute-button {
				font-size: 12px;
				padding: 8px 12px;
				width: 100%;
			}
			
			.prompt-list {
				height: calc(100% - 60px);
				max-height: none;
			}
			
			.panel-toggle {
				display: none !important;
			}
		}

		/* 横幅優先モード：縦が小さい場合（高さ400px以下） */
		@media screen and (max-height: 400px) {
			.detail-panel {
				min-height: 200px;
			}
		}

		/* 折りたたみ可能な左パネル（小画面用） */
		.panel-toggle {
			display: none;
			position: absolute;
			top: 10px;
			right: 10px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 3px;
			padding: 4px 8px;
			font-size: 12px;
			cursor: pointer;
			z-index: 100;
		}

		@media screen and (max-width: 900px) {
			.panel-toggle {
				display: block;
			}
			
			.search-panel.collapsed {
				flex: 0 0 40px;
				overflow: hidden;
			}
			
			.search-panel.collapsed .search-header,
			.search-panel.collapsed .prompt-list {
				display: none;
			}
		}

		/* コンパクトモード：高さが制限されている場合 */
		body.compact-mode .container {
			height: auto;
			max-height: 400px;
		}

		body.compact-mode .search-panel {
			max-height: 60px;
		}

		body.compact-mode .detail-panel {
			min-height: 150px;
		}

		body.compact-mode .variable-panel {
			max-height: 60px;
		}

		body.compact-mode .prompt-list {
			max-height: 40px;
		}

		body.compact-mode .detail-content {
			max-height: 100px;
			overflow-y: auto;
		}

		/* スクロール最適化 */
		.detail-content {
			overflow-y: auto;
		}

		.prompt-list {
			overflow-y: auto;
		}
	</style>
</head>
<body>
	<div class="container">
		<!-- 左側: 検索・一覧パネル -->
		<div class="panel search-panel scrollbar" id="searchPanel">
			<div class="search-header">
				<h3 class="panel-header-title">📝 プロンプト一覧</h3>
				<button class="panel-toggle-btn" onclick="togglePanel('search')" title="パネルの表示/非表示">
					👁️
				</button>
			</div>
			<div class="search-content">
				<button class="add-button" onclick="createPrompt()">
					➕ 新しいプロンプトを追加
				</button>
				<input 
					type="text" 
					class="search-box" 
					id="searchInput"
					placeholder="プロンプトを検索..." 
					oninput="searchPrompts(this.value)"
				/>
			</div>
			<div class="prompt-list scrollbar" id="promptList">
				<div class="empty-state">
					<div class="empty-icon">📭</div>
					<div>プロンプトがありません</div>
					<div style="margin-top: 8px; font-size: 11px;">「新しいプロンプトを追加」から始めましょう</div>
				</div>
			</div>
		</div>
		
		<!-- 中央: 詳細表示パネル -->
		<div class="panel detail-panel scrollbar" id="detailPanel">
			<div class="search-header">
				<h3 class="panel-header-title">📄 プロンプト詳細</h3>
				<button class="panel-toggle-btn" onclick="togglePanel('detail')" title="パネルの表示/非表示">
					👁️
				</button>
			</div>
			<div id="promptDetail" style="flex: 1; overflow-y: auto;">
				<div class="empty-state">
					<div class="empty-icon">👈</div>
					<div>左側からプロンプトを選択してください</div>
				</div>
			</div>
		</div>
		
		<!-- 右側: 変数設定パネル -->
		<div class="panel variable-panel scrollbar" id="variableContainer">
			<div class="variable-header">
				<h3 class="panel-header-title">⚙️ 変数設定</h3>
				<button class="panel-toggle-btn" onclick="togglePanel('variable')" title="パネルの表示/非表示">
					👁️
				</button>
			</div>
			<div id="variablePanel" style="flex: 1; overflow-y: auto;">
				<div class="empty-state">
					<div class="empty-icon">⚙️</div>
					<div>プロンプトを選択すると<br>変数設定が表示されます</div>
					<div style="margin-top: 12px; font-size: 11px;">（レベル5で実装予定）</div>
				</div>
			</div>
		</div>
	</div>
	
	<script>
		const vscode = acquireVsCodeApi();
		let currentPrompts = [];
		let selectedPrompt = null;
		
		// VS Code からのメッセージを受信
		window.addEventListener('message', event => {
			const message = event.data;
			
			switch (message.type) {
				case 'updatePrompts':
					updatePromptList(message.prompts, message.selectedPromptId, message.isSearching);
					break;
				case 'showPromptDetail':
					showPromptDetail(message.prompt);
					break;
				case 'clearPromptDetail':
					clearPromptDetail();
					break;
			}
		});
		
		// 初期化完了を通知
		document.addEventListener('DOMContentLoaded', () => {
			initKeyboardShortcuts();
			initResponsiveLayout();
			vscode.postMessage({ type: 'ready' });
		});

		// レスポンシブレイアウトの初期化
		function initResponsiveLayout() {
			// ウィンドウサイズ変更時の処理
			window.addEventListener('resize', handleResize);
			
			// 初期レイアウトの調整
			handleResize();
		}

		function handleResize() {
			// 画面サイズに関係なく常に同じレイアウトを維持
			console.log('ウィンドウサイズ:', window.innerWidth);
		}
		
		// キーボードナビゲーション
		document.addEventListener('keydown', (event) => {
			handleKeyboardNavigation(event);
		});
		
		// キーボードナビゲーションを処理
		function handleKeyboardNavigation(event) {
			// Ctrl+N: 新しいプロンプト作成
			if (event.ctrlKey && event.key === 'n') {
				event.preventDefault();
				createPrompt();
				return;
			}
			
			// Enter: 選択されているプロンプトの詳細表示
			if (event.key === 'Enter' && !event.ctrlKey && !event.shiftKey) {
				const selectedItem = document.querySelector('.prompt-item.selected');
				if (selectedItem) {
					event.preventDefault();
					selectPrompt(selectedItem.dataset.id);
				}
				return;
			}
			
			// 矢印キー: プロンプト選択
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				navigatePromptList(event.key === 'ArrowDown' ? 1 : -1);
				return;
			}
			
			// Delete: 選択されているプロンプトを削除
			if (event.key === 'Delete') {
				const selectedItem = document.querySelector('.prompt-item.selected');
				if (selectedItem) {
					event.preventDefault();
					deletePrompt(selectedItem.dataset.id);
				}
				return;
			}
			
			// Escape: 検索ボックスをクリア
			if (event.key === 'Escape') {
				const searchBox = document.getElementById('searchBox');
				if (searchBox && searchBox.value) {
					event.preventDefault();
					searchBox.value = '';
					searchPrompts('');
					searchBox.focus();
				}
				return;
			}
			
			// /: 検索ボックスにフォーカス
			if (event.key === '/' && !event.ctrlKey && !event.altKey) {
				const searchBox = document.getElementById('searchBox');
				if (searchBox && document.activeElement !== searchBox) {
					event.preventDefault();
					searchBox.focus();
					searchBox.select();
				}
				return;
			}
		}
		
		// プロンプト一覧をナビゲート
		function navigatePromptList(direction) {
			const items = document.querySelectorAll('.prompt-item');
			if (items.length === 0) return;
			
			const selectedItem = document.querySelector('.prompt-item.selected');
			let newIndex = 0;
			
			if (selectedItem) {
				const currentIndex = Array.from(items).indexOf(selectedItem);
				newIndex = currentIndex + direction;
				
				// 範囲チェック
				if (newIndex < 0) newIndex = items.length - 1;
				if (newIndex >= items.length) newIndex = 0;
			}
			
			// 新しいアイテムを選択
			const newItem = items[newIndex];
			document.querySelectorAll('.prompt-item').forEach(item => {
				item.classList.remove('selected');
			});
			newItem.classList.add('selected');
			
			// スクロールして表示
			newItem.scrollIntoView({ 
				behavior: 'smooth', 
				block: 'nearest' 
			});
		}
		
		// プロンプト一覧を更新
		function updatePromptList(prompts, selectedPromptId = null, isSearching = false) {
			console.log('updatePromptList called with:', prompts, 'selectedId:', selectedPromptId, 'isSearching:', isSearching);
			currentPrompts = prompts;
			const listElement = document.getElementById('promptList');
			
			if (prompts.length === 0) {
				console.log('プロンプトが0件のため空の状態を表示');
				listElement.innerHTML = \`
					<div class="empty-state">
						<div class="empty-icon">📭</div>
						<div>プロンプトがありません</div>
						<div style="margin-top: 8px; font-size: 11px;">「新しいプロンプトを追加」から始めましょう</div>
					</div>
				\`;
				return;
			}
			
			listElement.innerHTML = prompts.map(prompt => {
				const isSelected = selectedPromptId === prompt.id;
				return \`
					<div class="prompt-item\${isSelected ? ' selected' : ''}" 
						onclick="selectPrompt('\${prompt.id}')" 
						data-id="\${prompt.id}">
						<div class="prompt-title">
							\${prompt.isFavorite ? '<span class="favorite-icon">⭐</span> ' : ''}\${escapeHtml(prompt.title)}
						</div>
						<div class="prompt-summary">\${escapeHtml(prompt.content.substring(0, 60))}\${prompt.content.length > 60 ? '...' : ''}</div>
						<div class="prompt-meta">
							<span>使用回数: <span class="usage-count">\${prompt.usageCount}</span></span>
						</div>
					</div>
				\`;
			}).join('');
		}
		
		// プロンプトを選択
		function selectPrompt(id) {
			// 選択状態を更新
			document.querySelectorAll('.prompt-item').forEach(item => {
				item.classList.remove('selected');
			});
			document.querySelector(\`[data-id="\${id}"]\`).classList.add('selected');
			
			vscode.postMessage({ type: 'selectPrompt', id });
		}
		
		// プロンプト詳細を表示
		function showPromptDetail(prompt) {
			selectedPrompt = prompt;
			const detailElement = document.getElementById('promptDetail');
			
			// プロンプト内容をハイライト（変数部分を強調表示）
			const highlightedContent = highlightVariables(prompt.content);
			
			detailElement.innerHTML = \`
				<div class="detail-header">
					<h2 class="detail-title editable" onclick="startEditTitle()" title="クリックして編集">\${prompt.isFavorite ? '⭐ ' : ''}\${escapeHtml(prompt.title)}</h2>
					<div class="detail-actions">
						<button class="action-button" onclick="deletePrompt('\${prompt.id}')">🗑️</button>
						<button class="action-button" onclick="copyPrompt('\${prompt.id}')">📋</button>
					</div>
				</div>
				
				<div class="detail-content editable" onclick="startEditContent()" title="クリックして編集">\${highlightedContent}</div>
				
				<div class="detail-meta">
					<div class="meta-item">
						<span>使用回数:</span>
						<span>\${prompt.usageCount}回</span>
					</div>
				</div>
			\`;
			
			updateVariablePanel(prompt);
		}
		
		// 変数部分をハイライト
		function highlightVariables(content) {
			const escaped = escapeHtml(content);
			return escaped.replace(
				/\\{([a-zA-Z][a-zA-Z0-9_]*)\\}/g, 
				'<span class="variable-highlight">{\$1}</span>'
			);
		}
		
		// 変数パネルを更新
		function updateVariablePanel(prompt) {
			const variableElement = document.getElementById('variablePanel');
			
			// プロンプト内容から変数を抽出（レベル5で本格実装予定）
			const variables = extractVariables(prompt.content);
			
			if (variables.length === 0) {
				variableElement.innerHTML = \`
					<div class="empty-state">
						<div class="empty-icon">✅</div>
						<div>このプロンプトには<br>変数がありません</div>
						<button class="execute-button" onclick="executePrompt()">
							🚀 プロンプトを実行
						</button>
					</div>
				\`;
			} else {
				variableElement.innerHTML = \`
					<div class="variable-list">
						\${variables.map(variable => \`
							<div class="variable-item">
								<label class="variable-label" for="var_\${variable}">\${variable}:</label>
								<input 
									type="text" 
									class="variable-input" 
									id="var_\${variable}"
									placeholder="値を入力..."
									oninput="updateExecuteButton()"
								/>
							</div>
						\`).join('')}
					</div>
					<button class="execute-button" id="executeBtn" onclick="executePrompt()" disabled>
						🚀 プロンプトを実行
					</button>
				\`;
			}
		}
		
		// 変数を抽出（簡易版、レベル5で本格実装）
		function extractVariables(content) {
			const regex = /\\{([a-zA-Z][a-zA-Z0-9_]*)\\}/g;
			const variables = [];
			let match;
			
			while ((match = regex.exec(content)) !== null) {
				if (!variables.includes(match[1])) {
					variables.push(match[1]);
				}
			}
			
			return variables;
		}
		
		// 実行ボタンの状態を更新
		function updateExecuteButton() {
			const executeBtn = document.getElementById('executeBtn');
			if (!executeBtn) return;
			
			const inputs = document.querySelectorAll('.variable-input');
			const allFilled = Array.from(inputs).every(input => input.value.trim() !== '');
			
			executeBtn.disabled = !allFilled;
		}
		
		// プロンプトを検索
		function searchPrompts(query) {
			vscode.postMessage({ type: 'searchPrompts', query });
		}

		// プロンプト詳細をクリア
		function clearPromptDetail() {
			selectedPrompt = null;
			const detailElement = document.getElementById('promptDetail');
			detailElement.innerHTML = \`
				<div class="empty-state">
					<div class="empty-icon">👈</div>
					<div>左側からプロンプトを選択してください</div>
				</div>
			\`;
			
			// 変数パネルもクリア
			const variableElement = document.getElementById('variablePanel');
			variableElement.innerHTML = \`
				<div class="empty-state">
					<div class="empty-icon">⚙️</div>
					<div>プロンプトを選択すると<br>変数設定が表示されます</div>
					<div style="margin-top: 12px; font-size: 11px;">（レベル5で実装予定）</div>
				</div>
			\`;
		}
		
		// タイトル編集を開始
		function startEditTitle() {
			if (!selectedPrompt) return;
			
			const titleElement = document.querySelector('.detail-title');
			if (!titleElement || titleElement.classList.contains('editing')) return;
			
			const currentTitle = selectedPrompt.title;
			const favoriteIcon = selectedPrompt.isFavorite ? '⭐ ' : '';
			
			titleElement.classList.add('editing');
			titleElement.innerHTML = \`
				\${favoriteIcon}<input 
					type="text" 
					class="edit-input" 
					value="\${escapeHtml(currentTitle)}" 
					onblur="saveTitle(this.value)"
					onkeydown="handleTitleKeydown(event, this.value)"
					style="display: inline-block; width: auto; min-width: 200px;"
				/>
			\`;
			
			const input = titleElement.querySelector('.edit-input');
			input.focus();
			input.select();
		}
		
		// コンテンツ編集を開始
		function startEditContent() {
			if (!selectedPrompt) return;
			
			const contentElement = document.querySelector('.detail-content');
			if (!contentElement || contentElement.classList.contains('editing')) return;
			
			const currentContent = selectedPrompt.content;
			
			contentElement.classList.add('editing');
			contentElement.innerHTML = \`
				<textarea 
					class="edit-input edit-textarea" 
					onblur="saveContent(this.value)"
					onkeydown="handleContentKeydown(event)"
				>\${escapeHtml(currentContent)}</textarea>
			\`;
			
			const textarea = contentElement.querySelector('.edit-textarea');
			textarea.focus();
		}
		
		// タイトル保存
		function saveTitle(newTitle) {
			if (!selectedPrompt) return;
			
			newTitle = newTitle.trim();
			if (newTitle === '' || newTitle === selectedPrompt.title) {
				cancelTitleEdit();
				return;
			}
			
			vscode.postMessage({ 
				type: 'updatePrompt', 
				id: selectedPrompt.id,
				updates: { title: newTitle }
			});
			
			// 暫定的に表示を更新
			selectedPrompt.title = newTitle;
			cancelTitleEdit();
		}
		
		// コンテンツ保存
		function saveContent(newContent) {
			if (!selectedPrompt) return;
			
			if (newContent.trim() === '' || newContent === selectedPrompt.content) {
				cancelContentEdit();
				return;
			}
			
			vscode.postMessage({ 
				type: 'updatePrompt', 
				id: selectedPrompt.id,
				updates: { content: newContent }
			});
			
			// 暫定的に表示を更新
			selectedPrompt.content = newContent;
			cancelContentEdit();
		}
		
		// タイトル編集キャンセル
		function cancelTitleEdit() {
			if (!selectedPrompt) return;
			
			const titleElement = document.querySelector('.detail-title');
			if (!titleElement) return;
			
			titleElement.classList.remove('editing');
			const favoriteIcon = selectedPrompt.isFavorite ? '⭐ ' : '';
			titleElement.innerHTML = \`\${favoriteIcon}\${escapeHtml(selectedPrompt.title)}\`;
		}
		
		// コンテンツ編集キャンセル
		function cancelContentEdit() {
			if (!selectedPrompt) return;
			
			const contentElement = document.querySelector('.detail-content');
			if (!contentElement) return;
			
			contentElement.classList.remove('editing');
			const highlightedContent = highlightVariables(selectedPrompt.content);
			contentElement.innerHTML = highlightedContent;
		}
		
		// タイトル編集時のキーボード処理
		function handleTitleKeydown(event, value) {
			if (event.key === 'Enter') {
				event.preventDefault();
				saveTitle(value);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				cancelTitleEdit();
			}
		}
		
		// コンテンツ編集時のキーボード処理
		function handleContentKeydown(event) {
			if (event.key === 'Escape') {
				event.preventDefault();
				cancelContentEdit();
			} else if (event.ctrlKey && event.key === 'Enter') {
				event.preventDefault();
				saveContent(event.target.value);
			}
		}



		// 通知機能は削除しました

		// キーボードショートカット
		function initKeyboardShortcuts() {
			document.addEventListener('keydown', (e) => {
				// Ctrl+F: 検索フォーカス
				if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
					e.preventDefault();
					const searchInput = document.getElementById('searchInput');
					if (searchInput) {
						searchInput.focus();
						searchInput.select();
					}
				}
				
				// Ctrl+N: 新規プロンプト作成
				if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
					e.preventDefault();
					createPrompt();
				}
				
				// Ctrl+Enter: 選択したプロンプトを実行
				if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
					e.preventDefault();
					if (selectedPrompt) {
						executePrompt();
					}
				}
				
				// Ctrl+C: 選択したプロンプトをコピー
				if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
					const activeElement = document.activeElement;
					// テキスト入力中でない場合のみ実行
					if (activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
						e.preventDefault();
						if (selectedPrompt) {
							copyPrompt(selectedPrompt.id);
						}
					}
				}
				
				// Delete: 選択したプロンプトを削除
				if (e.key === 'Delete' && selectedPrompt) {
					e.preventDefault();
					deletePrompt(selectedPrompt.id);
				}
				

			});
		}

		// パネルの表示・非表示切り替え機能
		function togglePanel(panelType) {
			const container = document.querySelector('.container');
			let className, panelName, buttonSelector;
			
			switch (panelType) {
				case 'search':
					className = 'search-hidden';
					panelName = 'プロンプト一覧';
					buttonSelector = '#searchPanel .panel-toggle-btn';
					break;
				case 'detail':
					className = 'detail-hidden';
					panelName = 'プロンプト詳細';
					buttonSelector = '#detailPanel .panel-toggle-btn';
					break;
				case 'variable':
					className = 'variable-hidden';
					panelName = '変数設定';
					buttonSelector = '#variableContainer .panel-toggle-btn';
					break;
				default:
					return;
			}
			
			const button = document.querySelector(buttonSelector);
			
			if (container.classList.contains(className)) {
				container.classList.remove(className);
				button.textContent = '👁️';
				button.title = 'パネルを非表示にする';
			} else {
				container.classList.add(className);
				button.textContent = '👀';
				button.title = 'パネルを表示する';
			}
		}
		
		// 新しいプロンプトを作成
		function createPrompt() {
			vscode.postMessage({ type: 'createPrompt' });
		}
		
		// プロンプトを削除
		function deletePrompt(id) {
			vscode.postMessage({ type: 'deletePrompt', id });
		}
		
		// プロンプトをコピー
		function copyPrompt(id) {
			const prompt = currentPrompts.find(p => p.id === id);
			if (prompt) {
				vscode.postMessage({ 
					type: 'copyPrompt', 
					id: id,
					content: prompt.content 
				});
			}
		}
		
		// プロンプトを実行
		function executePrompt() {
			if (!selectedPrompt) return;
			
			let content = selectedPrompt.content;
			
			// 変数を置換
			const inputs = document.querySelectorAll('.variable-input');
			inputs.forEach(input => {
				const variableName = input.id.replace('var_', '');
				const value = input.value.trim();
				content = content.replace(new RegExp(\`\\\\{\${variableName}\\\\}\`, 'g'), value);
			});
			
			vscode.postMessage({ 
				type: 'executePrompt', 
				promptId: selectedPrompt.id,
				content 
			});
		}
		
		// ユーティリティ関数
		function escapeHtml(text) {
			const div = document.createElement('div');
			div.textContent = text;
			return div.innerHTML;
		}
		
		function formatDate(dateStr) {
			const date = new Date(dateStr);
			return date.toLocaleDateString('ja-JP', {
				month: 'short',
				day: 'numeric'
			});
		}
	</script>
</body>
</html>`;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Prompt Template Manager が起動しました！');
	console.log('Extension Context:', context);
	console.log('Extension URI:', context.extensionUri.toString());
	
	try {
		// Prompt Template Manager が正常にアクティベートされました
	} catch (error) {
		console.error('初期メッセージ表示エラー:', error);
	}

	// プロンプトマネージャーの初期化
	let promptManager: PromptManager;
	try {
		promptManager = new PromptManager(context);
		console.log('PromptManager が正常に初期化されました');
	} catch (error) {
		console.error('PromptManager 初期化エラー:', error);
		// 拡張機能の初期化に失敗しました
		return;
	}

	// メインパネルを開くコマンド
	const openPanelCommand = vscode.commands.registerCommand('prompt-template-manager.openPanel', async () => {
		console.log('openPanel コマンドが実行されました');
		try {
			PromptTemplatePanel.createOrShow(context.extensionUri, promptManager);
			console.log('Webviewパネルが正常に表示されました');
		} catch (error) {
			console.error('パネル表示中にエラーが発生:', error);
		}
	});

	// 新しいプロンプトを作成するコマンド
	const createPromptCommand = vscode.commands.registerCommand('prompt-template-manager.createPrompt', async () => {
		const title = await vscode.window.showInputBox({
			prompt: 'プロンプトのタイトルを入力してください',
			placeHolder: 'タイトル'
		});

		if (title) {
			const content = await vscode.window.showInputBox({
				prompt: 'プロンプトの内容を入力してください',
				placeHolder: 'プロンプトの内容...'
			});

			if (content) {
				await promptManager.addPrompt({ title, content });
			}
		}
	});

	// データエクスポートコマンド
	const exportDataCommand = vscode.commands.registerCommand('prompt-template-manager.exportData', async () => {
		try {
			const exportData = await promptManager.exportData();
			
			// ファイルに保存
			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`prompt-templates-${new Date().toISOString().slice(0, 10)}.json`),
				filters: {
					'JSON Files': ['json']
				}
			});

			if (saveUri) {
				await vscode.workspace.fs.writeFile(saveUri, Buffer.from(exportData, 'utf8'));
			}
		} catch (error) {
			// エクスポートに失敗しました
		}
	});

	// データインポートコマンド
	const importDataCommand = vscode.commands.registerCommand('prompt-template-manager.importData', async () => {
		try {
			// ファイルを選択
			const openUri = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: {
					'JSON Files': ['json']
				}
			});

			if (openUri && openUri[0]) {
				const fileContent = await vscode.workspace.fs.readFile(openUri[0]);
				const jsonData = Buffer.from(fileContent).toString('utf8');
				
				const result = await promptManager.importData(jsonData);
				
				// インポート完了
			}
		} catch (error) {
			// インポートに失敗しました
		}
	});

	// 統計表示コマンド
	const showStatsCommand = vscode.commands.registerCommand('prompt-template-manager.showStats', async () => {
		try {
			const stats = promptManager.getStats();
			const storageInfo = await promptManager.getStorageInfo();
			
			const message = [
				'📊 Prompt Template Manager 統計',
				'',
				`📝 総プロンプト数: ${stats.totalCount}`,
				`💾 ストレージ使用量: ${storageInfo.storageSize}`,
				stats.mostUsedPrompt ? `⭐ 最多使用: "${stats.mostUsedPrompt.title}" (${stats.mostUsedPrompt.usageCount}回)` : ''
			].filter(line => line !== '').join('\n');
			
			// 統計情報の表示
		} catch (error) {
			// 統計の取得に失敗しました
		}
	});

	try {
		context.subscriptions.push(
			openPanelCommand, 
			createPromptCommand, 
			exportDataCommand, 
			importDataCommand, 
			showStatsCommand
		);
		console.log('すべてのコマンドが正常に登録されました');
		console.log('登録されたコマンド:', [
			'prompt-template-manager.openPanel',
			'prompt-template-manager.createPrompt',
			'prompt-template-manager.exportData',
			'prompt-template-manager.importData',
			'prompt-template-manager.showStats'
		]);
	} catch (error) {
		console.error('コマンド登録エラー:', error);
		// コマンドの登録に失敗しました
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}

// プロンプトマネージャークラス
class PromptManager {
	private context: vscode.ExtensionContext;
	private prompts: PromptData[] = [];
	private storage: PromptStorage;
	private selectedPromptId: string | null = null;
	private currentSearchQuery: string | null = null;
	private currentSearchOptions: any = {};

	constructor(context: vscode.ExtensionContext) {
		try {
			console.log('PromptManager コンストラクタを開始');
			this.context = context;
			console.log('Context設定完了');
			this.storage = new PromptStorage(context);
			console.log('Storage初期化完了');
			this.loadPrompts();
			console.log('プロンプト読み込み開始');
		} catch (error) {
			console.error('PromptManager コンストラクタエラー:', error);
			throw error;
		}
	}

	// プロンプトデータの読み込み
	private async loadPrompts(): Promise<void> {
		try {
			this.prompts = await this.storage.loadPrompts();
			console.log(`${this.prompts.length}件のプロンプトを読み込みました`);

			// データ整合性チェック
			const integrityErrors = PromptValidator.validateStorageIntegrity(this.prompts);
			if (integrityErrors.length > 0) {
				console.warn('データ整合性の問題が検出されました:', integrityErrors);
				// プロンプトデータに整合性の問題が検出されました
			}
		} catch (error) {
			console.error('プロンプトデータの読み込みに失敗しました:', error);
			// プロンプトデータの読み込みに失敗しました。空のリストで開始します。
			this.prompts = [];
		}
	}

	// プロンプトデータの保存
	private async savePrompts(): Promise<boolean> {
		return await this.storage.savePrompts(this.prompts);
	}

	// 選択中プロンプトを設定
	setSelectedPrompt(promptId: string | null): void {
		this.selectedPromptId = promptId;
	}

	// 指定したプロンプトが選択中かどうかを判定
	isSelectedPrompt(promptId: string): boolean {
		return this.selectedPromptId === promptId;
	}

	// 選択中プロンプトIDを取得
	getSelectedPromptId(): string | null {
		return this.selectedPromptId;
	}

	// 検索状態を設定
	setSearchState(query: string | null, options: any = {}): void {
		this.currentSearchQuery = query;
		this.currentSearchOptions = options;
	}

	// 検索状態をクリア
	clearSearchState(): void {
		this.currentSearchQuery = null;
		this.currentSearchOptions = {};
	}

	// 検索中かどうかを判定
	isSearching(): boolean {
		return this.currentSearchQuery !== null;
	}

	// 現在の表示用プロンプト一覧を取得（検索状態を考慮）
	getCurrentDisplayPrompts(): PromptData[] {
		if (this.isSearching()) {
			return this.advancedSearch(this.currentSearchQuery!, this.currentSearchOptions);
		}
		return this.getPrompts();
	}

	// 使用回数順でソートされたプロンプト一覧を取得（選択中のプロンプトを最上位に）
	getPrompts(): PromptData[] {
		const filteredPrompts = this.prompts.filter(prompt => !prompt.isArchived);
		
		// 選択中のプロンプトがない場合は従来通りの使用回数降順
		if (!this.selectedPromptId) {
			return filteredPrompts.sort((a, b) => b.usageCount - a.usageCount);
		}
		
		// 選択中のプロンプトを最上位に、その他は使用回数降順でソート
		return filteredPrompts.sort((a, b) => {
			// 選択中のプロンプトを最優先
			if (a.id === this.selectedPromptId && b.id !== this.selectedPromptId) {
				return -1;
			}
			if (b.id === this.selectedPromptId && a.id !== this.selectedPromptId) {
				return 1;
			}
			
			// 両方とも選択中でない場合、または両方とも選択中の場合は使用回数で比較
			return b.usageCount - a.usageCount;
		});
	}

	// プロンプトを追加
	async addPrompt(input: PromptInput): Promise<PromptData | null> {
		const errors = PromptValidator.validatePromptInput(input, this.prompts);
		if (errors.length > 0) {
			// 入力エラー
			return null;
		}

		const newPrompt = PromptUtils.createPromptData(input);
		this.prompts.push(newPrompt);
		
		try {
			const saved = await this.savePrompts();
			if (saved) {
				console.log(`プロンプト "${newPrompt.title}" が正常に保存されました`);
				return newPrompt;
			} else {
				// 保存に失敗した場合はメモリからも削除
				this.prompts.pop();
				// プロンプトの保存に失敗しました。しばらく後に再試行してください。
				return null;
			}
		} catch (error) {
			// 保存中に例外が発生した場合
			this.prompts.pop();
			console.error('プロンプト保存中にエラーが発生:', error);
			// プロンプトの保存中にエラーが発生しました
			return null;
		}
	}

	// プロンプトを編集
	async updatePrompt(id: string, updates: Partial<{ title: string; content: string }>): Promise<boolean> {
		const prompt = this.prompts.find(p => p.id === id);
		if (!prompt) {
			console.error(`更新対象のプロンプトが見つかりません: ID=${id}`);
			return false;
		}

		// 更新前の値を保存
		const oldTitle = prompt.title;
		const oldContent = prompt.content;

		try {
			// 更新を適用
			if (updates.title !== undefined) {
				prompt.title = updates.title;
			}
			if (updates.content !== undefined) {
				prompt.content = updates.content;
			}

			// 保存
			const saved = await this.savePrompts();
			if (saved) {
				console.log(`プロンプト "${prompt.title}" が正常に更新されました`);
				return true;
			} else {
				// 保存に失敗した場合は元に戻す
				prompt.title = oldTitle;
				prompt.content = oldContent;
				console.error(`プロンプト更新の保存に失敗: ID=${id}`);
				return false;
			}
		} catch (error) {
			// 例外が発生した場合は元に戻す
			prompt.title = oldTitle;
			prompt.content = oldContent;
			console.error(`プロンプト更新中にエラーが発生: ID=${id}`, error);
			return false;
		}
	}

	// プロンプトを削除
	async deletePrompt(id: string): Promise<boolean> {
		const index = this.prompts.findIndex(p => p.id === id);
		if (index !== -1) {
			const removedPrompt = this.prompts.splice(index, 1)[0];
			
			try {
				const saved = await this.savePrompts();
				if (saved) {
					console.log(`プロンプト "${removedPrompt.title}" が正常に削除されました`);
					return true;
				} else {
					// 保存に失敗した場合は元に戻す
					this.prompts.splice(index, 0, removedPrompt);
					// プロンプトの削除保存に失敗しました。しばらく後に再試行してください。
					return false;
				}
			} catch (error) {
				// 保存中に例外が発生した場合は元に戻す
				this.prompts.splice(index, 0, removedPrompt);
				console.error('プロンプト削除保存中にエラーが発生:', error);
				// プロンプトの削除中にエラーが発生しました
				return false;
			}
		}
		return false;
	}

	// 使用回数を増加
	async incrementUsage(id: string): Promise<boolean> {
		console.log(`使用回数増加試行: ID=${id}`);
		const prompt = this.prompts.find(p => p.id === id);
		if (prompt) {
			const oldCount = prompt.usageCount;
			prompt.usageCount++;
			console.log(`使用回数更新: "${prompt.title}" ${oldCount} -> ${prompt.usageCount}`);
			
			try {
				const saved = await this.savePrompts();
				if (saved) {
					console.log(`使用回数保存成功: "${prompt.title}"`);
					return true;
				} else {
					// 保存に失敗した場合は元に戻す
					prompt.usageCount = oldCount;
					console.error(`使用回数保存失敗: "${prompt.title}"`);
					return false;
				}
			} catch (error) {
				// 保存中に例外が発生した場合は元に戻す
				prompt.usageCount = oldCount;
				console.error(`使用回数保存中にエラー: "${prompt.title}"`, error);
				return false;
			}
		} else {
			console.error(`プロンプトが見つかりません: ID=${id}`);
			console.log('存在するプロンプトID一覧:', this.prompts.map(p => p.id));
			return false;
		}
	}

	// プロンプトを検索
	searchPrompts(query: string): PromptData[] {
		return this.getPrompts().filter(prompt => 
			PromptUtils.matchesSearchQuery(prompt, query)
		);
	}

	// 高度な検索機能
	advancedSearch(query: string, options: any = {}): PromptData[] {
		// フィルタリング用の全プロンプトを取得（選択状態のソートなし）
		let results = this.prompts
			.filter(prompt => !prompt.isArchived)
			.sort((a, b) => b.usageCount - a.usageCount);

		// テキスト検索
		if (query && query.trim().length > 0) {
			results = results.filter(prompt => 
				PromptUtils.matchesSearchQuery(prompt, query)
			);
		}

		// お気に入りフィルタ
		if (options.favoritesOnly) {
			results = results.filter(prompt => prompt.isFavorite);
		}

		// 優先度フィルタ
		if (options.priority && options.priority > 0) {
			results = results.filter(prompt => prompt.priority === options.priority);
		}

		// 使用回数フィルタ
		if (options.minUsageCount !== undefined) {
			results = results.filter(prompt => prompt.usageCount >= options.minUsageCount);
		}

		// 検索結果でも選択中プロンプトを最上位に
		if (this.selectedPromptId) {
			results = results.sort((a, b) => {
				// 選択中のプロンプトを最優先
				if (a.id === this.selectedPromptId && b.id !== this.selectedPromptId) {
					return -1;
				}
				if (b.id === this.selectedPromptId && a.id !== this.selectedPromptId) {
					return 1;
				}
				
				// 両方とも選択中でない場合、または両方とも選択中の場合は使用回数で比較
				return b.usageCount - a.usageCount;
			});
		}

		console.log(`検索結果: ${results.length}件`);
		return results;
	}



	// プロンプトをアーカイブ/復元
	async toggleArchive(id: string): Promise<boolean> {
		const prompt = this.prompts.find(p => p.id === id);
		if (prompt) {
			prompt.isArchived = !prompt.isArchived;
			return await this.savePrompts();
		}
		return false;
	}

	// データをエクスポート
	async exportData(): Promise<string> {
		try {
			const exportData = await this.storage.exportData(this.prompts);
			return JSON.stringify(exportData, null, 2);
		} catch (error) {
			console.error('エクスポートに失敗:', error);
			throw new Error('データのエクスポートに失敗しました');
		}
	}

	// データをインポート
	async importData(jsonData: string): Promise<{ imported: number; errors: string[] }> {
		try {
			// JSONの解析
			let exportData: any;
			try {
				exportData = JSON.parse(jsonData);
			} catch (parseError) {
				return { imported: 0, errors: ['不正なJSON形式です'] };
			}

			// データ形式の検証
			const validationErrors = PromptValidator.validateImportData(exportData);
			if (validationErrors.length > 0) {
				const errorMessages = validationErrors.map(e => e.message);
				return { imported: 0, errors: errorMessages };
			}

			// インポート処理
			const importedPrompts = await this.storage.importData(exportData);
			
			// タイトル重複チェック
			const duplicates: string[] = [];
			const validPrompts: PromptData[] = [];
			
			importedPrompts.forEach(prompt => {
				const existingPrompt = this.prompts.find(p => 
					p.title.toLowerCase() === prompt.title.toLowerCase()
				);
				if (existingPrompt) {
					duplicates.push(prompt.title);
				} else {
					validPrompts.push(prompt);
				}
			});

			// 有効なプロンプトのみ追加
			this.prompts.push(...validPrompts);
			
			// データ整合性の検証
			const integrityErrors = PromptValidator.validateStorageIntegrity(this.prompts);
			if (integrityErrors.length > 0) {
				// 追加したプロンプトを削除してロールバック
				this.prompts.splice(-validPrompts.length);
				return { imported: 0, errors: ['データの整合性エラーが検出されました'] };
			}

			// 保存
			try {
				const saved = await this.savePrompts();
				if (saved) {
					const result = { imported: validPrompts.length, errors: [] as string[] };
					if (duplicates.length > 0) {
						result.errors.push(`重複スキップ: ${duplicates.join(', ')}`);
					}
					return result;
				} else {
					// 保存に失敗した場合は追加したプロンプトを削除
					this.prompts.splice(-validPrompts.length);
					return { imported: 0, errors: ['データの保存に失敗しました'] };
				}
			} catch (saveError) {
				// 保存に失敗した場合は追加したプロンプトを削除
				this.prompts.splice(-validPrompts.length);
				console.error('インポートデータの保存に失敗:', saveError);
				return { imported: 0, errors: [`保存エラー: ${(saveError as Error).message}`] };
			}
		} catch (error) {
			console.error('インポートに失敗:', error);
			return { imported: 0, errors: [(error as Error).message] };
		}
	}

	// ストレージ情報を取得
	async getStorageInfo() {
		return await this.storage.getStorageInfo();
	}

	// 統計情報を取得
	getStats() {
		const totalCount = this.prompts.filter(p => !p.isArchived).length;

		// 最も使用頻度の高いプロンプト
		const mostUsedPrompt = this.prompts
			.filter(p => !p.isArchived)
			.sort((a, b) => b.usageCount - a.usageCount)[0];

		return {
			totalCount,
			todayCreated: 0, // 作成日がないため0固定
			weeklyUsage: 0, // 更新日がないため0固定
			mostUsedPrompt
		};
	}
}
