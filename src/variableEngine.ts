/**
 * 変数解析エンジン - メインAPI
 */

import { VariableParser } from './variableParser';
import { VariableReplacer } from './variableReplacer';
import {
    PromptVariables,
    VariableError,
    VariableParseResult,
    VariableReplacementOptions,
    VariableReplacementResult,
    VariableValueMap,
    VariableWarning
} from './variableTypes';

/**
 * 変数解析エンジン - すべての変数機能を統合したメインクラス
 */
export class VariableEngine {
  /**
   * プロンプト内の変数を解析する
   * @param prompt プロンプトテキスト
   * @returns 解析結果
   */
  public static parseVariables(prompt: string): VariableParseResult {
    return VariableParser.parseVariables(prompt);
  }

  /**
   * プロンプト内の変数を値で置換する
   * @param prompt プロンプトテキスト
   * @param variableValues 変数値マップ
   * @param options 置換オプション
   * @returns 置換結果
   */
  public static replaceVariables(
    prompt: string,
    variableValues: VariableValueMap,
    options?: VariableReplacementOptions
  ): VariableReplacementResult {
    return VariableReplacer.replaceVariables(prompt, variableValues, options);
  }

  /**
   * プロンプト内の一意な変数名を抽出する
   * @param prompt プロンプトテキスト
   * @returns 一意な変数名配列
   */
  public static extractVariableNames(prompt: string): string[] {
    return VariableParser.extractUniqueVariableNames(prompt);
  }

  /**
   * 変数のプレビューHTMLを生成する
   * @param prompt プロンプトテキスト
   * @param variableValues 変数値マップ
   * @returns プレビューHTML
   */
  public static generatePreview(
    prompt: string,
    variableValues?: VariableValueMap
  ): string {
    return VariableReplacer.generatePreviewHtml(prompt, variableValues);
  }

  /**
   * 変数の統計情報を取得する
   * @param prompt プロンプトテキスト
   * @param variableValues 変数値マップ
   * @returns 統計情報
   */
  public static getStats(prompt: string, variableValues?: VariableValueMap) {
    return VariableReplacer.getVariableStats(prompt, variableValues);
  }

  /**
   * エスケープシーケンスを検証する
   * @param prompt プロンプトテキスト
   * @returns エスケープエラー配列
   */
  public static validateEscapes(prompt: string): VariableError[] {
    return VariableParser.validateEscapeSequences(prompt);
  }

  /**
   * テキストからエスケープを解除する
   * @param text テキスト
   * @returns エスケープ解除後のテキスト
   */
  public static unescapeText(text: string): string {
    return VariableParser.unescapeText(text);
  }

  /**
   * プロンプトの変数を詳細解析する（解析 + 置換 + 統計を一括実行）
   * @param prompt プロンプトテキスト
   * @param variableValues 変数値マップ
   * @param options 置換オプション
   * @returns 詳細解析結果
   */
  public static analyzePrompt(
    prompt: string,
    variableValues: VariableValueMap = new Map(),
    options?: VariableReplacementOptions
  ): {
    parseResult: VariableParseResult;
    replacementResult: VariableReplacementResult;
    stats: ReturnType<typeof VariableReplacer.getVariableStats>;
    escapeErrors: VariableError[];
    isValid: boolean;
    summary: string;
  } {
    // 各種解析を実行
    const parseResult = this.parseVariables(prompt);
    const replacementResult = this.replaceVariables(prompt, variableValues, options);
    const stats = this.getStats(prompt, variableValues);
    const escapeErrors = this.validateEscapes(prompt);

    // 全体的な妥当性判定
    const isValid = 
      parseResult.errors.length === 0 && 
      replacementResult.errors.length === 0 && 
      escapeErrors.length === 0;

    // サマリー生成
    const summary = this.generateSummary(parseResult, replacementResult, stats, escapeErrors);

    return {
      parseResult,
      replacementResult,
      stats,
      escapeErrors,
      isValid,
      summary,
    };
  }

  /**
   * プロンプト変数セットを作成する
   * @param promptId プロンプトID
   * @param prompt プロンプトテキスト
   * @returns プロンプト変数セット
   */
  public static createPromptVariables(promptId: string, prompt: string): PromptVariables {
    const parseResult = this.parseVariables(prompt);
    
    return {
      promptId,
      variables: parseResult.variables,
      lastUpdated: new Date(),
    };
  }

  /**
   * 変数値マップを作成する（ヘルパー関数）
   * @param values 変数値のオブジェクト
   * @returns 変数値マップ
   */
  public static createVariableMap(values: Record<string, string>): VariableValueMap {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(values)) {
      map.set(key, value);
    }
    return map;
  }

  /**
   * 変数値マップをオブジェクトに変換する（ヘルパー関数）
   * @param map 変数値マップ
   * @returns 変数値オブジェクト
   */
  public static mapToObject(map: VariableValueMap): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of map.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  /**
   * 解析結果のサマリーを生成する
   * @param parseResult 解析結果
   * @param replacementResult 置換結果
   * @param stats 統計情報
   * @param escapeErrors エスケープエラー
   * @returns サマリー文字列
   */
  private static generateSummary(
    parseResult: VariableParseResult,
    replacementResult: VariableReplacementResult,
    stats: ReturnType<typeof VariableReplacer.getVariableStats>,
    escapeErrors: VariableError[]
  ): string {
    const parts: string[] = [];

    // 基本統計
    parts.push(`変数: ${stats.uniqueVariables}個`);
    
    if (stats.definedVariables > 0) {
      parts.push(`設定済み: ${stats.definedVariables}個`);
    }
    
    if (stats.undefinedVariables > 0) {
      parts.push(`未設定: ${stats.undefinedVariables}個`);
    }
    
    if (stats.variablesWithDefaults > 0) {
      parts.push(`デフォルト値あり: ${stats.variablesWithDefaults}個`);
    }

    // エラー・警告の要約
    const totalErrors = parseResult.errors.length + replacementResult.errors.length + escapeErrors.length;
    const totalWarnings = parseResult.warnings.length + replacementResult.warnings.length;

    if (totalErrors > 0) {
      parts.push(`エラー: ${totalErrors}件`);
    }
    
    if (totalWarnings > 0) {
      parts.push(`警告: ${totalWarnings}件`);
    }

    if (totalErrors === 0 && totalWarnings === 0) {
      parts.push('正常');
    }

    return parts.join(', ');
  }

  /**
   * バリデーション用の包括的チェック
   * @param prompt プロンプトテキスト
   * @returns バリデーション結果
   */
  public static validatePrompt(prompt: string): {
    isValid: boolean;
    errors: VariableError[];
    warnings: VariableWarning[];
    suggestions: string[];
  } {
    const parseResult = this.parseVariables(prompt);
    const escapeErrors = this.validateEscapes(prompt);
    
    const errors = [...parseResult.errors, ...escapeErrors];
    const warnings = [...parseResult.warnings];
    const suggestions: string[] = [];

    // 修正提案を生成
    if (errors.length > 0) {
      suggestions.push('エラーを修正してください');
    }
    
    if (warnings.length > 0) {
      suggestions.push('警告を確認してください');
    }
    
    if (parseResult.variables.length === 0) {
      suggestions.push('変数を追加することで、このプロンプトをテンプレート化できます');
    }
    
    const stats = this.getStats(prompt);
    if (stats.undefinedVariables > 0) {
      suggestions.push(`${stats.undefinedVariables}個の変数にデフォルト値を設定することを推奨します`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }
} 