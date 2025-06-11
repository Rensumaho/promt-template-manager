/**
 * 変数管理システム用の型定義
 */

import { Variable } from './variableTypes';

/**
 * 変数メタデータ（拡張された変数情報）
 */
export interface VariableMetadata extends Variable {
  /** 変数の説明 */
  description?: string;
  /** 変数の型（将来拡張用） */
  type?: VariableType;
  /** 作成日時 */
  createdAt: Date;
  /** 最終更新日時 */
  updatedAt: Date;
  /** 使用回数 */
  usageCount: number;
  /** 最後に使用された日時 */
  lastUsedAt?: Date;
  /** タグ（カテゴリ分け用） */
  tags?: string[];
  /** お気に入りフラグ */
  isFavorite?: boolean;
}

/**
 * 変数タイプ（将来拡張用）
 */
export enum VariableType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  DATE = 'date',
  EMAIL = 'email',
  URL = 'url',
  FILE_PATH = 'file_path',
  CUSTOM = 'custom',
}

/**
 * 変数値履歴エントリ
 */
export interface VariableValueHistory {
  /** 履歴ID */
  id: string;
  /** 変数名 */
  variableName: string;
  /** 設定された値 */
  value: string;
  /** 設定日時 */
  setAt: Date;
  /** 使用されたプロンプトID */
  promptId?: string;
  /** コンテキスト情報 */
  context?: string;
}

/**
 * 変数設定セット
 */
export interface VariableValueSet {
  /** セットID */
  id: string;
  /** セット名 */
  name: string;
  /** 説明 */
  description?: string;
  /** 変数値マップ */
  values: Record<string, string>;
  /** 作成日時 */
  createdAt: Date;
  /** 最終更新日時 */
  updatedAt: Date;
  /** 使用回数 */
  usageCount: number;
  /** タグ */
  tags?: string[];
  /** お気に入りフラグ */
  isFavorite?: boolean;
}

/**
 * 変数テンプレート
 */
export interface VariableTemplate {
  /** テンプレートID */
  id: string;
  /** テンプレート名 */
  name: string;
  /** 説明 */
  description?: string;
  /** 対象となる変数定義 */
  variables: VariableMetadata[];
  /** デフォルト値セット */
  defaultValueSet?: VariableValueSet;
  /** カテゴリ */
  category?: string;
  /** 作成日時 */
  createdAt: Date;
  /** 最終更新日時 */
  updatedAt: Date;
  /** 使用回数 */
  usageCount: number;
  /** 公開フラグ */
  isPublic?: boolean;
  /** 作成者 */
  author?: string;
}

/**
 * プロンプト別変数管理
 */
export interface PromptVariableManagement {
  /** プロンプトID */
  promptId: string;
  /** プロンプトテキスト */
  promptText: string;
  /** 変数メタデータ配列 */
  variables: VariableMetadata[];
  /** 現在の変数値セット */
  currentValueSet?: VariableValueSet;
  /** 変数値履歴 */
  valueHistory: VariableValueHistory[];
  /** 作成日時 */
  createdAt: Date;
  /** 最終更新日時 */
  updatedAt: Date;
  /** 最後にアクセスされた日時 */
  lastAccessedAt: Date;
}

/**
 * 変数統計情報
 */
export interface VariableStatistics {
  /** 総変数数 */
  totalVariables: number;
  /** アクティブ変数数（最近使用された） */
  activeVariables: number;
  /** 最もよく使われる変数TOP10 */
  mostUsedVariables: Array<{
    name: string;
    usageCount: number;
  }>;
  /** 最近追加された変数 */
  recentlyAddedVariables: VariableMetadata[];
  /** お気に入り変数数 */
  favoriteVariablesCount: number;
  /** 変数値セット数 */
  valueSetCount: number;
  /** テンプレート数 */
  templateCount: number;
}

/**
 * 変数管理設定
 */
export interface VariableManagerSettings {
  /** 履歴保持期間（日数） */
  historyRetentionDays: number;
  /** 自動バックアップ設定 */
  autoBackup: {
    enabled: boolean;
    intervalDays: number;
    maxBackups: number;
  };
  /** 統計収集設定 */
  collectStatistics: boolean;
  /** デフォルトタグ */
  defaultTags: string[];
  /** インポート・エクスポート設定 */
  importExport: {
    includeHistory: boolean;
    includePrivateData: boolean;
    compression: boolean;
  };
}

/**
 * バックアップデータ
 */
export interface VariableBackupData {
  /** バックアップID */
  id: string;
  /** バックアップ名 */
  name: string;
  /** 作成日時 */
  createdAt: Date;
  /** バックアップサイズ（バイト） */
  size: number;
  /** 含まれるデータ */
  contents: {
    variables: VariableMetadata[];
    valueSets: VariableValueSet[];
    templates: VariableTemplate[];
    promptManagements: PromptVariableManagement[];
    history: VariableValueHistory[];
    settings: VariableManagerSettings;
  };
  /** 圧縮フラグ */
  isCompressed: boolean;
  /** チェックサム */
  checksum: string;
}

/**
 * インポート・エクスポート形式
 */
export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  YAML = 'yaml',
  XML = 'xml',
}

/**
 * インポート・エクスポートオプション
 */
export interface ImportExportOptions {
  /** フォーマット */
  format: ExportFormat;
  /** 含めるデータタイプ */
  includeTypes: {
    variables: boolean;
    valueSets: boolean;
    templates: boolean;
    history: boolean;
    settings: boolean;
  };
  /** フィルタ設定 */
  filters?: {
    /** 日付範囲 */
    dateRange?: {
      from: Date;
      to: Date;
    };
    /** タグフィルタ */
    tags?: string[];
    /** お気に入りのみ */
    favoritesOnly?: boolean;
  };
  /** 圧縮設定 */
  compression?: boolean;
  /** 暗号化設定 */
  encryption?: {
    enabled: boolean;
    password?: string;
  };
}

/**
 * 検索クエリ
 */
export interface VariableSearchQuery {
  /** 検索テキスト */
  text?: string;
  /** タグフィルタ */
  tags?: string[];
  /** 変数タイプフィルタ */
  types?: VariableType[];
  /** お気に入りフィルタ */
  favoritesOnly?: boolean;
  /** 使用回数範囲 */
  usageCountRange?: {
    min: number;
    max: number;
  };
  /** 日付範囲 */
  dateRange?: {
    from: Date;
    to: Date;
  };
  /** ソート設定 */
  sort?: {
    field: 'name' | 'usageCount' | 'createdAt' | 'lastUsedAt';
    order: 'asc' | 'desc';
  };
  /** ページング */
  pagination?: {
    page: number;
    pageSize: number;
  };
}

/**
 * 検索結果
 */
export interface VariableSearchResult<T> {
  /** 結果データ */
  items: T[];
  /** 総件数 */
  totalCount: number;
  /** 現在のページ */
  currentPage: number;
  /** 総ページ数 */
  totalPages: number;
  /** 検索にかかった時間（ミリ秒） */
  searchTimeMs: number;
}

/**
 * 変数提案
 */
export interface VariableSuggestion {
  /** 提案される変数名 */
  name: string;
  /** 提案の理由 */
  reason: string;
  /** 信頼度スコア（0-1） */
  confidence: number;
  /** 提案されるデフォルト値 */
  suggestedDefaultValue?: string;
  /** 提案される説明 */
  suggestedDescription?: string;
  /** 提案される型 */
  suggestedType?: VariableType;
} 