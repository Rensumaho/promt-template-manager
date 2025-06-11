/**
 * 変数機能に関する型定義
 */

/**
 * 変数オブジェクト
 */
export interface Variable {
  /** 変数名 */
  name: string;
  /** デフォルト値（オプション） */
  defaultValue?: string;
  /** 現在設定されている値 */
  currentValue?: string;
  /** プロンプト内の開始位置 */
  startIndex: number;
  /** プロンプト内の終了位置 */
  endIndex: number;
  /** 元の記法文字列 (例: "{animal:猫}") */
  rawText: string;
}

/**
 * プロンプト変数セット
 */
export interface PromptVariables {
  /** プロンプトID */
  promptId: string;
  /** 変数配列 */
  variables: Variable[];
  /** 最終更新日時 */
  lastUpdated: Date;
}

/**
 * 変数置換設定
 */
export interface VariableReplacementOptions {
  /** 未定義変数を空文字にするか */
  emptyIfUndefined?: boolean;
  /** エラー時に例外を投げるか */
  throwOnError?: boolean;
  /** 循環参照の最大チェック回数 */
  maxCircularCheck?: number;
}

/**
 * 変数解析結果
 */
export interface VariableParseResult {
  /** 解析された変数配列 */
  variables: Variable[];
  /** 解析時のエラー */
  errors: VariableError[];
  /** 解析時の警告 */
  warnings: VariableWarning[];
}

/**
 * 変数エラー
 */
export interface VariableError {
  /** エラータイプ */
  type: VariableErrorType;
  /** エラーメッセージ */
  message: string;
  /** エラー位置 */
  position?: {
    start: number;
    end: number;
  };
  /** 関連する変数名 */
  variableName?: string;
  /** 元のテキスト */
  rawText?: string;
}

/**
 * 変数警告
 */
export interface VariableWarning {
  /** 警告タイプ */
  type: VariableWarningType;
  /** 警告メッセージ */
  message: string;
  /** 警告位置 */
  position?: {
    start: number;
    end: number;
  };
  /** 関連する変数名 */
  variableName?: string;
}

/**
 * 変数エラータイプ
 */
export enum VariableErrorType {
  /** 不正な変数記法 */
  MALFORMED_VARIABLE = 'MALFORMED_VARIABLE',
  /** 循環参照 */
  CIRCULAR_REFERENCE = 'CIRCULAR_REFERENCE',
  /** ネストした変数（現在非対応） */
  NESTED_VARIABLES = 'NESTED_VARIABLES',
  /** 不正なエスケープ */
  INVALID_ESCAPE = 'INVALID_ESCAPE',
  /** 変数名が空 */
  EMPTY_VARIABLE_NAME = 'EMPTY_VARIABLE_NAME',
}

/**
 * 変数警告タイプ
 */
export enum VariableWarningType {
  /** 未定義変数 */
  UNDEFINED_VARIABLE = 'UNDEFINED_VARIABLE',
  /** 長い変数名 */
  LONG_VARIABLE_NAME = 'LONG_VARIABLE_NAME',
  /** 特殊文字を含む変数名 */
  SPECIAL_CHARACTERS_IN_NAME = 'SPECIAL_CHARACTERS_IN_NAME',
}

/**
 * 変数置換結果
 */
export interface VariableReplacementResult {
  /** 置換後のテキスト */
  replacedText: string;
  /** 使用された変数 */
  usedVariables: string[];
  /** 置換時のエラー */
  errors: VariableError[];
  /** 置換時の警告 */
  warnings: VariableWarning[];
}

/**
 * 変数値マップ
 */
export type VariableValueMap = Map<string, string>;

/**
 * エラーメッセージ定数
 */
export const ERROR_MESSAGES = {
  [VariableErrorType.MALFORMED_VARIABLE]: '変数記法が正しくありません: {text}',
  [VariableErrorType.CIRCULAR_REFERENCE]: '変数の循環参照が検出されました: {variables}',
  [VariableErrorType.NESTED_VARIABLES]: 'ネストした変数は現在サポートされていません: {text}',
  [VariableErrorType.INVALID_ESCAPE]: '不正なエスケープシーケンスです: {text}',
  [VariableErrorType.EMPTY_VARIABLE_NAME]: '変数名が空です: {text}',
} as const;

/**
 * 警告メッセージ定数
 */
export const WARNING_MESSAGES = {
  [VariableWarningType.UNDEFINED_VARIABLE]: '未定義変数です: {name}',
  [VariableWarningType.LONG_VARIABLE_NAME]: '変数名が長すぎます: {name}',
  [VariableWarningType.SPECIAL_CHARACTERS_IN_NAME]: '変数名に特殊文字が含まれています: {name}',
} as const; 