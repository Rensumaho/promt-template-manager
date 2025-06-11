/**
 * 変数置換エンジン実装
 */

import { VariableParser } from './variableParser';
import {
    ERROR_MESSAGES,
    Variable,
    VariableError,
    VariableErrorType,
    VariableReplacementOptions,
    VariableReplacementResult,
    VariableValueMap,
    VariableWarning,
    VariableWarningType,
    WARNING_MESSAGES,
} from './variableTypes';

/**
 * 変数置換エンジン
 */
export class VariableReplacer {
  private static readonly DEFAULT_OPTIONS: Required<VariableReplacementOptions> = {
    emptyIfUndefined: true,
    throwOnError: false,
    maxCircularCheck: 10,
  };

  /**
   * プロンプト内の変数を値で置換する
   * @param prompt 置換対象のプロンプトテキスト
   * @param variableValues 変数値マップ
   * @param options 置換オプション
   * @returns 置換結果
   */
  public static replaceVariables(
    prompt: string,
    variableValues: VariableValueMap,
    options: VariableReplacementOptions = {}
  ): VariableReplacementResult {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const errors: VariableError[] = [];
    const warnings: VariableWarning[] = [];
    const usedVariables: string[] = [];

    try {
      // 変数を解析
      const parseResult = VariableParser.parseVariables(prompt);
      
      // 解析エラーがある場合
      if (parseResult.errors.length > 0) {
        errors.push(...parseResult.errors);
        if (opts.throwOnError) {
          throw new Error(`変数解析エラー: ${parseResult.errors[0].message}`);
        }
      }

      // 解析警告を追加
      warnings.push(...parseResult.warnings);

      // 循環参照チェック
      const circularErrors = this.checkCircularReferences(parseResult.variables, variableValues, opts.maxCircularCheck);
      if (circularErrors.length > 0) {
        errors.push(...circularErrors);
        if (opts.throwOnError) {
          throw new Error(`循環参照エラー: ${circularErrors[0].message}`);
        }
      }

      // 変数を後方から前方へ置換（インデックスのずれを防ぐため）
      let replacedText = prompt;
      const sortedVariables = parseResult.variables.sort((a, b) => b.startIndex - a.startIndex);

      for (const variable of sortedVariables) {
        const value = this.resolveVariableValue(variable, variableValues, opts);
        
        // 置換実行
        const before = replacedText.substring(0, variable.startIndex);
        const after = replacedText.substring(variable.endIndex + 1);
        replacedText = before + value + after;

        // 使用された変数を記録
        if (!usedVariables.includes(variable.name)) {
          usedVariables.push(variable.name);
        }

        // 未定義変数の警告
        if (!variableValues.has(variable.name) && !variable.defaultValue) {
          warnings.push({
            type: VariableWarningType.UNDEFINED_VARIABLE,
            message: WARNING_MESSAGES[VariableWarningType.UNDEFINED_VARIABLE].replace('{name}', variable.name),
            variableName: variable.name,
          });
        }
      }

      // エスケープを解除
      replacedText = VariableParser.unescapeText(replacedText);

      return {
        replacedText,
        usedVariables,
        errors,
        warnings,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({
        type: VariableErrorType.MALFORMED_VARIABLE,
        message: `置換処理エラー: ${errorMessage}`,
      });

      return {
        replacedText: prompt,
        usedVariables: [],
        errors,
        warnings,
      };
    }
  }

  /**
   * 変数値を解決する（ユーザー設定値 → デフォルト値 → 空文字の順）
   * @param variable 変数
   * @param variableValues 変数値マップ
   * @param options 置換オプション
   * @returns 解決された値
   */
  private static resolveVariableValue(
    variable: Variable,
    variableValues: VariableValueMap,
    options: Required<VariableReplacementOptions>
  ): string {
    // 1. ユーザー設定値を優先
    if (variableValues.has(variable.name)) {
      const userValue = variableValues.get(variable.name)!;
      return userValue;
    }

    // 2. デフォルト値を使用
    if (variable.defaultValue !== undefined) {
      return variable.defaultValue;
    }

    // 3. 空文字または元の変数記法を返す
    return options.emptyIfUndefined ? '' : variable.rawText;
  }

  /**
   * 循環参照をチェックする
   * @param variables 変数配列
   * @param variableValues 変数値マップ
   * @param maxDepth 最大チェック深度
   * @returns 循環参照エラー配列
   */
  private static checkCircularReferences(
    variables: Variable[],
    variableValues: VariableValueMap,
    maxDepth: number
  ): VariableError[] {
    const errors: VariableError[] = [];
    const variableNames = new Set(variables.map(v => v.name));

    for (const variable of variables) {
      const visited = new Set<string>();
      const path: string[] = [];

      if (this.hasCircularReference(variable.name, variableValues, variableNames, visited, path, maxDepth)) {
        errors.push({
          type: VariableErrorType.CIRCULAR_REFERENCE,
          message: ERROR_MESSAGES[VariableErrorType.CIRCULAR_REFERENCE].replace(
            '{variables}',
            path.join(' → ')
          ),
          variableName: variable.name,
        });
      }
    }

    return errors;
  }

  /**
   * 再帰的に循環参照をチェック
   * @param currentVar 現在の変数名
   * @param variableValues 変数値マップ
   * @param allVariables 全変数名セット
   * @param visited 訪問済み変数セット
   * @param path 訪問パス
   * @param depth 現在の深度
   * @returns 循環参照が存在するか
   */
  private static hasCircularReference(
    currentVar: string,
    variableValues: VariableValueMap,
    allVariables: Set<string>,
    visited: Set<string>,
    path: string[],
    depth: number
  ): boolean {
    if (depth <= 0) {
      return false; // 深度制限に達した
    }

    if (visited.has(currentVar)) {
      return true; // 循環参照を検出
    }

    visited.add(currentVar);
    path.push(currentVar);

    // 変数値に他の変数が含まれているかチェック
    const value = variableValues.get(currentVar);
    if (value) {
      const referencedVars = this.extractVariableReferences(value, allVariables);
      for (const refVar of referencedVars) {
        if (this.hasCircularReference(refVar, variableValues, allVariables, new Set(visited), [...path], depth - 1)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * テキストから変数参照を抽出
   * @param text テキスト
   * @param allVariables 全変数名セット
   * @returns 参照されている変数名配列
   */
  private static extractVariableReferences(text: string, allVariables: Set<string>): string[] {
    const references: string[] = [];
    const parseResult = VariableParser.parseVariables(text);

    for (const variable of parseResult.variables) {
      if (allVariables.has(variable.name)) {
        references.push(variable.name);
      }
    }

    return references;
  }

  /**
   * プレビュー用に変数をハイライトした HTML を生成
   * @param prompt プロンプトテキスト
   * @param variableValues 変数値マップ
   * @returns ハイライト付き HTML
   */
  public static generatePreviewHtml(
    prompt: string,
    variableValues: VariableValueMap = new Map()
  ): string {
    const parseResult = VariableParser.parseVariables(prompt);
    let html = '';
    let lastIndex = 0;

    // 変数を順番に処理してハイライト
    for (const variable of parseResult.variables) {
      // 変数前のテキストを追加
      html += this.escapeHtml(prompt.substring(lastIndex, variable.startIndex));

      // 変数値を取得
      const value = variableValues.get(variable.name) || variable.defaultValue || '';
      const hasValue = variableValues.has(variable.name) || variable.defaultValue !== undefined;

      // 変数をハイライト表示
      const cssClass = hasValue ? 'variable-defined' : 'variable-undefined';
      html += `<span class="${cssClass}" title="変数: ${variable.name}, 値: ${value}">${this.escapeHtml(value || variable.rawText)}</span>`;

      lastIndex = variable.endIndex + 1;
    }

    // 残りのテキストを追加
    html += this.escapeHtml(prompt.substring(lastIndex));

    // エスケープを解除
    return VariableParser.unescapeText(html);
  }

  /**
   * HTML エスケープ
   * @param text テキスト
   * @returns エスケープされたテキスト
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 変数の統計情報を取得
   * @param prompt プロンプトテキスト
   * @param variableValues 変数値マップ
   * @returns 統計情報
   */
  public static getVariableStats(
    prompt: string,
    variableValues: VariableValueMap = new Map()
  ): {
    totalVariables: number;
    uniqueVariables: number;
    definedVariables: number;
    undefinedVariables: number;
    variablesWithDefaults: number;
  } {
    const parseResult = VariableParser.parseVariables(prompt);
    const uniqueNames = new Set(parseResult.variables.map(v => v.name));
    
    let definedCount = 0;
    let defaultCount = 0;

    for (const varName of uniqueNames) {
      if (variableValues.has(varName)) {
        definedCount++;
      }
      
      const variable = parseResult.variables.find(v => v.name === varName);
      if (variable?.defaultValue !== undefined) {
        defaultCount++;
      }
    }

    return {
      totalVariables: parseResult.variables.length,
      uniqueVariables: uniqueNames.size,
      definedVariables: definedCount,
      undefinedVariables: uniqueNames.size - definedCount,
      variablesWithDefaults: defaultCount,
    };
  }
} 