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
            const data = await this.loadFromStorage(this.STORAGE_KEY);
            
            if (!data) {
                // 初回起動時：空のデータで初期化
                await this.initializeStorage();
                return [];
            }

            // マイグレーションが必要な場合は実行
            await this.performMigrationIfNeeded(data);

            // プロンプトデータを復元
            const prompts = this.deserializePrompts(data.prompts);
            
            console.log(`${prompts.length}件のプロンプトを正常に読み込みました`);
            return prompts;

        } catch (error) {
            console.error('プロンプトデータの読み込みに失敗:', error);
            
            // バックアップから復元を試行
            try {
                const backupData = await this.loadFromStorage(this.BACKUP_KEY);
                if (backupData) {
                    console.log('バックアップからプロンプトデータを復元します');
                    const prompts = this.deserializePrompts(backupData.prompts);
                    // メインデータの読み込みに失敗したため、バックアップから復元しました
                    return prompts;
                }
            } catch (backupError) {
                console.error('バックアップの復元にも失敗:', backupError);
            }
            
            // すべて失敗した場合は空の配列を返す
            // プロンプトデータの読み込みに失敗しました。空のリストで開始します。
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
            // プロンプトデータの保存に失敗しました
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
                    id: PromptUtils.generateId()
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
                
                // プロンプトデータを最新バージョンに更新しました
            } catch (error) {
                console.error('マイグレーションに失敗:', error);
                // データの更新に失敗しました。古い形式のまま使用します。
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

        return migratedData;
    }

    /**
     * v1.0.0へのマイグレーション
     */
    private async migrateTo100(data: SerializedPromptCollection): Promise<SerializedPromptCollection> {
        // 古い形式のプロンプトデータから不要なフィールドを除去
        const migratedPrompts = data.prompts.map(prompt => {
            const { tags, createdAt, updatedAt, description, ...coreFields } = prompt as any;
            return {
                ...coreFields,
                priority: prompt.priority || PROMPT_CONSTANTS.DEFAULT_PRIORITY,
                isFavorite: prompt.isFavorite || false,
                isArchived: prompt.isArchived || false,
                variables: prompt.variables || []
            };
        });

        return {
            prompts: migratedPrompts,
            version: PROMPT_CONSTANTS.DATA_VERSION
        };
    }

    /**
     * バージョンの互換性をチェック
     */
    private isCompatibleVersion(version: string): boolean {
        // 現在のバージョンと同じか、マイナーバージョンが異なる場合は互換性あり
        const current = PROMPT_CONSTANTS.DATA_VERSION.split('.').map(Number);
        const target = version.split('.').map(Number);
        
        return current[0] === target[0]; // メジャーバージョンが同じなら互換性あり
    }

    /**
     * バージョン比較（a < b なら負の数、a > b なら正の数、a === b なら0）
     */
    private compareVersions(a: string, b: string): number {
        const parseVersion = (version: string) => 
            version.split('.').map(num => parseInt(num, 10));
        
        const versionA = parseVersion(a);
        const versionB = parseVersion(b);
        
        for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
            const numA = versionA[i] || 0;
            const numB = versionB[i] || 0;
            
            if (numA < numB) return -1;
            if (numA > numB) return 1;
        }
        
        return 0;
    }

    /**
     * ストレージ情報を取得
     */
    async getStorageInfo(): Promise<{ totalPrompts: number; storageSize: string; lastBackup: string | null }> {
        try {
            const mainData = await this.loadFromStorage(this.STORAGE_KEY);
            const backupData = await this.loadFromStorage(this.BACKUP_KEY);
            
            const totalPrompts = mainData ? mainData.prompts.length : 0;
            const storageSize = this.calculateStorageSize(mainData);
            const lastBackup = backupData ? '利用可能' : null;
            
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
        if (!data) return '0KB';
        
        try {
            const jsonString = JSON.stringify(data);
            const sizeInBytes = new Blob([jsonString]).size;
            const sizeInKB = Math.round(sizeInBytes / 1024 * 100) / 100;
            
            if (sizeInKB < 1024) {
                return `${sizeInKB}KB`;
            } else {
                const sizeInMB = Math.round(sizeInKB / 1024 * 100) / 100;
                return `${sizeInMB}MB`;
            }
        } catch (error) {
            console.error('ストレージサイズの計算に失敗:', error);
            return '計算不可';
        }
    }

    /**
     * ストレージをクリア
     */
    async clearStorage(): Promise<void> {
        await this.context.globalState.update(this.STORAGE_KEY, undefined);
        await this.context.globalState.update(this.BACKUP_KEY, undefined);
        await this.context.globalState.update(this.MIGRATION_KEY, undefined);
    }
} 