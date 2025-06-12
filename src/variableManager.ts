/**
 * 変数管理システムの中核となるマネージャークラス
 */

import { VariableEngine } from './variableEngine';
import {
    ImportExportOptions,
    PromptVariableManagement,
    VariableMetadata,
    VariableSearchQuery,
    VariableSearchResult,
    VariableStatistics,
    VariableSuggestion,
    VariableType,
    VariableValueHistory,
    VariableValueSet
} from './variableManagerTypes';
import { VariableStorage } from './variableStorage';

/**
 * 変数管理マネージャークラス
 */
export class VariableManager {
  private static instance: VariableManager;
  private storage: VariableStorage;

  private constructor() {
    this.storage = VariableStorage.getInstance();
  }

  /**
   * シングルトンインスタンスを取得
   */
  static getInstance(): VariableManager {
    if (!VariableManager.instance) {
      VariableManager.instance = new VariableManager();
    }
    return VariableManager.instance;
  }

  // === プロンプト変数管理 ===

  /**
   * プロンプトから変数を解析して管理データを作成・更新
   */
  async analyzePrompt(promptId: string, promptText: string): Promise<PromptVariableManagement> {
    const parseResult = VariableEngine.parseVariables(promptText);
    
    // 既存の管理データを取得
    const existingPromptManagements = this.storage.getAllPromptManagements();
    const existingManagement = existingPromptManagements.find(pm => pm.promptId === promptId);

    // 変数メタデータを作成・更新
    const variablePromises = parseResult.variables.map(async (variable: any) => {
      const existingVariable = this.storage.getAllVariables().find(v => v.name === variable.name);
      
      if (existingVariable) {
        // 既存変数の使用回数を更新
        return await this.storage.saveVariable({
          ...existingVariable,
          usageCount: existingVariable.usageCount + 1,
          lastUsedAt: new Date(),
        });
      } else {
        // 新規変数を作成
        return await this.storage.saveVariable({
          name: variable.name,
          defaultValue: variable.defaultValue,
          startIndex: variable.startIndex,
          endIndex: variable.endIndex,
          rawText: variable.rawText,
          usageCount: 1,
          lastUsedAt: new Date(),
          description: this.generateVariableDescription(variable.name),
          type: this.inferVariableType(variable.name, variable.defaultValue),
          tags: ['自動生成'],
          isFavorite: false,
        });
      }
    });

    const variables = await Promise.all(variablePromises);

    // プロンプト変数管理データを保存
    const promptManagement: PromptVariableManagement = this.storage.savePromptManagement({
      promptId,
      promptText,
      variables,
      currentValueSet: existingManagement?.currentValueSet,
      valueHistory: existingManagement?.valueHistory || [],
    });

    return promptManagement;
  }

  /**
   * プロンプトの変数値を設定
   */
  setPromptVariableValues(promptId: string, values: Record<string, string>, saveAsSet?: boolean, setName?: string): string {
    const promptManagement = this.storage.getAllPromptManagements().find(pm => pm.promptId === promptId);
    if (!promptManagement) {
      throw new Error(`プロンプトID "${promptId}" が見つかりません`);
    }

    // 変数値を履歴に追加
    Object.entries(values).forEach(([variableName, value]) => {
      this.storage.addHistoryEntry({
        variableName,
        value,
        promptId,
        context: `プロンプト: ${promptManagement.promptText.substring(0, 50)}...`,
      });
    });

    // 変数値セットとして保存（オプション）
    if (saveAsSet && setName) {
      const valueSet = this.storage.saveValueSet({
        name: setName,
        description: `プロンプト "${promptId}" の変数値セット`,
        values,
        usageCount: 1,
        tags: ['プロンプト生成'],
      });

      // プロンプト管理データに現在の値セットを設定
      this.storage.savePromptManagement({
        ...promptManagement,
        currentValueSet: valueSet,
      });
    }

    // Record<string, string>をVariableValueMapに変換
    const variableMap = VariableEngine.createVariableMap(values);

    // プロンプトを置換
    const replaceResult = VariableEngine.replaceVariables(promptManagement.promptText, variableMap);
    if (replaceResult.errors.length > 0) {
      console.warn('Variable replacement warnings:', replaceResult.errors);
    }

    return replaceResult.replacedText;
  }

