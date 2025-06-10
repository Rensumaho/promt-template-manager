/**
 * プロンプトデータの基本型定義
 */
export interface PromptData {
    /** プロンプトの一意識別子 */
    id: string;
    
    /** プロンプトのタイトル */
    title: string;
    
    /** プロンプトの内容 */
    content: string;
    
    /** 使用回数 */
    usageCount: number;
    
    /** プロンプトの優先度（1-5、5が最高） */
    priority: number;
    
    /** お気に入り登録フラグ */
    isFavorite: boolean;
    
    /** アーカイブフラグ（非表示用） */
    isArchived: boolean;
    
    /** 変数情報（レベル5で使用予定） */
    variables?: PromptVariable[];
}

/**
 * プロンプト内変数の定義（レベル5準備）
 */
export interface PromptVariable {
    /** 変数名 */
    name: string;
    
    /** デフォルト値 */
    defaultValue: string;
    
    /** 変数の説明 */
    description?: string;
    
    /** 必須フラグ */
    required: boolean;
    
    /** 変数の型 */
    type: 'string' | 'number' | 'boolean' | 'select';
    
    /** セレクトタイプの場合の選択肢 */
    options?: string[];
}

/**
 * プロンプト作成・編集用の入力データ型
 */
export interface PromptInput {
    title: string;
    content: string;
    priority?: number;
    variables?: PromptVariable[];
}

/**
 * プロンプト検索・フィルタリング用の条件型
 */
export interface PromptSearchCriteria {
    /** 検索キーワード */
    query?: string;
    
    /** 優先度フィルタ */
    priority?: number;
    
    /** お気に入りのみ */
    favoritesOnly?: boolean;
    
    /** アーカイブを除外 */
    excludeArchived?: boolean;
    
    /** 並び順 */
    sortBy?: SortBy;
    
    /** 並び順の方向 */
    sortOrder?: SortOrder;
}

/**
 * 並び順の種類
 */
export type SortBy = 
    | 'usageCount'      // 使用回数順
    | 'title'           // タイトル順
    | 'priority';       // 優先度順

/**
 * 並び順の方向
 */
export type SortOrder = 'asc' | 'desc';

/**
 * プロンプト一覧管理用のコレクション型
 */
export interface PromptCollection {
    /** プロンプトのマップ（ID -> PromptData） */
    prompts: Map<string, PromptData>;
    
    /** データバージョン（マイグレーション用） */
    version: string;
}

/**
 * データ永続化用のシリアライズ型
 */
export interface SerializedPromptCollection {
    prompts: PromptData[];
    version: string;
}

/**
 * プロンプト操作の結果型
 */
export interface PromptOperationResult {
    success: boolean;
    message?: string;
    data?: PromptData;
}

/**
 * バリデーションエラー型
 */
export interface ValidationError {
    field: string;
    message: string;
}

/**
 * プロンプト統計情報型
 */
export interface PromptStats {
    /** 総プロンプト数 */
    totalCount: number;
    
    /** 今日作成されたプロンプト数 */
    todayCreated: number;
    
    /** 今週使用されたプロンプト数 */
    weeklyUsage: number;
    
    /** 最も使用頻度の高いプロンプト */
    mostUsedPrompt?: PromptData;
}

/**
 * エクスポート/インポート用のデータ形式
 */
export interface PromptExportData {
    /** エクスポート日時 */
    exportedAt: string;
    
    /** エクスポートしたプロンプト */
    prompts: PromptData[];
    
    /** データバージョン */
    version: string;
    
    /** エクスポート元の情報 */
    source: {
        name: string;
        version: string;
    };
}

/**
 * 定数定義
 */
export const PROMPT_CONSTANTS = {
    /** データバージョン */
    DATA_VERSION: '1.0.0',
    
    /** デフォルトの優先度 */
    DEFAULT_PRIORITY: 3,
    
    /** 最大タイトル長 */
    MAX_TITLE_LENGTH: 100,
    
    /** 最大内容長 */
    MAX_CONTENT_LENGTH: 10000,
    
    /** 最大説明長 */
    MAX_DESCRIPTION_LENGTH: 500,
    
    /** 最大タグ数 */
    MAX_TAGS_COUNT: 10,
    
    /** 最大変数数 */
    MAX_VARIABLES_COUNT: 20,
} as const; 