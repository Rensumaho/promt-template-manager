/**
 * 変数設定パネルのWebView実装
 */

import * as vscode from 'vscode';
import { VariableManager } from '../variableManager';
import { VariableStorage } from '../variableStorage';

export class VariableSettingsPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'variableSettings';

    private _view?: vscode.WebviewView;
    private variableManager: VariableManager;
    private variableStorage: VariableStorage;
    private currentPromptId: string | null = null;
    private pendingAnalysis: { promptId: string; promptText: string } | null = null;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.variableManager = VariableManager.getInstance();
        this.variableStorage = VariableStorage.getInstance();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            await this._handleMessage(data);
        });

        // 保留中の解析があれば実行
        if (this.pendingAnalysis) {
            console.log('保留中の変数解析を実行します:', this.pendingAnalysis);
            const { promptId, promptText } = this.pendingAnalysis;
            this.pendingAnalysis = null;
            this.analyzeCurrentPrompt(promptId, promptText).catch(error => {
                console.error('保留中の解析でエラー:', error);
            });
        }
    }

    public async analyzeCurrentPrompt(promptId: string, promptText: string) {
        console.log('=== 変数解析開始 ===');
        console.log('PromptID:', promptId);
        console.log('PromptText:', promptText);
        
        this.currentPromptId = promptId;

        // WebViewが準備できていない場合は保留
        if (!this._view) {
            console.log('WebViewが準備できていないため、解析を保留します');
            this.pendingAnalysis = { promptId, promptText };
            return;
        }
        
        try {
            console.log('変数マネージャーによる解析を開始...');
            
            // プロンプトを解析
            const promptManagement = await this.variableManager.analyzePrompt(promptId, promptText);
            console.log('変数マネージャー解析結果:', promptManagement);
            
            // WebViewにデータを送信
            console.log('WebViewにデータを送信...');
            const message = {
                type: 'promptAnalyzed',
                promptId,
                promptText,
                variables: promptManagement.variables,
                currentValueSet: promptManagement.currentValueSet
            };
            console.log('送信メッセージ:', message);
            
            await this._view.webview.postMessage(message);
            console.log('WebViewへの送信完了');
            
            console.log('=== 変数解析完了 ===');
        } catch (error) {
            console.error('=== 変数解析エラー ===');
            console.error('プロンプト解析エラー:', error);
            console.error('エラー詳細:', error instanceof Error ? error.stack : error);
            vscode.window.showErrorMessage(`プロンプト解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _handleMessage(data: any) {
        switch (data.type) {
            case 'ready':
                // WebView初期化完了
                console.log('変数設定パネルからreadyメッセージを受信');
                if (this.pendingAnalysis) {
                    console.log('保留中の解析を実行:', this.pendingAnalysis);
                    const { promptId, promptText } = this.pendingAnalysis;
                    this.pendingAnalysis = null;
                    await this.analyzeCurrentPrompt(promptId, promptText);
                } else if (this.currentPromptId) {
                    const promptManagement = this.variableManager.getPromptManagement(this.currentPromptId);
                    if (promptManagement) {
                        await this.analyzeCurrentPrompt(this.currentPromptId, promptManagement.promptText);
                    }
                }
                break;

            case 'updateVariableValue':
                await this._handleVariableValueUpdate(data.variableName, data.value);
                break;

            case 'previewPrompt':
                await this._handlePromptPreview(data.values);
                break;

            case 'generatePrompt':
                await this._handlePromptGeneration(data.values, data.options);
                break;

            case 'saveValueSet':
                await this._handleSaveValueSet(data.name, data.description, data.values);
                break;

            case 'loadValueSet':
                await this._handleLoadValueSet(data.valueSetId);
                break;

            case 'updateVariableMetadata':
                await this._handleUpdateVariableMetadata(data.variableName, data.updates);
                break;
        }
    }

    private async _handleVariableValueUpdate(variableName: string, value: string) {
        // 変数値の更新と履歴への追加
        if (this.currentPromptId) {
            this.variableStorage.addHistoryEntry({
                variableName,
                value,
                promptId: this.currentPromptId,
                context: `変数設定パネルから更新`,
            });
        }

        // リアルタイムプレビューの更新をトリガー
        if (this._view) {
            await this._view.webview.postMessage({
                type: 'variableValueUpdated',
                variableName,
                value
            });
        }
    }

    private async _handlePromptPreview(values: Record<string, string>) {
        if (!this.currentPromptId) {
            return;
        }

        try {
            const preview = this.variableManager.generatePromptPreview(this.currentPromptId, values);
            
            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'previewGenerated',
                    preview
                });
            }
        } catch (error) {
            console.error('プレビュー生成エラー:', error);
            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'previewError',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    private async _handlePromptGeneration(values: Record<string, string>, options: any) {
        console.log('=== _handlePromptGeneration開始 ===');
        console.log('受信した変数値:', values);
        console.log('受信したオプション:', options);
        console.log('現在のプロンプトID:', this.currentPromptId);
        
        if (!this.currentPromptId) {
            console.error('プロンプトIDが設定されていません');
            return;
        }

        try {
            console.log('変数マネージャーでプロンプト生成開始...');
            const result = this.variableManager.setPromptVariableValues(
                this.currentPromptId, 
                values, 
                options.saveAsSet, 
                options.setName
            );
            console.log('変数マネージャーによる生成結果:', result);

            // 生成されたプロンプトをクリップボードにコピー
            console.log('クリップボードにコピー開始...');
            await vscode.env.clipboard.writeText(result);
            console.log('クリップボードへのコピー完了');
            
            // 成功メッセージを表示
            vscode.window.showInformationMessage('プロンプトがクリップボードにコピーされました');

            if (this._view) {
                console.log('WebViewに完了通知を送信...');
                await this._view.webview.postMessage({
                    type: 'promptGenerated',
                    result
                });
                console.log('WebViewへの通知完了');
            }
            
            console.log('=== _handlePromptGeneration完了 ===');
        } catch (error) {
            console.error('=== _handlePromptGeneration エラー ===');
            console.error('プロンプト生成エラー:', error);
            console.error('エラー詳細:', error instanceof Error ? error.stack : error);
            vscode.window.showErrorMessage(`プロンプト生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _handleSaveValueSet(name: string, description: string, values: Record<string, string>) {
        try {
            const valueSet = await this.variableStorage.saveValueSet({
                name,
                description,
                values,
                usageCount: 0,
                tags: ['手動作成']
            });

            vscode.window.showInformationMessage(`変数値セット "${name}" を保存しました`);

            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'valueSetSaved',
                    valueSet
                });
            }
        } catch (error) {
            console.error('変数値セット保存エラー:', error);
            vscode.window.showErrorMessage(`変数値セットの保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _handleLoadValueSet(valueSetId: string) {
        try {
            const valueSet = this.variableStorage.getAllValueSets().find(vs => vs.id === valueSetId);
            
            if (valueSet) {
                if (this._view) {
                    await this._view.webview.postMessage({
                        type: 'valueSetLoaded',
                        valueSet
                    });
                }
            } else {
                vscode.window.showErrorMessage('指定された変数値セットが見つかりません');
            }
        } catch (error) {
            console.error('変数値セット読み込みエラー:', error);
            vscode.window.showErrorMessage(`変数値セットの読み込みに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async _handleUpdateVariableMetadata(variableName: string, updates: any) {
        try {
            const updatedVariable = await this.variableManager.updateVariable(variableName, updates);
            
            if (updatedVariable) {
                vscode.window.showInformationMessage(`変数 "${variableName}" のメタデータを更新しました`);
                
                if (this._view) {
                    await this._view.webview.postMessage({
                        type: 'variableMetadataUpdated',
                        variable: updatedVariable
                    });
                }
            }
        } catch (error) {
            console.error('変数メタデータ更新エラー:', error);
            vscode.window.showErrorMessage(`変数メタデータの更新に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'ui', 'variableSettingsScript.js'));

        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>変数設定</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 16px;
        }
        .container {
            max-width: 100%;
        }
        .variable-item {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 16px;
            background-color: var(--vscode-input-background);
        }
        .variable-name {
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-textLink-foreground);
        }
        .variable-input {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
        }
        .btn {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 3px;
            cursor: pointer;
            margin-right: 8px;
            margin-top: 8px;
        }
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .preview-area {
            margin-top: 16px;
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background-color: var(--vscode-textCodeBlock-background);
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        }
        .no-prompt {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            padding: 32px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="no-prompt-message" class="no-prompt">
            プロンプトを選択して変数を設定してください
        </div>
        <div id="variables-container" style="display: none;">
            <h3>変数設定</h3>
            <div id="variables-list"></div>
            <div class="actions">
                <button id="preview-btn" class="btn">プレビュー</button>
                <button id="generate-btn" class="btn">生成・コピー</button>
            </div>
            <div id="preview-area" class="preview-area" style="display: none;"></div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
} 