  /**
   * プロンプトの変数プレビューを生成
   */
  generatePromptPreview(promptId: string, values: Record<string, string>): string {
    const promptManagement = this.storage.getAllPromptManagements().find(pm => pm.promptId === promptId);
    if (!promptManagement) {
      throw new Error(`プロンプトID "${promptId}" が見つかりません`);
    }

    // Record<string, string>をVariableValueMapに変換
    const variableMap = VariableEngine.createVariableMap(values);
    
    const previewResult = VariableEngine.generatePreview(promptManagement.promptText, variableMap);
    return previewResult;
  }

  // === 変数メタデータ管理 ===

  /**
   * 変数メタデータを取得
   */
  getVariable(variableName: string): VariableMetadata | null {
    const variables = this.storage.getAllVariables();
    return variables.find(v => v.name === variableName) || null;
  }

  /**
   * 変数メタデータを更新
   */
  async updateVariable(variableName: string, updates: Partial<VariableMetadata>): Promise<VariableMetadata | null> {
    const variable = this.getVariable(variableName);
    if (!variable) {
      return null;
    }

    const updatedVariable = await this.storage.saveVariable({
      ...variable,
      ...updates,
    });

    return updatedVariable;
  }

  /**
   * 変数を削除
   */
  async deleteVariable(variableName: string): Promise<boolean> {
    return await this.storage.deleteVariable(variableName);
  }

  /**
   * 変数を検索
   */
  searchVariables(query: VariableSearchQuery): VariableSearchResult<VariableMetadata> {
    const startTime = Date.now();
    const allVariables = this.storage.getAllVariables();
    
    let filteredVariables = allVariables;

    // テキスト検索
    if (query.text) {
      const searchText = query.text.toLowerCase();
      filteredVariables = filteredVariables.filter(v =>
        v.name.toLowerCase().includes(searchText) ||
        (v.description && v.description.toLowerCase().includes(searchText)) ||
        (v.defaultValue && v.defaultValue.toLowerCase().includes(searchText))
      );
    }

    // タグフィルタ
    if (query.tags && query.tags.length > 0) {
      filteredVariables = filteredVariables.filter(v =>
        v.tags && v.tags.some(tag => query.tags!.includes(tag))
      );
    }

    // 型フィルタ
    if (query.types && query.types.length > 0) {
      filteredVariables = filteredVariables.filter(v =>
        v.type && query.types!.includes(v.type)
      );
    }

    // お気に入りフィルタ
    if (query.favoritesOnly) {
      filteredVariables = filteredVariables.filter(v => v.isFavorite);
    }

    // 使用回数範囲フィルタ
    if (query.usageCountRange) {
      const { min, max } = query.usageCountRange;
      filteredVariables = filteredVariables.filter(v =>
        v.usageCount >= min && v.usageCount <= max
      );
    }

    // 日付範囲フィルタ
    if (query.dateRange) {
      const { from, to } = query.dateRange;
      filteredVariables = filteredVariables.filter(v =>
        v.createdAt >= from && v.createdAt <= to
      );
    }

    // ソート
    if (query.sort) {
      const { field, order } = query.sort;
      filteredVariables.sort((a, b) => {
        let aValue = a[field];
        let bValue = b[field];

        // undefinedまたはnullの場合の処理
        if (aValue == null && bValue == null) return 0;
        if (aValue == null) return order === 'asc' ? -1 : 1;
        if (bValue == null) return order === 'asc' ? 1 : -1;

        if (aValue instanceof Date) aValue = aValue.getTime();
        if (bValue instanceof Date) bValue = bValue.getTime();

        if (typeof aValue === 'string') aValue = aValue.toLowerCase();
        if (typeof bValue === 'string') bValue = bValue.toLowerCase();

        if (order === 'asc') {
          return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
        } else {
          return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
        }
      });
    }

    // ページング
    const totalCount = filteredVariables.length;
    let paginatedVariables = filteredVariables;
    let currentPage = 1;
    let totalPages = 1;

    if (query.pagination) {
      const { page, pageSize } = query.pagination;
      currentPage = page;
      totalPages = Math.ceil(totalCount / pageSize);
      const startIndex = (page - 1) * pageSize;
      paginatedVariables = filteredVariables.slice(startIndex, startIndex + pageSize);
    }

    const searchTimeMs = Date.now() - startTime;

    return {
      items: paginatedVariables,
      totalCount,
      currentPage,
      totalPages,
      searchTimeMs,
    };
  }

