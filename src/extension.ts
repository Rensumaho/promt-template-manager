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
		const prompts = this.promptManager.getPrompts();
		await this._panel.webview.postMessage({
			type: 'updatePrompts',
			prompts: prompts
		});
	}

	private async _handleWebviewMessage(message: any) {
		switch (message.type) {
			case 'ready':
				// Webview初期化完了時にデータを送信
				await this._sendPromptsToWebview();
				break;

			case 'searchPrompts':
				const searchResults = this.promptManager.searchPrompts(message.query);
				await this._panel.webview.postMessage({
					type: 'updatePrompts',
					prompts: searchResults
				});
				break;

			case 'selectPrompt':
				const promptId = message.id;
				console.log(`プロンプト選択: ID=${promptId}`);
				
				// 選択されたプロンプトデータを取得
				const selectedPrompt = this.promptManager.getPrompts().find(p => p.id === promptId);
				if (selectedPrompt) {
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

			case 'editPrompt':
				await this._showEditPromptDialog(message.id);
				break;

			case 'deletePrompt':
				await this._deletePrompt(message.id);
				break;

			case 'toggleFavorite':
				await this.promptManager.toggleFavorite(message.id);
				await this._sendPromptsToWebview();
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

			default:
				console.warn('Unknown message type:', message.type);
		}
	}

	private async _showCreatePromptDialog() {
		const title = await vscode.window.showInputBox({
			prompt: 'プロンプトのタイトルを入力してください',
			placeHolder: 'タイトル'
		});

		if (!title) return;

		const content = await vscode.window.showInputBox({
			prompt: 'プロンプトの内容を入力してください',
			placeHolder: 'プロンプトの内容...'
		});

		if (!content) return;

		const description = await vscode.window.showInputBox({
			prompt: 'プロンプトの説明を入力してください（任意）',
			placeHolder: '説明...'
		});

		const tagsInput = await vscode.window.showInputBox({
			prompt: 'タグを入力してください（カンマ区切り、任意）',
			placeHolder: 'ai, chatgpt, development'
		});

		const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];

		const result = await this.promptManager.addPrompt({
			title,
			content,
			description,
			tags
		});

		if (result) {
			vscode.window.showInformationMessage(`プロンプト "${title}" が保存されました！`);
			await this._sendPromptsToWebview();
		}
	}

	private async _showEditPromptDialog(id: string) {
		const prompt = this.promptManager.getPrompts().find(p => p.id === id);
		if (!prompt) return;

		const title = await vscode.window.showInputBox({
			prompt: 'プロンプトのタイトルを編集してください',
			value: prompt.title
		});

		if (!title) return;

		const content = await vscode.window.showInputBox({
			prompt: 'プロンプトの内容を編集してください',
			value: prompt.content
		});

		if (!content) return;

		const description = await vscode.window.showInputBox({
			prompt: 'プロンプトの説明を編集してください（任意）',
			value: prompt.description || ''
		});

		const tagsInput = await vscode.window.showInputBox({
			prompt: 'タグを編集してください（カンマ区切り、任意）',
			value: prompt.tags.join(', ')
		});

		const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0) : [];

		const success = await this.promptManager.editPrompt(id, {
			title,
			content,
			description,
			tags
		});

		if (success) {
			vscode.window.showInformationMessage(`プロンプト "${title}" が更新されました！`);
			await this._sendPromptsToWebview();
		}
	}

	private async _deletePrompt(id: string) {
		const prompt = this.promptManager.getPrompts().find(p => p.id === id);
		if (!prompt) return;

		const result = await vscode.window.showWarningMessage(
			`プロンプト "${prompt.title}" を削除しますか？`,
			{ modal: true },
			'削除'
		);

		if (result === '削除') {
			const success = await this.promptManager.deletePrompt(id);
			if (success) {
				vscode.window.showInformationMessage(`プロンプト "${prompt.title}" が削除されました。`);
				await this._sendPromptsToWebview();
			}
		}
	}

	private async _copyPromptToClipboard(content: string) {
		await vscode.env.clipboard.writeText(content);
		vscode.window.showInformationMessage('プロンプトをクリップボードにコピーしました');
	}

	private async _executePrompt(content: string) {
		// ここで実際のAIチャット入力欄への挿入処理を実装
		await vscode.env.clipboard.writeText(content);
		vscode.window.showInformationMessage('プロンプトをクリップボードにコピーしました（実行機能は今後実装予定）');
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
		}
		
		.panel {
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}
		
		.search-panel {
			flex: 0 0 280px;
			padding: 16px;
			overflow-y: auto;
		}
		
		.detail-panel {
			flex: 1;
			padding: 16px;
			overflow-y: auto;
		}
		
		.variable-panel {
			flex: 0 0 280px;
			padding: 16px;
			overflow-y: auto;
		}
		
		.search-header {
			margin-bottom: 16px;
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
			max-height: calc(100vh - 120px);
			overflow-y: auto;
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
			justify-content: space-between;
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
		
		.variable-highlight {
			background: var(--vscode-editor-selectionHighlightBackground);
			color: var(--vscode-editor-foreground);
			padding: 2px 4px;
			border-radius: 3px;
			border: 1px solid var(--vscode-focusBorder);
			font-weight: bold;
		}
		
		.detail-meta {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 12px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}
		
		.meta-item {
			display: flex;
			justify-content: space-between;
		}
		
		.variable-header {
			margin-bottom: 16px;
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
	</style>
</head>
<body>
	<div class="container">
		<!-- 左側: 検索・一覧パネル -->
		<div class="panel search-panel scrollbar">
			<div class="search-header">
				<button class="add-button" onclick="createPrompt()">
					➕ 新しいプロンプトを追加
				</button>
				<input 
					type="text" 
					class="search-box" 
					id="searchBox"
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
		<div class="panel detail-panel scrollbar">
			<div id="promptDetail">
				<div class="empty-state">
					<div class="empty-icon">👈</div>
					<div>左側からプロンプトを選択してください</div>
				</div>
			</div>
		</div>
		
		<!-- 右側: 変数設定パネル -->
		<div class="panel variable-panel scrollbar">
			<div class="variable-header">
				<h3 class="variable-title">変数設定</h3>
			</div>
			<div id="variablePanel">
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
					updatePromptList(message.prompts);
					break;
				case 'showPromptDetail':
					showPromptDetail(message.prompt);
					break;
			}
		});
		
		// 初期化完了を通知
		document.addEventListener('DOMContentLoaded', () => {
			vscode.postMessage({ type: 'ready' });
		});
		
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
		function updatePromptList(prompts) {
			currentPrompts = prompts;
			const listElement = document.getElementById('promptList');
			
			if (prompts.length === 0) {
				listElement.innerHTML = \`
					<div class="empty-state">
						<div class="empty-icon">📭</div>
						<div>プロンプトがありません</div>
						<div style="margin-top: 8px; font-size: 11px;">「新しいプロンプトを追加」から始めましょう</div>
					</div>
				\`;
				return;
			}
			
			listElement.innerHTML = prompts.map(prompt => \`
				<div class="prompt-item" onclick="selectPrompt('\${prompt.id}')" data-id="\${prompt.id}">
					<div class="prompt-title">
						\${prompt.isFavorite ? '<span class="favorite-icon">⭐</span> ' : ''}\${escapeHtml(prompt.title)}
					</div>
					<div class="prompt-summary">\${escapeHtml(prompt.content.substring(0, 60))}\${prompt.content.length > 60 ? '...' : ''}</div>
					<div class="prompt-meta">
						<span>使用回数: <span class="usage-count">\${prompt.usageCount}</span></span>
						<span>\${formatDate(prompt.updatedAt)}</span>
					</div>
					\${prompt.tags.length > 0 ? \`
						<div class="tags">
							\${prompt.tags.map(tag => \`<span class="tag">\${escapeHtml(tag)}</span>\`).join('')}
						</div>
					\` : ''}
				</div>
			\`).join('');
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
					<h2 class="detail-title">\${prompt.isFavorite ? '⭐ ' : ''}\${escapeHtml(prompt.title)}</h2>
					<div class="detail-actions">
						<button class="action-button" onclick="toggleFavorite('\${prompt.id}')">
							\${prompt.isFavorite ? '💔 お気に入り解除' : '❤️ お気に入り'}
						</button>
						<button class="action-button" onclick="editPrompt('\${prompt.id}')">✏️ 編集</button>
						<button class="action-button" onclick="deletePrompt('\${prompt.id}')">🗑️ 削除</button>
						<button class="action-button" onclick="copyPrompt('\${prompt.id}')">📋 コピー</button>
					</div>
				</div>
				
				<div class="detail-content">\${highlightedContent}</div>
				
				<div class="detail-meta">
					<div class="meta-item">
						<span>使用回数:</span>
						<span>\${prompt.usageCount}回</span>
					</div>
					<div class="meta-item">
						<span>優先度:</span>
						<span>\${prompt.priority}/5</span>
					</div>
					<div class="meta-item">
						<span>作成日:</span>
						<span>\${formatDate(prompt.createdAt)}</span>
					</div>
					<div class="meta-item">
						<span>更新日:</span>
						<span>\${formatDate(prompt.updatedAt)}</span>
					</div>
					\${prompt.description ? \`
						<div class="meta-item" style="grid-column: span 2;">
							<span>説明:</span>
							<span>\${escapeHtml(prompt.description)}</span>
						</div>
					\` : ''}
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
		
		// 新しいプロンプトを作成
		function createPrompt() {
			vscode.postMessage({ type: 'createPrompt' });
		}
		
		// プロンプトを編集
		function editPrompt(id) {
			vscode.postMessage({ type: 'editPrompt', id });
		}
		
		// プロンプトを削除
		function deletePrompt(id) {
			vscode.postMessage({ type: 'deletePrompt', id });
		}
		
		// お気に入りを切り替え
		function toggleFavorite(id) {
			vscode.postMessage({ type: 'toggleFavorite', id });
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
		vscode.window.showInformationMessage('Prompt Template Manager が正常にアクティベートされました！');
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
		vscode.window.showErrorMessage(`拡張機能の初期化に失敗しました: ${(error as Error).message}`);
		return;
	}

	// メインパネルを開くコマンド
	const openPanelCommand = vscode.commands.registerCommand('prompt-template-manager.openPanel', async () => {
		console.log('openPanel コマンドが実行されました');
		vscode.window.showInformationMessage('Prompt Template Manager パネルを表示します...');
		try {
			PromptTemplatePanel.createOrShow(context.extensionUri, promptManager);
			console.log('Webviewパネルが正常に表示されました');
		} catch (error) {
			console.error('パネル表示中にエラーが発生:', error);
			vscode.window.showErrorMessage(`パネル表示エラー: ${(error as Error).message}`);
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
				vscode.window.showInformationMessage(`プロンプト "${title}" が保存されました！`);
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
				vscode.window.showInformationMessage(`プロンプトデータを ${saveUri.fsPath} にエクスポートしました`);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`エクスポートに失敗しました: ${(error as Error).message}`);
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
				
				if (result.errors.length > 0) {
					vscode.window.showWarningMessage(`インポート完了: ${result.imported}件 (エラー: ${result.errors.join(', ')})`);
				} else {
					vscode.window.showInformationMessage(`${result.imported}件のプロンプトをインポートしました`);
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`インポートに失敗しました: ${(error as Error).message}`);
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
				`🆕 今日作成: ${stats.todayCreated}`,
				`📈 今週更新: ${stats.weeklyUsage}`,
				`💾 ストレージ使用量: ${storageInfo.storageSize}`,
				`🏷️ 人気タグ: ${stats.popularTags.map(t => `${t.tag}(${t.count})`).join(', ') || 'なし'}`,
				stats.mostUsedPrompt ? `⭐ 最多使用: "${stats.mostUsedPrompt.title}" (${stats.mostUsedPrompt.usageCount}回)` : ''
			].filter(line => line !== '').join('\n');
			
			vscode.window.showInformationMessage(message, { modal: true });
		} catch (error) {
			vscode.window.showErrorMessage(`統計の取得に失敗しました: ${(error as Error).message}`);
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
		vscode.window.showErrorMessage(`コマンドの登録に失敗しました: ${(error as Error).message}`);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}

// プロンプトマネージャークラス
class PromptManager {
	private context: vscode.ExtensionContext;
	private prompts: PromptData[] = [];
	private storage: PromptStorage;

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
				vscode.window.showWarningMessage(
					`プロンプトデータに${integrityErrors.length}件の整合性の問題が検出されました。データの確認をお勧めします。`
				);
			}
		} catch (error) {
			console.error('プロンプトデータの読み込みに失敗しました:', error);
			vscode.window.showErrorMessage('プロンプトデータの読み込みに失敗しました。空のリストで開始します。');
			this.prompts = [];
		}
	}

	// プロンプトデータの保存
	private async savePrompts(): Promise<boolean> {
		return await this.storage.savePrompts(this.prompts);
	}

	// 使用回数順でソートされたプロンプト一覧を取得
	getPrompts(): PromptData[] {
		return this.prompts
			.filter(prompt => !prompt.isArchived)
			.sort((a, b) => b.usageCount - a.usageCount);
	}

	// プロンプトを追加
	async addPrompt(input: PromptInput): Promise<PromptData | null> {
		const errors = PromptValidator.validatePromptInput(input, this.prompts);
		if (errors.length > 0) {
			const errorMessages = errors.map(e => e.message).join('\n');
			vscode.window.showErrorMessage(`入力エラー:\n${errorMessages}`);
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
				vscode.window.showErrorMessage('プロンプトの保存に失敗しました。しばらく後に再試行してください。');
				return null;
			}
		} catch (error) {
			// 保存中に例外が発生した場合
			this.prompts.pop();
			console.error('プロンプト保存中にエラーが発生:', error);
			vscode.window.showErrorMessage(`プロンプトの保存中にエラーが発生しました: ${(error as Error).message}`);
			return null;
		}
	}

	// プロンプトを編集
	async editPrompt(id: string, input: PromptInput): Promise<boolean> {
		const errors = PromptValidator.validatePromptInput(input, this.prompts, id);
		if (errors.length > 0) {
			const errorMessages = errors.map(e => e.message).join('\n');
			vscode.window.showErrorMessage(`入力エラー:\n${errorMessages}`);
			return false;
		}

		const index = this.prompts.findIndex(p => p.id === id);
		if (index !== -1) {
			const originalPrompt = { ...this.prompts[index] };
			this.prompts[index] = PromptUtils.updatePromptData(this.prompts[index], input);
			
			try {
				const saved = await this.savePrompts();
				if (saved) {
					console.log(`プロンプト "${input.title}" が正常に更新されました`);
					return true;
				} else {
					// 保存に失敗した場合は元に戻す
					this.prompts[index] = originalPrompt;
					vscode.window.showErrorMessage('プロンプトの更新保存に失敗しました。しばらく後に再試行してください。');
					return false;
				}
			} catch (error) {
				// 保存中に例外が発生した場合は元に戻す
				this.prompts[index] = originalPrompt;
				console.error('プロンプト更新保存中にエラーが発生:', error);
				vscode.window.showErrorMessage(`プロンプトの更新中にエラーが発生しました: ${(error as Error).message}`);
				return false;
			}
		}
		return false;
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
					vscode.window.showErrorMessage('プロンプトの削除保存に失敗しました。しばらく後に再試行してください。');
					return false;
				}
			} catch (error) {
				// 保存中に例外が発生した場合は元に戻す
				this.prompts.splice(index, 0, removedPrompt);
				console.error('プロンプト削除保存中にエラーが発生:', error);
				vscode.window.showErrorMessage(`プロンプトの削除中にエラーが発生しました: ${(error as Error).message}`);
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

	// お気に入りを切り替え
	async toggleFavorite(id: string): Promise<boolean> {
		const prompt = this.prompts.find(p => p.id === id);
		if (prompt) {
			prompt.isFavorite = !prompt.isFavorite;
			return await this.savePrompts();
		}
		return false;
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
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

		const totalCount = this.prompts.filter(p => !p.isArchived).length;
		const todayCreated = this.prompts.filter(p => 
			!p.isArchived && p.createdAt >= today
		).length;
		const weeklyUsage = this.prompts.filter(p => 
			!p.isArchived && p.updatedAt >= weekAgo
		).length;

		// タグ使用頻度
		const tagCounts = new Map<string, number>();
		this.prompts.forEach(prompt => {
			if (!prompt.isArchived) {
				prompt.tags.forEach(tag => {
					tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
				});
			}
		});

		const popularTags = Array.from(tagCounts.entries())
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		// 最も使用頻度の高いプロンプト
		const mostUsedPrompt = this.prompts
			.filter(p => !p.isArchived)
			.sort((a, b) => b.usageCount - a.usageCount)[0];

		return {
			totalCount,
			todayCreated,
			weeklyUsage,
			popularTags,
			mostUsedPrompt
		};
	}
}
