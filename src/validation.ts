import { PROMPT_CONSTANTS, PromptData, PromptInput, PromptVariable, ValidationError } from './types';

/**
 * プロンプトデータのバリデーション機能を提供するクラス
 */
export class PromptValidator {
    /**
     * プロンプト入力データの検証
     */
    static validatePromptInput(input: PromptInput, existingPrompts?: PromptData[], excludeId?: string): ValidationError[] {
        const errors: ValidationError[] = [];

        // タイトルの検証
        if (!input.title || input.title.trim().length === 0) {
            errors.push({
                field: 'title',
                message: 'プロンプトのタイトルを入力してください'
            });
        } else if (input.title.length > PROMPT_CONSTANTS.MAX_TITLE_LENGTH) {
            errors.push({
                field: 'title',
                message: `プロンプトタイトルは${PROMPT_CONSTANTS.MAX_TITLE_LENGTH}文字以内で入力してください`
            });
        }

        // 重複チェック
        if (existingPrompts) {
            const titleLower = input.title.toLowerCase();
            const duplicate = existingPrompts.find(p => 
                p.title.toLowerCase() === titleLower && p.id !== excludeId
            );
            if (duplicate) {
                errors.push({
                    field: 'title',
                    message: '同じタイトルのプロンプトが既に存在します'
                });
            }
        }

        // プロンプト内容の検証（空のプロンプトも許可）
        if (input.content && input.content.length > PROMPT_CONSTANTS.MAX_CONTENT_LENGTH) {
            errors.push({
                field: 'content',
                message: `プロンプト内容は${PROMPT_CONSTANTS.MAX_CONTENT_LENGTH}文字以内で入力してください`
            });
        }

        // 優先度の検証
        if (input.priority !== undefined && (input.priority < 1 || input.priority > 5)) {
            errors.push({
                field: 'priority',
                message: '優先度は1から5の間で設定してください'
            });
        }

        // 変数の検証
        if (input.variables) {
            if (input.variables.length > PROMPT_CONSTANTS.MAX_VARIABLES_COUNT) {
                errors.push({
                    field: 'variables',
                    message: `変数は${PROMPT_CONSTANTS.MAX_VARIABLES_COUNT}個まで設定できます`
                });
            }

            input.variables.forEach((variable, index) => {
                const variableErrors = this.validateVariable(variable, index);
                errors.push(...variableErrors);
            });
        }

        return errors;
    }

    /**
     * 変数の検証
     */
    static validateVariable(variable: PromptVariable, index: number): ValidationError[] {
        const errors: ValidationError[] = [];
        const fieldPrefix = `variables[${index}]`;

        // 変数名の検証
        if (!variable.name || variable.name.trim().length === 0) {
            errors.push({
                field: `${fieldPrefix}.name`,
                message: '変数名は必須です'
            });
        } else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(variable.name)) {
            errors.push({
                field: `${fieldPrefix}.name`,
                message: '変数名は英字で始まり、英数字とアンダースコアのみ使用できます'
            });
        }

        // デフォルト値の検証
        if (variable.type === 'number' && variable.defaultValue && isNaN(Number(variable.defaultValue))) {
            errors.push({
                field: `${fieldPrefix}.defaultValue`,
                message: '数値型の変数のデフォルト値は数値である必要があります'
            });
        }

        // セレクトタイプの検証
        if (variable.type === 'select') {
            if (!variable.options || variable.options.length === 0) {
                errors.push({
                    field: `${fieldPrefix}.options`,
                    message: 'セレクトタイプの変数には選択肢が必要です'
                });
            }
        }