  // === 変数値セット管理 ===

  /**
   * 変数値セットを取得
   */
  getValueSet(id: string): VariableValueSet | null {
    const valueSets = this.storage.getAllValueSets();
    return valueSets.find(vs => vs.id === id) || null;
  }

  /**
   * 変数値セットを適用
   */
  applyValueSet(promptId: string, valueSetId: string): string {
    const valueSet = this.getValueSet(valueSetId);
    if (!valueSet) {
      throw new Error(`変数値セット "${valueSetId}" が見つかりません`);
    }

    // 使用回数を更新
    this.storage.updateValueSet(valueSetId, {
      usageCount: valueSet.usageCount + 1,
    });

    return this.setPromptVariableValues(promptId, valueSet.values);
  }

  /**
   * よく使われる変数値セットを取得
   */
  getPopularValueSets(limit: number = 10): VariableValueSet[] {
    const valueSets = this.storage.getAllValueSets();
    return valueSets
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  // === テンプレート管理 ===

  /**
   * テンプレートから変数値セットを作成
   */
  createValueSetFromTemplate(templateId: string, customValues?: Record<string, string>): VariableValueSet {
    const template = this.storage.getAllTemplates().find(t => t.id === templateId);
    if (!template) {
      throw new Error(`テンプレート "${templateId}" が見つかりません`);
    }

    const values: Record<string, string> = {};

    // テンプレートのデフォルト値を使用
    if (template.defaultValueSet) {
      Object.assign(values, template.defaultValueSet.values);
    }

    // 変数のデフォルト値を使用
    template.variables.forEach(variable => {
      if (variable.defaultValue && !values[variable.name]) {
        values[variable.name] = variable.defaultValue;
      }
    });

    // カスタム値で上書き
    if (customValues) {
      Object.assign(values, customValues);
    }

    // 使用回数を更新
    this.storage.updateTemplate(templateId, {
      usageCount: template.usageCount + 1,
    });

    return this.storage.saveValueSet({
      name: `${template.name}から生成`,
      description: `テンプレート "${template.name}" から生成された変数値セット`,
      values,
      usageCount: 0,
      tags: ['テンプレート生成'],
    });
  }

  // === 履歴・統計 ===

  /**
   * 変数の使用履歴を取得
   */
  getVariableHistory(variableName: string): VariableValueHistory[] {
    return this.storage.getVariableHistory(variableName);
  }

  /**
   * 変数統計を生成
   */
  generateStatistics(): VariableStatistics {
    const variables = this.storage.getAllVariables();
    const valueSets = this.storage.getAllValueSets();
    const templates = this.storage.getAllTemplates();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const activeVariables = variables.filter(v => 
      v.lastUsedAt && v.lastUsedAt >= thirtyDaysAgo
    ).length;

    const mostUsedVariables = variables
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10)
      .map(v => ({ name: v.name, usageCount: v.usageCount }));

    const recentlyAddedVariables = variables
      .filter(v => v.createdAt >= thirtyDaysAgo)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    return {
      totalVariables: variables.length,
      activeVariables,
      mostUsedVariables,
      recentlyAddedVariables,
      favoriteVariablesCount: variables.filter(v => v.isFavorite).length,
      valueSetCount: valueSets.length,
      templateCount: templates.length,
    };
  }

  // === 提案機能 ===

