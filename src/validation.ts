import { PROMPT_CONSTANTS, PromptData, PromptInput, PromptVariable, ValidationError } from './types';

/**
 * プロンプト入力データのバリデーション
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
                message: 'タイトルは必須です'
            });
        } else if (input.title.length > PROMPT_CONSTANTS.MAX_TITLE_LENGTH) {
            errors.push({
                field: 'title',
                message: `タイトルは${PROMPT_CONSTANTS.MAX_TITLE_LENGTH}文字以内で入力してください`
            });
        } else if (existingPrompts) {
            // タイトルの重複チェック
            const duplicatePrompt = existingPrompts.find(prompt => 
                prompt.title.trim().toLowerCase() === input.title.trim().toLowerCase() && 
                prompt.id !== excludeId
            );
            if (duplicatePrompt) {
                errors.push({
                    field: 'title',
                    message: 'このタイトルは既に使用されています。別のタイトルを入力してください'
                });
            }
        }

        // 内容の検証
        if (!input.content || input.content.trim().length === 0) {
            errors.push({
                field: 'content',
                message: 'プロンプト内容は必須です'
            });
        } else if (input.content.trim().length < 3) {
            errors.push({
                field: 'content',
                message: 'プロンプト内容は3文字以上で入力してください'
            });
        } else if (input.content.length > PROMPT_CONSTANTS.MAX_CONTENT_LENGTH) {
            errors.push({
                field: 'content',
                message: `プロンプト内容は${PROMPT_CONSTANTS.MAX_CONTENT_LENGTH}文字以内で入力してください`
            });
        }

        // 説明の検証（空でない場合）
        if (input.description && input.description.trim().length > 0) {
            if (input.description.length > PROMPT_CONSTANTS.MAX_DESCRIPTION_LENGTH) {
                errors.push({
                    field: 'description',
                    message: `説明は${PROMPT_CONSTANTS.MAX_DESCRIPTION_LENGTH}文字以内で入力してください`
                });
            }
        }

        // 優先度の検証
        if (input.priority !== undefined && (input.priority < 1 || input.priority > 5)) {
            errors.push({
                field: 'priority',
                message: '優先度は1から5の間で設定してください'
            });
        }

        // タグの検証
        if (input.tags && input.tags.length > PROMPT_CONSTANTS.MAX_TAGS_COUNT) {
            errors.push({
                field: 'tags',
                message: `タグは${PROMPT_CONSTANTS.MAX_TAGS_COUNT}個まで設定できます`
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
     * タグ名の検証
     */
    static validateTagName(tag: string): boolean {
        return !!(tag && tag.trim().length > 0 && tag.length <= 30);
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
        const requiredFields = ['id', 'title', 'content', 'createdAt', 'updatedAt'];
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

        if (data.tags !== undefined && !Array.isArray(data.tags)) {
            errors.push({
                field: `${prefix}.tags`,
                message: 'tagsは配列である必要があります'
            });
        }

        // 日付形式の検証
        if (data.createdAt && !this.isValidDateString(data.createdAt)) {
            errors.push({
                field: `${prefix}.createdAt`,
                message: 'createdAtの日付形式が不正です'
            });
        }

        if (data.updatedAt && !this.isValidDateString(data.updatedAt)) {
            errors.push({
                field: `${prefix}.updatedAt`,
                message: 'updatedAtの日付形式が不正です'
            });
        }

        return errors;
    }

    /**
     * 日付文字列の妥当性を検証
     */
    static isValidDateString(dateStr: string): boolean {
        if (!dateStr || typeof dateStr !== 'string') return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime()) && date.toISOString() === dateStr;
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

            // 日付の妥当性チェック
            if (prompt.createdAt > prompt.updatedAt) {
                errors.push({
                    field: `prompts[${index}].updatedAt`,
                    message: '更新日時が作成日時より古い値になっています'
                });
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
        const now = new Date();
        
        return {
            id: this.generateId(),
            title: input.title.trim(),
            content: input.content.trim(),
            description: input.description?.trim(),
            tags: input.tags?.map(tag => tag.trim()).filter(tag => tag.length > 0) || [],
            priority: input.priority || PROMPT_CONSTANTS.DEFAULT_PRIORITY,
            usageCount: 0,
            isFavorite: false,
            isArchived: false,
            createdAt: now,
            updatedAt: now,
            variables: input.variables || []
        };
    }

    /**
     * プロンプトデータを更新
     */
    static updatePromptData(existing: PromptData, input: PromptInput): PromptData {
        return {
            ...existing,
            title: input.title.trim(),
            content: input.content.trim(),
            description: input.description?.trim(),
            tags: input.tags?.map(tag => tag.trim()).filter(tag => tag.length > 0) || existing.tags,
            priority: input.priority !== undefined ? input.priority : existing.priority,
            updatedAt: new Date(),
            variables: input.variables || existing.variables
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
     * プロンプトデータをシリアライズ（日付を文字列に変換）
     */
    static serializePromptData(prompt: PromptData): any {
        return {
            ...prompt,
            createdAt: prompt.createdAt.toISOString(),
            updatedAt: prompt.updatedAt.toISOString()
        };
    }

    /**
     * シリアライズされたデータからプロンプトデータを復元
     */
    static deserializePromptData(data: any): PromptData {
        return {
            ...data,
            createdAt: new Date(data.createdAt),
            updatedAt: new Date(data.updatedAt),
            tags: data.tags || [],
            variables: data.variables || [],
            priority: data.priority || PROMPT_CONSTANTS.DEFAULT_PRIORITY,
            isFavorite: (data.isFavorite === true || data.isFavorite === 'true') as boolean,
            isArchived: (data.isArchived === true || data.isArchived === 'true') as boolean,
            description: data.description || undefined
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
        const description = prompt.description?.toLowerCase() || '';
        const tags = prompt.tags.join(' ').toLowerCase();

        return title.includes(searchText) || 
               content.includes(searchText) || 
               description.includes(searchText) || 
               tags.includes(searchText);
    }

    /**
     * タグ配列を正規化（重複除去、空文字削除、ソート）
     */
    static normalizeTags(tags: string[]): string[] {
        return Array.from(new Set(
            tags.map(tag => tag.trim())
                .filter(tag => tag.length > 0)
        )).sort();
    }
} 