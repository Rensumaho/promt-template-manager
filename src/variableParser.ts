/**
 * 変数パーサー実装
 */

import {
    ERROR_MESSAGES,
    Variable,
    VariableError,
    VariableErrorType,
    VariableParseResult,
    VariableWarning,
    VariableWarningType,
    WARNING_MESSAGES,
} from './variableTypes';

/**
 * 変数パーサー
 */
export class VariableParser {
  // 基本変数パターン: {変数名} または {変数名:デフォルト値}
  // 負の後読み(?<!\\)でエスケープされていないもののみ検出
  private static readonly VARIABLE_PATTERN = /(?<!\\)\{([^{}]*?)\}/g;

  // デフォルト値分離用の正規表現
  private static readonly DEFAULT_VALUE_SEPARATOR = ':';

  // 変数名の最大長
  private static readonly MAX_VARIABLE_NAME_LENGTH = 100;

  /**
   * プロンプト内の変数を解析する
   * @param prompt 解析対象のプロンプトテキスト
   * @returns 変数解析結果
   */
  public static parseVariables(prompt: string): VariableParseResult {
    const variables: Variable[] = [];
    const errors: VariableError[] = [];
    const warnings: VariableWarning[] = [];

    // 正規表現でマッチした結果を格納
    let match: RegExpExecArray | null;
    const pattern = new RegExp(this.VARIABLE_PATTERN.source, 'g');

    while ((match = pattern.exec(prompt)) !== null) {
      const fullMatch = match[0]; // {variable} または {variable:default}
      const innerContent = match[1]; // variable または variable:default
      const startIndex = match.index;
      const endIndex = match.index + fullMatch.length - 1;

      try {
        // 変数名とデフォルト値を分離
        const parseResult = this.parseVariableContent(innerContent);
        
        if (parseResult.error) {
          errors.push({
            type: parseResult.error.type,
            message: parseResult.error.message,
            position: { start: startIndex, end: endIndex },
            variableName: parseResult.variableName,
            rawText: fullMatch,
          });
          continue;
        }

        // 変数オブジェクトを作成
        const variable: Variable = {
          name: parseResult.variableName!,
          defaultValue: parseResult.defaultValue,
          startIndex,
          endIndex,
          rawText: fullMatch,
        };

        variables.push(variable);

        // 警告のチェック
        const varWarnings = this.checkVariableWarnings(variable);
        warnings.push(...varWarnings);

      } catch (error) {
        errors.push({
          type: VariableErrorType.MALFORMED_VARIABLE,
          message: ERROR_MESSAGES[VariableErrorType.MALFORMED_VARIABLE].replace('{text}', fullMatch),
          position: { start: startIndex, end: endIndex },
          rawText: fullMatch,
        });
      }
    }

    // 重複変数の検出（同じ名前で異なるデフォルト値）
    this.checkDuplicateVariables(variables, warnings);

    return {
      variables,
      errors,
      warnings,
    };
  }

  /**
   * 変数内容を解析（変数名とデフォルト値の分離）
   * @param content 変数の内容部分
   * @returns 解析結果
   */
  private static parseVariableContent(content: string): {
    variableName?: string;
    defaultValue?: string;
    error?: { type: VariableErrorType; message: string };
  } {
    // 空の変数名チェック
    if (!content || content.trim() === '') {
      return {
        error: {
          type: VariableErrorType.EMPTY_VARIABLE_NAME,
          message: ERROR_MESSAGES[VariableErrorType.EMPTY_VARIABLE_NAME].replace('{text}', `{${content}}`),
        },
      };
    }

    // デフォルト値がある場合とない場合で分離
    const separatorIndex = content.indexOf(this.DEFAULT_VALUE_SEPARATOR);
    
    if (separatorIndex === -1) {
      // デフォルト値なし
      const variableName = content.trim();
      return this.validateVariableName(variableName) 
        ? { variableName }
        : {
            error: {
              type: VariableErrorType.MALFORMED_VARIABLE,
              message: ERROR_MESSAGES[VariableErrorType.MALFORMED_VARIABLE].replace('{text}', variableName),
            },
          };
    }

    // デフォルト値あり
    const variableName = content.substring(0, separatorIndex).trim();
    const defaultValue = content.substring(separatorIndex + 1); // trimしない（空白も有効な値）

    if (!variableName) {
      return {
        error: {
          type: VariableErrorType.EMPTY_VARIABLE_NAME,
          message: ERROR_MESSAGES[VariableErrorType.EMPTY_VARIABLE_NAME].replace('{text}', `{${content}}`),
        },
      };
    }

    if (!this.validateVariableName(variableName)) {
      return {
        error: {
          type: VariableErrorType.MALFORMED_VARIABLE,
          message: ERROR_MESSAGES[VariableErrorType.MALFORMED_VARIABLE].replace('{text}', variableName),
        },
      };
    }

    return {
      variableName,
      defaultValue: this.unescapeDefaultValue(defaultValue),
    };
  }

