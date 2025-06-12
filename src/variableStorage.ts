/**
 * 変数データの永続化とローカルストレージ管理
 */

import * as vscode from 'vscode';
import {
  ExportFormat,
  ImportExportOptions,
  PromptVariableManagement,
  VariableBackupData,
  VariableManagerSettings,
  VariableMetadata,
  VariableTemplate,
  VariableValueHistory,
  VariableValueSet,
} from './variableManagerTypes';

/**
 * ストレージキー定数
 */
const STORAGE_KEYS = {
  VARIABLES: 'ptm_variables',
  VALUE_SETS: 'ptm_value_sets',
  TEMPLATES: 'ptm_templates',
  PROMPT_MANAGEMENTS: 'ptm_prompt_managements',
  HISTORY: 'ptm_variable_history',
  SETTINGS: 'ptm_variable_settings',
  BACKUP_INDEX: 'ptm_backup_index',
} as const;

/**
 * デフォルト設定
 */
const DEFAULT_SETTINGS: VariableManagerSettings = {
  historyRetentionDays: 90,
  autoBackup: {
    enabled: true,
    intervalDays: 7,
    maxBackups: 10,
  },
  collectStatistics: true,
  defaultTags: ['一般', '開発', 'テスト'],
  importExport: {
    includeHistory: true,
    includePrivateData: false,
    compression: true,
  },
};

/**
 * 変数データストレージクラス
 */
export class VariableStorage {
  private static instance: VariableStorage;
  private context: vscode.ExtensionContext | null = null;