        return errors;
    }

    /**
     * プロンプトIDの検証
     */
    static validatePromptId(id: string): boolean {
        return !!(id && id.trim().length > 0);
    }

    /**
     * インポートデータの形式検証
     */
    static validateImportData(data: any): ValidationError[] {
        const errors: ValidationError[] = [];

        // 基本構造の検証
        if (!data || typeof data !== 'object') {
            errors.push({
                field: 'data',
                message: 'データが不正な形式です'
            });
            return errors;
        }

        // プロンプト配列の検証
        if (!Array.isArray(data.prompts)) {
            errors.push({
                field: 'prompts',
                message: 'プロンプトデータが配列形式ではありません'
            });
            return errors;
        }

        // 各プロンプトデータの検証
        data.prompts.forEach((prompt: any, index: number) => {
            const promptErrors = this.validatePromptDataStructure(prompt, index);
            errors.push(...promptErrors);
        });

        return errors;
    }

    /**
     * プロンプトデータ構造の検証
     */
    static validatePromptDataStructure(data: any, index?: number): ValidationError[] {
        const errors: ValidationError[] = [];
        const prefix = index !== undefined ? `prompts[${index}]` : 'prompt';

        // 必須フィールドの検証
        const requiredFields = ['id', 'title', 'content'];
        requiredFields.forEach(field => {
            if (!data[field]) {
                errors.push({
                    field: `${prefix}.${field}`,
                    message: `必須フィールド '${field}' が不足しています`
                });
            }
        });

        // データ型の検証
        if (data.usageCount !== undefined && typeof data.usageCount !== 'number') {
            errors.push({
                field: `${prefix}.usageCount`,
                message: 'usageCountは数値である必要があります'
            });
        }

        if (data.priority !== undefined && (typeof data.priority !== 'number' || data.priority < 1 || data.priority > 5)) {
            errors.push({
                field: `${prefix}.priority`,
                message: 'priorityは1-5の数値である必要があります'
            });
        }

        if (data.isFavorite !== undefined && typeof data.isFavorite !== 'boolean') {
            errors.push({
                field: `${prefix}.isFavorite`,
                message: 'isFavoriteはbool値である必要があります'
            });
        }

        return errors;
    }

    /**
     * ストレージデータの整合性を検証
     */
    static validateStorageIntegrity(prompts: PromptData[]): ValidationError[] {
        const errors: ValidationError[] = [];
        const seenIds = new Set<string>();

        prompts.forEach((prompt, index) => {
            // ID重複チェック
            if (seenIds.has(prompt.id)) {
                errors.push({
                    field: `prompts[${index}].id`,
                    message: `重複したID '${prompt.id}' が検出されました`
                });
            } else {
                seenIds.add(prompt.id);
            }

            // 使用回数の妥当性チェック
            if (prompt.usageCount < 0) {
                errors.push({
                    field: `prompts[${index}].usageCount`,
                    message: '使用回数が負の値になっています'
                });
            }
        });

        return errors;
    }
}

/**
 * プロンプトデータのユーティリティ関数
 */
export class PromptUtils {
    /**
     * 一意のIDを生成
     */
    static generateId(): string {
        return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * プロンプト入力からPromptDataを作成
     */
    static createPromptData(input: PromptInput): PromptData {
        return {
            id: this.generateId(),
            title: input.title.trim(),
            content: input.content.trim(),
            priority: input.priority || PROMPT_CONSTANTS.DEFAULT_PRIORITY,
            usageCount: 0,
            isFavorite: false,
            isArchived: false,
            variables: input.variables || []
        };
    }

    /**
     * プロンプト内容から変数を抽出
     */
    static extractVariables(content: string): string[] {
        const variableRegex = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
        const variables: string[] = [];
        let match;

        while ((match = variableRegex.exec(content)) !== null) {
            if (!variables.includes(match[1])) {
                variables.push(match[1]);
            }
        }

        return variables;
    }

    /**
     * プロンプト内容の変数を置換
     */
    static replaceVariables(content: string, variables: Record<string, string>): string {
        let result = content;
        
        Object.entries(variables).forEach(([name, value]) => {
            const regex = new RegExp(`\\{${name}\\}`, 'g');
            result = result.replace(regex, value);
        });

        return result;
    }

    /**
     * プロンプトデータをシリアライズ
     */
    static serializePromptData(prompt: PromptData): any {
        return { ...prompt };
    }

    /**
     * シリアライズされたデータからプロンプトデータを復元
     */
    static deserializePromptData(data: any): PromptData {
        return {
            id: data.id,
            title: data.title,
            content: data.content,
            usageCount: data.usageCount || 0,
            priority: data.priority || PROMPT_CONSTANTS.DEFAULT_PRIORITY,
            isFavorite: (data.isFavorite === true || data.isFavorite === 'true') as boolean,
            isArchived: (data.isArchived === true || data.isArchived === 'true') as boolean,
            variables: data.variables || []
        };
    }

    /**
     * 検索キーワードでプロンプトをフィルタリング
     */
    static matchesSearchQuery(prompt: PromptData, query: string): boolean {
        if (!query || query.trim().length === 0) {
            return true;
        }

        const searchText = query.toLowerCase();
        const title = prompt.title.toLowerCase();
        const content = prompt.content.toLowerCase();

        return title.includes(searchText) || content.includes(searchText);
    }
} 