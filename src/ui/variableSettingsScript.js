/**
 * 変数設定パネルのクライアントサイドスクリプト
 */

(function () {
    const vscode = acquireVsCodeApi();

    let currentVariables = [];
    let currentValues = {};

    // DOM要素
    const noPromptMessage = document.getElementById('no-prompt-message');
    const variablesContainer = document.getElementById('variables-container');
    const variablesList = document.getElementById('variables-list');
    const previewBtn = document.getElementById('preview-btn');
    const generateBtn = document.getElementById('generate-btn');
    const previewArea = document.getElementById('preview-area');

    // 初期化
    function init() {
        previewBtn?.addEventListener('click', handlePreview);
        generateBtn?.addEventListener('click', handleGenerate);

        // VS Codeに準備完了を通知
        vscode.postMessage({ type: 'ready' });
    }

    // メッセージハンドラ
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('変数設定パネル: メッセージ受信', message);

        switch (message.type) {
            case 'promptAnalyzed':
                console.log('promptAnalyzedメッセージを処理開始');
                handlePromptAnalyzed(message);
                break;
            case 'previewGenerated':
                console.log('previewGeneratedメッセージを処理開始');
                handlePreviewGenerated(message);
                break;
            case 'promptGenerated':
                console.log('promptGeneratedメッセージを処理開始');
                handlePromptGenerated(message);
                break;
            case 'variableValueUpdated':
                console.log('variableValueUpdatedメッセージを処理開始');
                // リアルタイム更新の処理
                break;
            default:
                console.warn('未知のメッセージタイプ:', message.type);
        }
    });

    function handlePromptAnalyzed(message) {
        console.log('=== handlePromptAnalyzed開始 ===');
        console.log('受信したメッセージ:', message);

        currentVariables = message.variables || [];
        console.log('設定された変数一覧:', currentVariables);

        if (currentVariables.length === 0) {
            console.log('変数が見つからないため、空の状態を表示');
            showNoVariables();
        } else {
            console.log(`${currentVariables.length}個の変数が見つかりました`);
            showVariables();
            renderVariables();
        }

        console.log('=== handlePromptAnalyzed完了 ===');
    }

    function showNoVariables() {
        if (noPromptMessage) noPromptMessage.style.display = 'block';
        if (variablesContainer) variablesContainer.style.display = 'none';
    }

    function showVariables() {
        if (noPromptMessage) noPromptMessage.style.display = 'none';
        if (variablesContainer) variablesContainer.style.display = 'block';
    }

    function renderVariables() {
        console.log('=== renderVariables開始 ===');
        if (!variablesList) {
            console.error('variablesListエレメントが見つかりません');
            return;
        }

        console.log('変数リストをクリア');
        variablesList.innerHTML = '';

        console.log(`${currentVariables.length}個の変数を描画開始`);
        currentVariables.forEach((variable, index) => {
            console.log(`変数${index + 1}を描画:`, variable);
            const variableElement = createVariableElement(variable);
            variablesList.appendChild(variableElement);
        });

        console.log('=== renderVariables完了 ===');
    }

    function createVariableElement(variable) {
        console.log('=== createVariableElement開始 ===');
        console.log('作成対象の変数:', variable);

        const div = document.createElement('div');
        div.className = 'variable-item';

        const currentValue = currentValues[variable.name] || variable.defaultValue || '';
        const placeholder = variable.defaultValue || '値を入力してください';

        console.log(`変数 ${variable.name} の現在値: "${currentValue}"`);
        console.log(`変数 ${variable.name} のプレースホルダー: "${placeholder}"`);

        div.innerHTML = `
            <div class="variable-name">{${variable.name}}</div>
            <input 
                type="text" 
                class="variable-input" 
                data-variable="${variable.name}"
                placeholder="${placeholder}"
                value="${currentValue}"
            />
            ${variable.description ? `<div class="variable-description">${variable.description}</div>` : ''}
        `;

        const input = div.querySelector('.variable-input');
        if (input) {
            console.log(`変数 ${variable.name} の入力フィールドにイベントリスナーを追加`);
            input.addEventListener('input', (e) => {
                const variableName = e.target.getAttribute('data-variable');
                const newValue = e.target.value;
                console.log(`変数 ${variableName} の値が変更されました: "${newValue}"`);
                currentValues[variableName] = newValue;

                // デバウンス処理でリアルタイムプレビュー
                clearTimeout(window.previewTimeout);
                window.previewTimeout = setTimeout(() => {
                    console.log('プレビューを更新します');
                    handlePreview();
                }, 500);
            });
        } else {
            console.error(`変数 ${variable.name} の入力フィールドが見つかりません`);
        }

        console.log('=== createVariableElement完了 ===');
        return div;
    }

    function handlePreview() {
        // 現在の変数値を収集
        const values = {};
        currentVariables.forEach(variable => {
            const input = document.querySelector(`[data-variable="${variable.name}"]`);
            values[variable.name] = input?.value || variable.defaultValue || '';
        });

        vscode.postMessage({
            type: 'previewPrompt',
            values: values
        });
    }

    function handleGenerate() {
        console.log('=== handleGenerate開始（コピー処理） ===');

        // 現在の変数値を収集
        const values = {};
        console.log(`${currentVariables.length}個の変数の値を収集開始`);

        currentVariables.forEach((variable, index) => {
            const input = document.querySelector(`[data-variable="${variable.name}"]`);
            const inputValue = input?.value || '';
            const finalValue = inputValue || variable.defaultValue || '';

            console.log(`変数${index + 1} "${variable.name}":`);
            console.log(`  - 入力フィールドの値: "${inputValue}"`);
            console.log(`  - デフォルト値: "${variable.defaultValue || 'なし'}"`);
            console.log(`  - 最終的な値: "${finalValue}"`);

            values[variable.name] = finalValue;
        });

        console.log('収集された全変数値:', values);

        const message = {
            type: 'generatePrompt',
            values: values,
            options: {
                saveAsSet: false,
                setName: null
            }
        };

        console.log('VS Codeに送信するメッセージ:', message);
        vscode.postMessage(message);

        console.log('=== handleGenerate完了 ===');
    }

    function handlePreviewGenerated(message) {
        if (previewArea) {
            previewArea.textContent = message.preview;
            previewArea.style.display = 'block';
        }
    }

    function handlePromptGenerated(message) {
        console.log('プロンプト生成完了:', message.result);
    }

    // ページ読み込み完了時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(); 