import * as vscode from 'vscode';
import { PROMPT_CONSTANTS, PromptData, PromptExportData, SerializedPromptCollection } from './types';
import { PromptUtils } from './validation';

/**
 * プロンプトデータの永続化を管理するクラス
 */
export class PromptStorage {
    private context: vscode.ExtensionContext;
    private readonly STORAGE_KEY = 'promptTemplateManager.prompts';
    private readonly BACKUP_KEY = 'promptTemplateManager.backup';
    private readonly MIGRATION_KEY = 'promptTemplateManager.migrationVersion';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * プロンプトデータを読み込み
     */
    async loadPrompts(): Promise<PromptData[]> {
        try {
            // メインデータの読み込み試行
            const mainData = await this.loadFromStorage(this.STORAGE_KEY);
            if (mainData) {
                await this.performMigrationIfNeeded(mainData);
                return this.deserializePrompts(mainData.prompts || []);
            }

            // メインデータが無い場合はバックアップを試行
            const backupData = await this.loadFromStorage(this.BACKUP_KEY);
            if (backupData) {
                console.warn('メインデータが見つからないため、バックアップから復元しています');
                vscode.window.showWarningMessage('プロンプトデータをバックアップから復元しました');
                
                // バックアップをメインに復元
                await this.saveToStorage(this.STORAGE_KEY, backupData);
                return this.deserializePrompts(backupData.prompts || []);
            }

            // 新規ユーザーの場合
            console.log('新規ユーザー: 空のプロンプトリストで初期化');
            await this.initializeStorage();
            return [];

        } catch (error) {
            console.error('プロンプトデータの読み込みに失敗:', error);
            vscode.window.showErrorMessage('プロンプトデータの読み込みに失敗しました。空のリストで開始します。');
            return [];
        }
    }

    /**
     * プロンプトデータを保存
     */
    async savePrompts(prompts: PromptData[]): Promise<boolean> {
        try {
            const serializedData: SerializedPromptCollection = {
                prompts: prompts.map(prompt => PromptUtils.serializePromptData(prompt)),
                availableTags: this.extractUniqueTags(prompts),
                lastUpdated: new Date().toISOString(),
                version: PROMPT_CONSTANTS.DATA_VERSION
            };

            // メインデータを保存
            await this.saveToStorage(this.STORAGE_KEY, serializedData);

            // バックアップを作成（非同期で実行）
            this.createBackup(serializedData).catch(error => {
                console.warn('バックアップの作成に失敗:', error);
            });

            return true;

        } catch (error) {
            console.error('プロンプトデータの保存に失敗:', error);
            vscode.window.showErrorMessage('プロンプトデータの保存に失敗しました');
            return false;
        }
    }

    /**
     * データをエクスポート
     */
    async exportData(prompts: PromptData[]): Promise<PromptExportData> {
        const exportData: PromptExportData = {
            exportedAt: new Date().toISOString(),
            prompts: prompts,
            version: PROMPT_CONSTANTS.DATA_VERSION,
            source: {
                name: 'Prompt Template Manager',
                version: PROMPT_CONSTANTS.DATA_VERSION
            }
        };

        return exportData;
    }

    /**
     * データをインポート
     */
    async importData(exportData: PromptExportData): Promise<PromptData[]> {
        try {
            // バージョンチェック
            if (!this.isCompatibleVersion(exportData.version)) {
                throw new Error(`サポートされていないバージョンです: ${exportData.version}`);
            }

            // データの妥当性チェック
            if (!Array.isArray(exportData.prompts)) {
                throw new Error('不正なデータ形式です');
            }

            // プロンプトデータを復元
            const importedPrompts = exportData.prompts.map(promptData => {
                // IDの重複を避けるため、新しいIDを生成
                return {
                    ...promptData,
                    id: PromptUtils.generateId(),
                    createdAt: new Date(promptData.createdAt),
                    updatedAt: new Date(promptData.updatedAt)
                } as PromptData;
            });

            return importedPrompts;

        } catch (error) {
            console.error('データのインポートに失敗:', error);
            throw new Error(`インポートに失敗しました: ${(error as Error).message}`);
        }
    }

    /**
     * ストレージを初期化
     */
    private async initializeStorage(): Promise<void> {
        const initialData: SerializedPromptCollection = {
            prompts: [],
            availableTags: [],
            lastUpdated: new Date().toISOString(),
            version: PROMPT_CONSTANTS.DATA_VERSION
        };

        await this.saveToStorage(this.STORAGE_KEY, initialData);
        await this.context.globalState.update(this.MIGRATION_KEY, PROMPT_CONSTANTS.DATA_VERSION);
    }

    /**
     * ストレージからデータを読み込み
     */
    private async loadFromStorage(key: string): Promise<SerializedPromptCollection | null> {
        const data = this.context.globalState.get<SerializedPromptCollection>(key);
        return data || null;
    }

    /**
     * ストレージにデータを保存
     */
    private async saveToStorage(key: string, data: SerializedPromptCollection): Promise<void> {
        await this.context.globalState.update(key, data);
    }

    /**
     * シリアライズされたプロンプトデータを復元
     */
    private deserializePrompts(serializedPrompts: any[]): PromptData[] {
        return serializedPrompts.map(data => {
            try {
                return PromptUtils.deserializePromptData(data);
            } catch (error) {
                console.warn('プロンプトデータの復元に失敗、スキップします:', error);
                return null;
            }
        }).filter(prompt => prompt !== null) as PromptData[];
    }

    /**
     * バックアップを作成
     */
    private async createBackup(data: SerializedPromptCollection): Promise<void> {
        await this.saveToStorage(this.BACKUP_KEY, data);
    }