  private constructor() {}

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): VariableStorage {
    if (!VariableStorage.instance) {
      VariableStorage.instance = new VariableStorage();
    }
    return VariableStorage.instance;
  }

  /**
   * ExtensionContextを設定
   */
  async setContext(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    await this.initializeDefaultSettings();
  }

  /**
   * ExtensionContextが設定されているかチェック
   */
  private ensureContext(): void {
    if (!this.context) {
      throw new Error('ExtensionContext が設定されていません。setContext() を先に呼び出してください。');
    }
  }

  /**
   * デフォルト設定を初期化
   */
  private async initializeDefaultSettings(): Promise<void> {
    if (!this.getSettings()) {
      await this.saveSettings(DEFAULT_SETTINGS);
    }
  }

  /**
   * globalStateからデータを取得
   */
  private getStorageData<T>(key: string): T[] {
    this.ensureContext();
    try {
      const data = this.context!.globalState.get<string>(key);
      return data ? JSON.parse(data, this.dateReviver) : [];
    } catch (error) {
      console.error(`Error loading data from storage key "${key}":`, error);
      return [];
    }
  }

  /**
   * globalStateにデータを保存
   */
  private async setStorageData<T>(key: string, data: T[]): Promise<void> {
    this.ensureContext();
    try {
      await this.context!.globalState.update(key, JSON.stringify(data, this.dateReplacer));
    } catch (error) {
      console.error(`Error saving data to storage key "${key}":`, error);
      throw new Error(`ストレージへの保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 単一オブジェクトを取得
   */
  private getStorageObject<T>(key: string): T | null {
    this.ensureContext();
    try {
      const data = this.context!.globalState.get<string>(key);
      return data ? JSON.parse(data, this.dateReviver) : null;
    } catch (error) {
      console.error(`Error loading object from storage key "${key}":`, error);
      return null;
    }
  }

  /**
   * 単一オブジェクトを保存
   */
  private async setStorageObject<T>(key: string, data: T): Promise<void> {
    this.ensureContext();
    try {
      await this.context!.globalState.update(key, JSON.stringify(data, this.dateReplacer));
    } catch (error) {
      console.error(`Error saving object to storage key "${key}":`, error);
      throw new Error(`ストレージへの保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 日付オブジェクトのシリアライゼーション用リプレーサー
   */
  private dateReplacer(key: string, value: any): any {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  }

  /**
   * 日付オブジェクトのデシリアライゼーション用リバイバー
   */
  private dateReviver(key: string, value: any): any {
    if (value && value.__type === 'Date') {
      return new Date(value.value);
    }
    return value;
  }

  /**
   * IDを生成
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // === 変数メタデータ管理 ===

  /**
   * すべての変数メタデータを取得
   */
  getAllVariables(): VariableMetadata[] {
    return this.getStorageData<VariableMetadata>(STORAGE_KEYS.VARIABLES);
  }

  /**
   * 変数メタデータを保存
   */
  async saveVariable(variable: Omit<VariableMetadata, 'createdAt' | 'updatedAt'>): Promise<VariableMetadata> {
    const variables = this.getAllVariables();
    const now = new Date();
    
    const existingIndex = variables.findIndex(v => v.name === variable.name);
    const savedVariable: VariableMetadata = {
      ...variable,
      createdAt: existingIndex >= 0 ? variables[existingIndex].createdAt : now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      variables[existingIndex] = savedVariable;
    } else {
      variables.push(savedVariable);
    }

    await this.setStorageData(STORAGE_KEYS.VARIABLES, variables);
    return savedVariable;
  }

  /**
   * 変数メタデータを削除
   */
  async deleteVariable(variableName: string): Promise<boolean> {
    const variables = this.getAllVariables();
    const initialLength = variables.length;
    const filteredVariables = variables.filter(v => v.name !== variableName);
    
    if (filteredVariables.length !== initialLength) {
      await this.setStorageData(STORAGE_KEYS.VARIABLES, filteredVariables);
      return true;
    }
    return false;
  }

  // === 変数値セット管理 ===

  /**
   * すべての変数値セットを取得
   */
  getAllValueSets(): VariableValueSet[] {
    return this.getStorageData<VariableValueSet>(STORAGE_KEYS.VALUE_SETS);
  }

  /**
   * 変数値セットを保存
   */
  saveValueSet(valueSet: Omit<VariableValueSet, 'id' | 'createdAt' | 'updatedAt'>): VariableValueSet {
    const valueSets = this.getAllValueSets();
    const now = new Date();
    
    const savedValueSet: VariableValueSet = {
      ...valueSet,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    valueSets.push(savedValueSet);
    this.setStorageData(STORAGE_KEYS.VALUE_SETS, valueSets);
    return savedValueSet;
  }

  /**
   * 変数値セットを更新
   */
  updateValueSet(id: string, updates: Partial<VariableValueSet>): VariableValueSet | null {
    const valueSets = this.getAllValueSets();
    const index = valueSets.findIndex(vs => vs.id === id);
    
    if (index >= 0) {
      const updatedValueSet = {
        ...valueSets[index],
        ...updates,
        updatedAt: new Date(),
      };
      valueSets[index] = updatedValueSet;
      this.setStorageData(STORAGE_KEYS.VALUE_SETS, valueSets);
      return updatedValueSet;
    }
    return null;
  }

  /**
   * 変数値セットを削除
   */
  deleteValueSet(id: string): boolean {
    const valueSets = this.getAllValueSets();
    const filteredValueSets = valueSets.filter(vs => vs.id !== id);
    
    if (filteredValueSets.length !== valueSets.length) {
      this.setStorageData(STORAGE_KEYS.VALUE_SETS, filteredValueSets);
      return true;
    }
    return false;
  }

  // === テンプレート管理 ===

  /**
   * すべてのテンプレートを取得
   */
  getAllTemplates(): VariableTemplate[] {
    return this.getStorageData<VariableTemplate>(STORAGE_KEYS.TEMPLATES);
  }

  /**
   * テンプレートを保存
   */
  saveTemplate(template: Omit<VariableTemplate, 'id' | 'createdAt' | 'updatedAt'>): VariableTemplate {
    const templates = this.getAllTemplates();
    const now = new Date();
    
    const savedTemplate: VariableTemplate = {
      ...template,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now,
    };

    templates.push(savedTemplate);
    this.setStorageData(STORAGE_KEYS.TEMPLATES, templates);
    return savedTemplate;
  }

  /**
   * テンプレートを更新
   */
  updateTemplate(id: string, updates: Partial<VariableTemplate>): VariableTemplate | null {
    const templates = this.getAllTemplates();
    const index = templates.findIndex(t => t.id === id);
    
    if (index >= 0) {
      const updatedTemplate = {
        ...templates[index],
        ...updates,
        updatedAt: new Date(),
      };
      templates[index] = updatedTemplate;
      this.setStorageData(STORAGE_KEYS.TEMPLATES, templates);
      return updatedTemplate;
    }
    return null;
  }

  /**
   * テンプレートを削除
   */
  deleteTemplate(id: string): boolean {
    const templates = this.getAllTemplates();
    const filteredTemplates = templates.filter(t => t.id !== id);
    
    if (filteredTemplates.length !== templates.length) {
      this.setStorageData(STORAGE_KEYS.TEMPLATES, filteredTemplates);
      return true;
    }
    return false;
  }

  // === プロンプト変数管理 ===

  /**
   * すべてのプロンプト変数管理を取得
   */
  getAllPromptManagements(): PromptVariableManagement[] {
    return this.getStorageData<PromptVariableManagement>(STORAGE_KEYS.PROMPT_MANAGEMENTS);
  }

  /**
   * プロンプト変数管理を保存
   */
  savePromptManagement(promptManagement: Omit<PromptVariableManagement, 'createdAt' | 'updatedAt' | 'lastAccessedAt'>): PromptVariableManagement {
    const promptManagements = this.getAllPromptManagements();
    const now = new Date();
    
    const existingIndex = promptManagements.findIndex(pm => pm.promptId === promptManagement.promptId);
    const savedPromptManagement: PromptVariableManagement = {
      ...promptManagement,
      createdAt: existingIndex >= 0 ? promptManagements[existingIndex].createdAt : now,
      updatedAt: now,
      lastAccessedAt: now,
    };

    if (existingIndex >= 0) {
      promptManagements[existingIndex] = savedPromptManagement;
    } else {
      promptManagements.push(savedPromptManagement);
    }

    this.setStorageData(STORAGE_KEYS.PROMPT_MANAGEMENTS, promptManagements);
    return savedPromptManagement;
  }

  /**
   * プロンプト変数管理を削除
   */
  deletePromptManagement(promptId: string): boolean {
    const promptManagements = this.getAllPromptManagements();
    const filteredPromptManagements = promptManagements.filter(pm => pm.promptId !== promptId);
    
    if (filteredPromptManagements.length !== promptManagements.length) {
      this.setStorageData(STORAGE_KEYS.PROMPT_MANAGEMENTS, filteredPromptManagements);
      return true;
    }
    return false;
  }

  // === 履歴管理 ===

  /**
   * すべての変数値履歴を取得
   */
  getAllHistory(): VariableValueHistory[] {
    return this.getStorageData<VariableValueHistory>(STORAGE_KEYS.HISTORY);
  }

  /**
   * 変数値履歴を追加
   */
  addHistoryEntry(entry: Omit<VariableValueHistory, 'id' | 'setAt'>): VariableValueHistory {
    const history = this.getAllHistory();
    
    const historyEntry: VariableValueHistory = {
      ...entry,
      id: this.generateId(),
      setAt: new Date(),
    };

    history.push(historyEntry);
    
    // 履歴の保持期間を適用
    const settings = this.getSettings();
    if (settings) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - settings.historyRetentionDays);
      const filteredHistory = history.filter(h => h.setAt >= cutoffDate);
      this.setStorageData(STORAGE_KEYS.HISTORY, filteredHistory);
    } else {
      this.setStorageData(STORAGE_KEYS.HISTORY, history);
    }

    return historyEntry;
  }

  /**
   * 変数の履歴を取得
   */
  getVariableHistory(variableName: string): VariableValueHistory[] {
    const history = this.getAllHistory();
    return history.filter(h => h.variableName === variableName)
                 .sort((a, b) => b.setAt.getTime() - a.setAt.getTime());
  }

  /**
   * 履歴をクリア
   */
  clearHistory(beforeDate?: Date): void {
    if (beforeDate) {
      const history = this.getAllHistory();
      const filteredHistory = history.filter(h => h.setAt >= beforeDate);
      this.setStorageData(STORAGE_KEYS.HISTORY, filteredHistory);
    } else {
      this.setStorageData(STORAGE_KEYS.HISTORY, []);
    }
  }

  // === 設定管理 ===

  /**
   * 設定を取得
   */
  getSettings(): VariableManagerSettings | null {
    return this.getStorageObject<VariableManagerSettings>(STORAGE_KEYS.SETTINGS);
  }

  /**
   * 設定を保存
   */
  async saveSettings(settings: VariableManagerSettings): Promise<void> {
    await this.setStorageObject(STORAGE_KEYS.SETTINGS, settings);
  }

  // === バックアップ・復元 ===

  /**
   * バックアップを作成
   */
  createBackup(name?: string): VariableBackupData {
    const contents = {
      variables: this.getAllVariables(),
      valueSets: this.getAllValueSets(),
      templates: this.getAllTemplates(),
      promptManagements: this.getAllPromptManagements(),
      history: this.getAllHistory(),
      settings: this.getSettings() || DEFAULT_SETTINGS,
    };

    const backup: VariableBackupData = {
      id: this.generateId(),
      name: name || `Backup ${new Date().toLocaleDateString()}`,
      createdAt: new Date(),
      size: JSON.stringify(contents).length,
      contents,
      isCompressed: false,
      checksum: this.calculateChecksum(JSON.stringify(contents)),
    };

    // バックアップインデックスを更新
    const backups = this.getStorageData<VariableBackupData>('ptm_backups');
    backups.push(backup);
    
    // 最大バックアップ数を適用
    const settings = this.getSettings();
    if (settings && backups.length > settings.autoBackup.maxBackups) {
      backups.splice(0, backups.length - settings.autoBackup.maxBackups);
    }
    
    this.setStorageData('ptm_backups', backups);
    
    return backup;
  }

  /**
   * バックアップ一覧を取得
   */
  getAllBackups(): VariableBackupData[] {
    return this.getStorageData<VariableBackupData>('ptm_backups');
  }

  /**
   * バックアップから復元
   */
  restoreFromBackup(backupId: string): boolean {
    const backups = this.getAllBackups();
    const backup = backups.find(b => b.id === backupId);
    
    if (!backup) {
      return false;
    }

    try {
      // チェックサムを検証
      const currentChecksum = this.calculateChecksum(JSON.stringify(backup.contents));
      if (currentChecksum !== backup.checksum) {
        throw new Error('バックアップデータが破損しています');
      }

      // データを復元
      this.setStorageData(STORAGE_KEYS.VARIABLES, backup.contents.variables);
      this.setStorageData(STORAGE_KEYS.VALUE_SETS, backup.contents.valueSets);
      this.setStorageData(STORAGE_KEYS.TEMPLATES, backup.contents.templates);
      this.setStorageData(STORAGE_KEYS.PROMPT_MANAGEMENTS, backup.contents.promptManagements);
      this.setStorageData(STORAGE_KEYS.HISTORY, backup.contents.history);
      this.setStorageObject(STORAGE_KEYS.SETTINGS, backup.contents.settings);

      return true;
    } catch (error) {
      console.error('Backup restoration failed:', error);
      return false;
    }
  }

  /**
   * チェックサムを計算
   */
  private calculateChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return hash.toString(16);
  }

  // === データエクスポート・インポート ===

  /**
   * データをエクスポート
   */
  exportData(options: ImportExportOptions): string {
    let data: any = {};

    if (options.includeTypes.variables) {
      data.variables = this.getAllVariables();
    }
    if (options.includeTypes.valueSets) {
      data.valueSets = this.getAllValueSets();
    }
    if (options.includeTypes.templates) {
      data.templates = this.getAllTemplates();
    }
    if (options.includeTypes.history) {
      data.history = this.getAllHistory();
    }
    if (options.includeTypes.settings) {
      data.settings = this.getSettings();
    }

    // フィルタを適用
    if (options.filters) {
      data = this.applyExportFilters(data, options.filters);
    }

    switch (options.format) {
      case ExportFormat.JSON:
        return JSON.stringify(data, null, 2);
      case ExportFormat.CSV:
        return this.convertToCSV(data);
      case ExportFormat.YAML:
        return this.convertToYAML(data);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  /**
   * エクスポートフィルタを適用
   */
  private applyExportFilters(data: any, filters: any): any {
    // フィルタロジックの実装（日付範囲、タグなど）
    // ここでは簡略化
    return data;
  }

  /**
   * CSV形式に変換
   */
  private convertToCSV(data: any): string {
    // CSV変換の実装（簡略化）
    return JSON.stringify(data);
  }

  /**
   * YAML形式に変換
   */
  private convertToYAML(data: any): string {
    // YAML変換の実装（簡略化）
    return JSON.stringify(data, null, 2);
  }

  /**
   * データをインポート
   */
  importData(data: string, options: ImportExportOptions): boolean {
    try {
      let parsedData: any;

      switch (options.format) {
        case ExportFormat.JSON:
          parsedData = JSON.parse(data, this.dateReviver);
          break;
        default:
          throw new Error(`Unsupported import format: ${options.format}`);
      }

      // データを保存
      if (options.includeTypes.variables && parsedData.variables) {
        this.setStorageData(STORAGE_KEYS.VARIABLES, parsedData.variables);
      }
      if (options.includeTypes.valueSets && parsedData.valueSets) {
        this.setStorageData(STORAGE_KEYS.VALUE_SETS, parsedData.valueSets);
      }
      if (options.includeTypes.templates && parsedData.templates) {
        this.setStorageData(STORAGE_KEYS.TEMPLATES, parsedData.templates);
      }
      if (options.includeTypes.history && parsedData.history) {
        this.setStorageData(STORAGE_KEYS.HISTORY, parsedData.history);
      }
      if (options.includeTypes.settings && parsedData.settings) {
        this.setStorageObject(STORAGE_KEYS.SETTINGS, parsedData.settings);
      }

      return true;
    } catch (error) {
      console.error('Data import failed:', error);
      return false;
    }
  }

  /**
   * ストレージサイズを取得
   */
  getStorageSize(): { total: number; byType: Record<string, number> } {
    this.ensureContext();
    const sizes: Record<string, number> = {};
    let total = 0;

    Object.values(STORAGE_KEYS).forEach(key => {
      const data = this.context!.globalState.get<string>(key);
      const size = data ? data.length : 0;
      sizes[key] = size;
      total += size;
    });

    return { total, byType: sizes };
  }

  /**
   * ストレージをクリア
   */
  async clearAllData(): Promise<void> {
    this.ensureContext();
    const promises = Object.values(STORAGE_KEYS).map(key => 
      this.context!.globalState.update(key, undefined)
    );
    await Promise.all(promises);
    await this.initializeDefaultSettings();
  }
} 