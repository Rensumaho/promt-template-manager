/**
 * プロンプト内変数の自動検出・表示機能
 */

import * as vscode from 'vscode';
import { VariableEngine } from '../variableEngine';
import { VariableManager } from '../variableManager';
import { Variable, VariableParseResult } from '../variableTypes';

/**
 * 変数検出・表示クラス
 */
export class VariableDetector {
  private static instance: VariableDetector;
  private variableManager: VariableManager;
  
  // デコレーション タイプ
  private variableDecorationType!: vscode.TextEditorDecorationType;
  private missingVariableDecorationType!: vscode.TextEditorDecorationType;
  private defaultVariableDecorationType!: vscode.TextEditorDecorationType;
  private errorVariableDecorationType!: vscode.TextEditorDecorationType;

  private constructor() {
    this.variableManager = VariableManager.getInstance();
    this.createDecorationTypes();
  }

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): VariableDetector {
    if (!VariableDetector.instance) {
      VariableDetector.instance = new VariableDetector();
    }
    return VariableDetector.instance;
  }

  /**
   * デコレーションタイプを作成
   */
  private createDecorationTypes(): void {
    // 通常の変数（設定済み）
    this.variableDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('editorInfo.border'),
      borderRadius: '3px',
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        contentText: ' ✓',
        color: new vscode.ThemeColor('editorInfo.foreground'),
      },
    });

    // 未設定の変数
    this.missingVariableDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('errorBadge.background'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('errorBorder'),
      borderRadius: '3px',
      overviewRulerColor: new vscode.ThemeColor('errorForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        contentText: ' ⚠',
        color: new vscode.ThemeColor('errorForeground'),
      },
    });

    // デフォルト値を使用する変数
    this.defaultVariableDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('editorWarning.border'),
      borderRadius: '3px',
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        contentText: ' D',
        color: new vscode.ThemeColor('editorWarning.foreground'),
      },
    });

    // エラーのある変数
    this.errorVariableDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('errorBadge.background'),
      border: '2px solid',
      borderColor: new vscode.ThemeColor('errorBorder'),
      borderRadius: '3px',
      overviewRulerColor: new vscode.ThemeColor('errorForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: {
        contentText: ' ✗',
        color: new vscode.ThemeColor('errorForeground'),
      },
    });
  }

  /**
   * アクティブエディタの変数をハイライト
   */
  public highlightVariablesInActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    this.highlightVariablesInEditor(editor);
  }

  /**
   * 指定されたエディタの変数をハイライト
   */
  public highlightVariablesInEditor(editor: vscode.TextEditor): void {
    const document = editor.document;
    const text = document.getText();

    // 変数を解析
    const parseResult = VariableEngine.parseVariables(text);
    
    if (parseResult.errors.length > 0) {
      this.showVariableErrors(parseResult, editor);
    }

    // 現在のプロンプトIDを生成（ファイルパスベース）
    const promptId = this.generatePromptId(document);
    
    // 変数の設定状況を取得
    const promptManagement = this.variableManager.analyzePrompt(promptId, text);
    const currentValues = this.getCurrentVariableValues(promptId);

    // デコレーションを適用
    this.applyVariableDecorations(editor, parseResult, currentValues);

    // ホバー情報を更新
    this.updateHoverProvider(parseResult.variables, currentValues);
  }

  /**
   * 変数エラーを表示
   */
  private showVariableErrors(parseResult: VariableParseResult, editor: vscode.TextEditor): void {
    const errorDecorations: vscode.DecorationOptions[] = [];

    parseResult.errors.forEach(error => {
      if (error.position) {
        const startPos = editor.document.positionAt(error.position.start);
        const endPos = editor.document.positionAt(error.position.end);
        const range = new vscode.Range(startPos, endPos);

        errorDecorations.push({
          range,
          hoverMessage: new vscode.MarkdownString(`**変数エラー**: ${error.message}`),
        });
      }
    });

    editor.setDecorations(this.errorVariableDecorationType, errorDecorations);
  }

  /**
   * 変数デコレーションを適用
   */
  private applyVariableDecorations(
    editor: vscode.TextEditor,
    parseResult: VariableParseResult,
    currentValues: Record<string, string>
  ): void {
    const text = editor.document.getText();
    const completeDecorations: vscode.DecorationOptions[] = [];
    const missingDecorations: vscode.DecorationOptions[] = [];
    const defaultDecorations: vscode.DecorationOptions[] = [];

    // 変数の位置を検索してデコレーションを作成
    parseResult.variables.forEach(variable => {
      const variablePattern = new RegExp(`\\{${this.escapeRegExp(variable.name)}(?::[^}]*)?\\}`, 'g');
      let match;

      while ((match = variablePattern.exec(text)) !== null) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + match[0].length);
        const range = new vscode.Range(startPos, endPos);

        const currentValue = currentValues[variable.name];
        const hasCustomValue = currentValue && currentValue !== variable.defaultValue;
        const hasDefaultValue = currentValue === variable.defaultValue;
        const hasNoValue = !currentValue || currentValue.trim() === '';

        let hoverMessage = this.createHoverMessage(variable, currentValue);

        if (hasCustomValue) {
          completeDecorations.push({ range, hoverMessage });
        } else if (hasDefaultValue) {
          defaultDecorations.push({ range, hoverMessage });
        } else if (hasNoValue) {
          missingDecorations.push({ range, hoverMessage });
        }
      }
    });

    // デコレーションを設定
    editor.setDecorations(this.variableDecorationType, completeDecorations);
    editor.setDecorations(this.missingVariableDecorationType, missingDecorations);
    editor.setDecorations(this.defaultVariableDecorationType, defaultDecorations);
  }

  /**
   * ホバーメッセージを作成
   */
  private createHoverMessage(variable: Variable, currentValue?: string): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    
    markdown.appendMarkdown(`**変数**: \`${variable.name}\`\n\n`);
    
    if (variable.defaultValue) {
      markdown.appendMarkdown(`**デフォルト値**: \`${variable.defaultValue}\`\n\n`);
    }

    if (currentValue) {
      markdown.appendMarkdown(`**現在の値**: \`${currentValue}\`\n\n`);
    } else {
      markdown.appendMarkdown(`**状態**: 未設定\n\n`);
    }

    // 変数の説明を取得
    const variableMetadata = this.variableManager.getVariable(variable.name);
    if (variableMetadata?.description) {
      markdown.appendMarkdown(`**説明**: ${variableMetadata.description}\n\n`);
    }

    // 使用履歴
    const history = this.variableManager.getVariableHistory(variable.name);
    if (history.length > 0) {
      markdown.appendMarkdown(`**最近の使用**: ${history.length}回\n\n`);
      
      const recentValues = history.slice(0, 3).map(h => `\`${h.value}\``).join(', ');
      markdown.appendMarkdown(`**最近の値**: ${recentValues}\n\n`);
    }

    // アクションボタン
    const promptId = this.getCurrentPromptId();
    if (promptId) {
      markdown.appendMarkdown(`[変数を設定](command:promptTemplateManager.openVariableSettings?${encodeURIComponent(JSON.stringify({ promptId, variableName: variable.name }))})`);
    }

    markdown.isTrusted = true;
    return markdown;
  }

  /**
   * 正規表現エスケープ
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * プロンプトIDを生成
   */
  private generatePromptId(document: vscode.TextDocument): string {
    return `file:${document.uri.fsPath}`;
  }

  /**
   * 現在の変数値を取得
   */
  private getCurrentVariableValues(promptId: string): Record<string, string> {
    try {
      // パブリックメソッドを使用してプロンプト管理データを取得
      const promptManagement = this.variableManager.getPromptManagement(promptId);
      
      if (promptManagement?.currentValueSet) {
        return promptManagement.currentValueSet.values;
      }

      // デフォルト値を返す
      const defaultValues: Record<string, string> = {};
      if (promptManagement) {
        promptManagement.variables.forEach((variable) => {
          if (variable.defaultValue) {
            defaultValues[variable.name] = variable.defaultValue;
          }
        });
      }

      return defaultValues;
    } catch (error) {
      // エラー時は空のオブジェクトを返す
      return {};
    }
  }

  /**
   * 現在のプロンプトIDを取得
   */
  private getCurrentPromptId(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    return this.generatePromptId(editor.document);
  }

  /**
   * ホバープロバイダーを更新
   */
  private updateHoverProvider(variables: Variable[], currentValues: Record<string, string>): void {
    // VS Code拡張のホバープロバイダーとして登録する場合の実装
    // 現在は個別のデコレーションのhoverMessageで対応
  }

  /**
   * 変数統計を表示
   */
  public showVariableStatistics(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('アクティブなエディタがありません');
      return;
    }

    const text = editor.document.getText();
    const parseResult = VariableEngine.parseVariables(text);
    const promptId = this.generatePromptId(editor.document);
    const currentValues = this.getCurrentVariableValues(promptId);

    const total = parseResult.variables.length;
    const completed = parseResult.variables.filter((v: Variable) => 
      currentValues[v.name] && currentValues[v.name].trim() !== ''
    ).length;
    const missing = total - completed;
    const usingDefault = parseResult.variables.filter((v: Variable) => 
      currentValues[v.name] === v.defaultValue
    ).length;

    const message = `変数統計: ${total}個の変数（完了: ${completed}、未設定: ${missing}、デフォルト使用: ${usingDefault}）`;
    vscode.window.showInformationMessage(message);
  }

  /**
   * 次の未設定変数に移動
   */
  public goToNextMissingVariable(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const text = editor.document.getText();
    const parseResult = VariableEngine.parseVariables(text);
    const promptId = this.generatePromptId(editor.document);
    const currentValues = this.getCurrentVariableValues(promptId);

    // 未設定の変数を検索
    const currentPosition = editor.selection.active;
    const currentOffset = editor.document.offsetAt(currentPosition);

    interface VariableLocation {
      variable: Variable;
      position: number;
    }

    let nextMissingVariable: VariableLocation | null = null;
    let closestAfterCursor: VariableLocation | null = null;
    let firstMissing: VariableLocation | null = null;

    parseResult.variables.forEach((variable: Variable) => {
      const currentValue = currentValues[variable.name];
      if (!currentValue || currentValue.trim() === '') {
        const variablePattern = new RegExp(`\\{${this.escapeRegExp(variable.name)}(?::[^}]*)?\\}`, 'g');
        let match;
        
        while ((match = variablePattern.exec(text)) !== null) {
          const variableInfo: VariableLocation = { variable, position: match.index };
          
          if (!firstMissing) {
            firstMissing = variableInfo;
          }
          
          if (match.index > currentOffset && !closestAfterCursor) {
            closestAfterCursor = variableInfo;
          }
        }
      }
    });

    nextMissingVariable = closestAfterCursor || firstMissing;

    if (nextMissingVariable) {
      const varInfo = nextMissingVariable as VariableLocation;
      const position = editor.document.positionAt(varInfo.position);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      
      // 変数設定パネルを開く
      vscode.commands.executeCommand('promptTemplateManager.openVariableSettings', {
        promptId,
        variableName: varInfo.variable.name
      });
    } else {
      vscode.window.showInformationMessage('未設定の変数はありません');
    }
  }

  /**
   * 変数のハイライトを更新
   */
  public updateHighlights(): void {
    this.highlightVariablesInActiveEditor();
  }

  /**
   * すべてのデコレーションをクリア
   */
  public clearAllDecorations(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    editor.setDecorations(this.variableDecorationType, []);
    editor.setDecorations(this.missingVariableDecorationType, []);
    editor.setDecorations(this.defaultVariableDecorationType, []);
    editor.setDecorations(this.errorVariableDecorationType, []);
  }

  /**
   * リソースをクリーンアップ
   */
  public dispose(): void {
    this.variableDecorationType.dispose();
    this.missingVariableDecorationType.dispose();
    this.defaultVariableDecorationType.dispose();
    this.errorVariableDecorationType.dispose();
  }
} 