    /**
     * マイグレーションが必要かチェックし、実行
     */
    private async performMigrationIfNeeded(data: SerializedPromptCollection): Promise<void> {
        const currentVersion = data.version || '0.0.0';
        const migrationVersion = this.context.globalState.get<string>(this.MIGRATION_KEY, '0.0.0');

        if (currentVersion !== PROMPT_CONSTANTS.DATA_VERSION || migrationVersion !== PROMPT_CONSTANTS.DATA_VERSION) {
            console.log(`データマイグレーションを実行: ${currentVersion} -> ${PROMPT_CONSTANTS.DATA_VERSION}`);
            
            try {
                const migratedData = await this.migrateData(data, currentVersion);
                await this.saveToStorage(this.STORAGE_KEY, migratedData);
                await this.context.globalState.update(this.MIGRATION_KEY, PROMPT_CONSTANTS.DATA_VERSION);
                
                vscode.window.showInformationMessage('プロンプトデータを最新バージョンに更新しました');
            } catch (error) {
                console.error('マイグレーションに失敗:', error);
                vscode.window.showWarningMessage('データの更新に失敗しました。古い形式のまま使用します。');
            }
        }
    }

    /**
     * データのマイグレーション実行
     */
    private async migrateData(data: SerializedPromptCollection, fromVersion: string): Promise<SerializedPromptCollection> {
        let migratedData = { ...data };

        // バージョン別のマイグレーション処理
        if (this.compareVersions(fromVersion, '1.0.0') < 0) {
            // v1.0.0へのマイグレーション
            migratedData = await this.migrateTo100(migratedData);
        }

        // 最新バージョンに更新
        migratedData.version = PROMPT_CONSTANTS.DATA_VERSION;
        migratedData.lastUpdated = new Date().toISOString();

        return migratedData;
    }

    /**
     * v1.0.0へのマイグレーション
     */
    private async migrateTo100(data: SerializedPromptCollection): Promise<SerializedPromptCollection> {
        // 古い形式のプロンプトデータに新しいフィールドを追加
        const migratedPrompts = data.prompts.map(prompt => ({
            ...prompt,
            tags: prompt.tags || [],
            priority: prompt.priority || PROMPT_CONSTANTS.DEFAULT_PRIORITY,
            isFavorite: prompt.isFavorite || false,
            isArchived: prompt.isArchived || false,
            variables: prompt.variables || []
        }));

        return {
            ...data,
            prompts: migratedPrompts,
            availableTags: this.extractUniqueTagsFromSerialized(migratedPrompts)
        };
    }

    /**
     * プロンプトからユニークなタグを抽出
     */
    private extractUniqueTags(prompts: PromptData[]): string[] {
        const allTags = prompts.flatMap(prompt => prompt.tags);
        return Array.from(new Set(allTags)).sort();
    }

    /**
     * シリアライズされたプロンプトからユニークなタグを抽出
     */
    private extractUniqueTagsFromSerialized(prompts: any[]): string[] {
        const allTags = prompts.flatMap(prompt => prompt.tags || []);
        return Array.from(new Set(allTags)).sort();
    }

    /**
     * バージョンの互換性をチェック
     */
    private isCompatibleVersion(version: string): boolean {
        const majorVersion = version.split('.')[0];
        const currentMajorVersion = PROMPT_CONSTANTS.DATA_VERSION.split('.')[0];
        return majorVersion === currentMajorVersion;
    }

    /**
     * バージョンを比較（-1: a < b, 0: a = b, 1: a > b）
     */
    private compareVersions(a: string, b: string): number {
        const parseVersion = (version: string) => 
            version.split('.').map(num => parseInt(num, 10));
        
        const versionA = parseVersion(a);
        const versionB = parseVersion(b);
        
        for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
            const partA = versionA[i] || 0;
            const partB = versionB[i] || 0;
            
            if (partA < partB) return -1;
            if (partA > partB) return 1;
        }
        
        return 0;
    }

    /**
     * ストレージの使用量を取得
     */
    async getStorageInfo(): Promise<{ totalPrompts: number; storageSize: string; lastBackup: string | null }> {
        try {
            const data = await this.loadFromStorage(this.STORAGE_KEY);
            const backupData = await this.loadFromStorage(this.BACKUP_KEY);
            
            const totalPrompts = data?.prompts?.length || 0;
            const storageSize = this.calculateStorageSize(data);
            const lastBackup = backupData?.lastUpdated || null;

            return {
                totalPrompts,
                storageSize,
                lastBackup
            };
        } catch (error) {
            console.error('ストレージ情報の取得に失敗:', error);
            return {
                totalPrompts: 0,
                storageSize: '不明',
                lastBackup: null
            };
        }
    }

    /**
     * ストレージサイズを計算
     */
    private calculateStorageSize(data: SerializedPromptCollection | null): string {
        if (!data) return '0 KB';
        
        const jsonString = JSON.stringify(data);
        const sizeInBytes = new Blob([jsonString]).size;
        
        if (sizeInBytes < 1024) {
            return `${sizeInBytes} B`;
        } else if (sizeInBytes < 1024 * 1024) {
            return `${(sizeInBytes / 1024).toFixed(1)} KB`;
        } else {
            return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
        }
    }

    /**
     * ストレージをクリア（開発・テスト用）
     */
    async clearStorage(): Promise<void> {
        await this.context.globalState.update(this.STORAGE_KEY, undefined);
        await this.context.globalState.update(this.BACKUP_KEY, undefined);
        await this.context.globalState.update(this.MIGRATION_KEY, undefined);
        console.log('ストレージをクリアしました');
    }
} 