  /**
   * 変数名の妥当性をチェック
   * @param variableName 変数名
   * @returns 有効かどうか
   */
  private static validateVariableName(variableName: string): boolean {
    // 日本語を含む文字を許可（Unicode対応）
    // 英数字、アンダースコア、日本語（ひらがな、カタカナ、漢字）を許可
    const validNamePattern = /^[\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u3400-\u4DBF]+$/;
    
    // 長さチェック
    if (variableName.length === 0 || variableName.length > this.MAX_VARIABLE_NAME_LENGTH) {
      return false;
    }

    // ネストした変数記法の検出（現在非対応）
    if (variableName.includes('{') || variableName.includes('}')) {
      return false;
    }

    // 日本語対応の変数名チェック
    if (!validNamePattern.test(variableName)) {
      return false;
    }

    return true;
  }

  /**
   * デフォルト値のエスケープを解除
   * @param defaultValue エスケープされたデフォルト値
   * @returns エスケープ解除後のデフォルト値
   */
  private static unescapeDefaultValue(defaultValue: string): string {
    return defaultValue
      .replace(/\\:/g, ':')   // \: → :
      .replace(/\\{/g, '{')   // \{ → {
      .replace(/\\}/g, '}')   // \} → }
      .replace(/\\\\/g, '\\'); // \\ → \
  }

  /**
   * 変数の警告をチェック
   * @param variable 変数
   * @returns 警告配列
   */
  private static checkVariableWarnings(variable: Variable): VariableWarning[] {
    const warnings: VariableWarning[] = [];

    // 長い変数名の警告
    if (variable.name.length > 50) {
      warnings.push({
        type: VariableWarningType.LONG_VARIABLE_NAME,
        message: WARNING_MESSAGES[VariableWarningType.LONG_VARIABLE_NAME].replace('{name}', variable.name),
        variableName: variable.name,
      });
    }

    // 特殊文字の警告（情報提供として）
    if (/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF_-]/.test(variable.name)) {
      warnings.push({
        type: VariableWarningType.SPECIAL_CHARACTERS_IN_NAME,
        message: WARNING_MESSAGES[VariableWarningType.SPECIAL_CHARACTERS_IN_NAME].replace('{name}', variable.name),
        variableName: variable.name,
      });
    }

    return warnings;
  }

  /**
   * 重複変数をチェック（同じ名前で異なるデフォルト値）
   * @param variables 変数配列
   * @param warnings 警告配列（追加される）
   */
  private static checkDuplicateVariables(variables: Variable[], warnings: VariableWarning[]): void {
    const variableMap = new Map<string, Variable>();

    for (const variable of variables) {
      const existing = variableMap.get(variable.name);
      if (existing) {
        // 同じ名前の変数が既に存在する
        if (existing.defaultValue !== variable.defaultValue) {
          // デフォルト値が異なる場合は警告
          warnings.push({
            type: VariableWarningType.UNDEFINED_VARIABLE, // 適切な警告タイプがないため代用
            message: `変数 '${variable.name}' に異なるデフォルト値が設定されています: '${existing.defaultValue}' と '${variable.defaultValue}'`,
            variableName: variable.name,
          });
        }
      } else {
        variableMap.set(variable.name, variable);
      }
    }
  }

  /**
   * プロンプト内のエスケープされた文字を検出
   * @param prompt プロンプトテキスト
   * @returns エスケープエラー配列
   */
  public static validateEscapeSequences(prompt: string): VariableError[] {
    const errors: VariableError[] = [];
    const escapePattern = /\\./g;
    let match: RegExpExecArray | null;

    while ((match = escapePattern.exec(prompt)) !== null) {
      const escapedChar = match[0][1]; // \ の次の文字
      const validEscapes = ['{', '}', ':', '\\'];
      
      if (!validEscapes.includes(escapedChar)) {
        errors.push({
          type: VariableErrorType.INVALID_ESCAPE,
          message: ERROR_MESSAGES[VariableErrorType.INVALID_ESCAPE].replace('{text}', match[0]),
          position: { start: match.index, end: match.index + match[0].length - 1 },
          rawText: match[0],
        });
      }
    }

    return errors;
  }

  /**
   * テキストからエスケープを解除
   * @param text エスケープされたテキスト
   * @returns エスケープ解除後のテキスト
   */
  public static unescapeText(text: string): string {
    return text
      .replace(/\\{/g, '{')
      .replace(/\\}/g, '}')
      .replace(/\\:/g, ':')
      .replace(/\\\\/g, '\\');
  }

  /**
   * プロンプト内の全ての変数を抽出（重複除去済み）
   * @param prompt プロンプトテキスト
   * @returns 一意な変数名配列
   */
  public static extractUniqueVariableNames(prompt: string): string[] {
    const parseResult = this.parseVariables(prompt);
    const uniqueNames = new Set<string>();
    
    parseResult.variables.forEach(variable => {
      uniqueNames.add(variable.name);
    });
    
    return Array.from(uniqueNames);
  }
} 