  /**
   * 変数名を提案
   */
  suggestVariableNames(context: string): VariableSuggestion[] {
    const suggestions: VariableSuggestion[] = [];

    // 一般的な変数名パターンを提案
    const commonPatterns = [
      { name: 'name', reason: '名前を表す汎用的な変数', confidence: 0.8 },
      { name: 'title', reason: 'タイトルを表す変数', confidence: 0.7 },
      { name: 'description', reason: '説明を表す変数', confidence: 0.7 },
      { name: 'date', reason: '日付を表す変数', confidence: 0.6 },
      { name: 'author', reason: '作成者を表す変数', confidence: 0.6 },
    ];

    // コンテキストに基づいて提案を調整
    const contextLower = context.toLowerCase();
    commonPatterns.forEach(pattern => {
      if (contextLower.includes(pattern.name)) {
        suggestions.push({
          ...pattern,
          confidence: Math.min(pattern.confidence + 0.2, 1.0),
          suggestedType: this.inferVariableTypeFromName(pattern.name),
        });
      }
    });

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  // === ユーティリティメソッド ===

  /**
   * 変数の説明を自動生成
   */
  private generateVariableDescription(variableName: string): string {
    const name = variableName.toLowerCase();
    
    if (name.includes('name')) return '名前を入力してください';
    if (name.includes('title')) return 'タイトルを入力してください';
    if (name.includes('description')) return '説明を入力してください';
    if (name.includes('date')) return '日付を入力してください（YYYY-MM-DD形式）';
    if (name.includes('email')) return 'メールアドレスを入力してください';
    if (name.includes('url')) return 'URLを入力してください';
    if (name.includes('file') || name.includes('path')) return 'ファイルパスを入力してください';
    if (name.includes('number') || name.includes('count')) return '数値を入力してください';
    
    return `${variableName}の値を入力してください`;
  }

  /**
   * 変数の型を推測
   */
  private inferVariableType(variableName: string, defaultValue?: string): VariableType {
    if (defaultValue) {
      return this.inferVariableTypeFromValue(defaultValue);
    }
    return this.inferVariableTypeFromName(variableName);
  }

  /**
   * 変数名から型を推測
   */
  private inferVariableTypeFromName(variableName: string): VariableType {
    const name = variableName.toLowerCase();
    
    if (name.includes('email')) return VariableType.EMAIL;
    if (name.includes('url') || name.includes('link')) return VariableType.URL;
    if (name.includes('date') || name.includes('time')) return VariableType.DATE;
    if (name.includes('file') || name.includes('path')) return VariableType.FILE_PATH;
    if (name.includes('number') || name.includes('count') || name.includes('age')) return VariableType.NUMBER;
    if (name.includes('is') || name.includes('has') || name.includes('enable')) return VariableType.BOOLEAN;
    
    return VariableType.STRING;
  }

  /**
   * 値から型を推測
   */
  private inferVariableTypeFromValue(value: string): VariableType {
    // メールアドレスパターン
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return VariableType.EMAIL;
    }
    
    // URLパターン
    if (/^https?:\/\//.test(value)) {
      return VariableType.URL;
    }
    
    // 日付パターン
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      return VariableType.DATE;
    }
    
    // 数値パターン
    if (/^\d+(\.\d+)?$/.test(value)) {
      return VariableType.NUMBER;
    }
    
    // 真偽値パターン
    if (/^(true|false|はい|いいえ|yes|no)$/i.test(value)) {
      return VariableType.BOOLEAN;
    }
    
    return VariableType.STRING;
  }

  // === データ管理 ===

  /**
   * プロンプト管理データを取得
   */
  public getPromptManagement(promptId: string): PromptVariableManagement | null {
    const promptManagements = this.storage.getAllPromptManagements();
    return promptManagements.find(pm => pm.promptId === promptId) || null;
  }

  /**
   * すべてのプロンプト管理データを取得
   */
  public getAllPromptManagements(): PromptVariableManagement[] {
    return this.storage.getAllPromptManagements();
  }

  /**
   * データをエクスポート
   */
  exportData(options: ImportExportOptions): string {
    return this.storage.exportData(options);
  }

  /**
   * データをインポート
   */
  importData(data: string, options: ImportExportOptions): boolean {
    return this.storage.importData(data, options);
  }

  /**
   * すべてのデータをクリア
   */
  clearAllData(): void {
    this.storage.clearAllData();
  }

  /**
   * ストレージサイズを取得
   */
  getStorageSize(): { total: number; byType: Record<string, number> } {
    return this.storage.getStorageSize();
  }
} 