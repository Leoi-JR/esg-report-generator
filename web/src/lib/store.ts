import { create } from 'zustand';
import { Editor } from '@tiptap/react';
import { ChapterResult, DraftResults, ChunkRecord, TreeNode, SourceWithText, EditorMode, ChapterEditData } from './types';
import { parseChapterPath } from './utils';

interface EditorStore {
  // Data
  draftResults: DraftResults | null;
  chunksCache: Map<string, ChunkRecord>;
  chapterEdits: Map<string, ChapterEditData>;  // P1: edits from SQLite

  // Navigation state
  selectedChapterId: string | null;
  searchQuery: string;
  statusFilter: 'all' | 'generated' | 'skipped' | 'reviewed';
  expandedNodes: Set<string>;

  // Computed
  treeData: TreeNode[];
  currentChapter: ChapterResult | null;
  currentSources: SourceWithText[];

  // P1: Editor state
  editorMode: EditorMode;
  tiptapEditor: Editor | null;
  saveStatus: 'idle' | 'saving' | 'saved';
  selectedText: string;        // live editor selection (may be empty)
  aiSelectedText: string;      // snapshot for AI panel (persists until panel closed)
  selectedSourceIds: Set<string>;
  showAIPanel: boolean;
  showVersionHistory: boolean;

  // Actions
  setDraftResults: (data: DraftResults) => void;
  setChunksCache: (chunks: ChunkRecord[]) => void;
  setChapterEdits: (edits: ChapterEditData[]) => void;
  selectChapter: (id: string) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: 'all' | 'generated' | 'skipped' | 'reviewed') => void;
  toggleNode: (nodeId: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  updateChapterContent: (chapterId: string, content: string) => void;
  highlightSource: (sourceId: string) => void;
  highlightedSourceId: string | null;

  // P1: Actions
  setEditorMode: (mode: EditorMode) => void;
  setTiptapEditor: (editor: Editor | null) => void;
  setSaveStatus: (status: 'idle' | 'saving' | 'saved') => void;
  setSelectedText: (text: string) => void;
  toggleSourceSelection: (sourceId: string) => void;
  setShowAIPanel: (show: boolean) => void;
  setShowVersionHistory: (show: boolean) => void;
  updateChapterStatus: (chapterId: string, status: string) => void;

  // Loading state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Project context (multi-enterprise support)
  activeProject: string | undefined;
  setActiveProject: (project: string | undefined) => void;

  // Pipeline integration
  pipelineRunCompleted: boolean;
  setPipelineRunCompleted: (v: boolean) => void;
  refreshDraftData: (clearEdits?: boolean) => Promise<void>;

  // Single-chapter regeneration
  isRegenerating: boolean;
  regenerateChapter: (chapterId: string) => Promise<void>;
}

function buildTreeFromResults(results: ChapterResult[]): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  results.forEach((result, index) => {
    const pathParts = parseChapterPath(result.full_path);
    let currentLevel = root;
    let currentPath = '';

    pathParts.forEach((part, partIndex) => {
      currentPath = currentPath ? `${currentPath} > ${part}` : part;
      const isLeaf = partIndex === pathParts.length - 1;

      let existingNode = nodeMap.get(currentPath);

      if (!existingNode) {
        existingNode = {
          id: isLeaf ? result.id : `folder-${currentPath}`,
          label: part,
          fullPath: currentPath,
          isLeaf,
          children: [],
          ...(isLeaf && {
            status: result.status,
            skipReason: result.skip_reason,
            chapterIndex: index,
          }),
        };
        nodeMap.set(currentPath, existingNode);
        currentLevel.push(existingNode);
      }

      currentLevel = existingNode.children;
    });
  });

  return root;
}

/**
 * 从 chunks 缓存中获取来源的完整文本
 *
 * 优先级（Phase 1-3 优化后）：
 * 1. table_summary - 表格 chunk 使用 LLM 生成的摘要（更易读）
 * 2. text - 普通文本或表格的原始 Markdown
 * 3. '[原文未找到]' - 未匹配到 chunk
 */
function getSourcesWithText(
  chapter: ChapterResult | null,
  chunksCache: Map<string, ChunkRecord>
): SourceWithText[] {
  if (!chapter?.draft?.sources_mapping) return [];

  const sources: SourceWithText[] = [];
  const citedSources = new Set(chapter.draft.cited_sources);

  Object.entries(chapter.draft.sources_mapping).forEach(([id, mapping]) => {
    const chunk = chunksCache.get(mapping.chunk_id);
    // 表格优先使用 table_summary（更简洁易读）
    const displayText = chunk?.table_summary || chunk?.text || '[原文未找到]';
    sources.push({
      ...mapping,
      id,
      text: displayText,
      is_cited: citedSources.has(id),
      is_table: chunk?.is_table || false,
    });
  });

  return sources.sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Merge draft results with SQLite edits.
 * If a chapter has an edit in SQLite, use the edited content.
 */
function mergeWithEdits(chapter: ChapterResult, edits: Map<string, ChapterEditData>): ChapterResult {
  const edit = edits.get(chapter.id);
  if (!edit || !edit.content) return chapter;

  return {
    ...chapter,
    status: (edit.status || chapter.status) as ChapterResult['status'],
    draft: chapter.draft ? {
      ...chapter.draft,
      content: edit.content,
      word_count: edit.word_count || chapter.draft.word_count,
    } : chapter.draft,
  };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  // Initial state
  draftResults: null,
  chunksCache: new Map(),
  chapterEdits: new Map(),
  selectedChapterId: null,
  searchQuery: '',
  statusFilter: 'all',
  expandedNodes: new Set(),
  treeData: [],
  currentChapter: null,
  currentSources: [],
  highlightedSourceId: null,
  isLoading: true,

  // P1 initial state
  editorMode: 'edit',
  tiptapEditor: null,
  saveStatus: 'idle',
  selectedText: '',
  aiSelectedText: '',
  selectedSourceIds: new Set(),
  showAIPanel: false,
  showVersionHistory: false,

  // Actions
  setDraftResults: (data) => {
    const { chapterEdits } = get();
    // Merge edits into results
    const mergedResults = data.results.map(r => mergeWithEdits(r, chapterEdits));
    const mergedData = { ...data, results: mergedResults };
    const treeData = buildTreeFromResults(mergedData.results);
    // Auto-expand first level
    const expandedNodes = new Set<string>();
    treeData.forEach(node => {
      if (!node.isLeaf) {
        expandedNodes.add(node.id);
      }
    });

    set({
      draftResults: mergedData,
      treeData,
      expandedNodes,
    });

    // Select first generated chapter
    const firstGenerated = mergedData.results.find(r => r.status === 'generated');
    if (firstGenerated) {
      get().selectChapter(firstGenerated.id);
    }
  },

  setChunksCache: (chunks) => {
    const cache = new Map<string, ChunkRecord>();
    chunks.forEach(chunk => {
      cache.set(chunk.chunk_id, chunk);
    });
    set({ chunksCache: cache });

    // Update current sources if chapter is selected
    const { currentChapter } = get();
    if (currentChapter) {
      const sources = getSourcesWithText(currentChapter, cache);
      set({ currentSources: sources });
    }
  },

  setChapterEdits: (edits) => {
    const editsMap = new Map<string, ChapterEditData>();
    edits.forEach(e => editsMap.set(e.id, e));
    set({ chapterEdits: editsMap });
  },

  selectChapter: (id) => {
    const { draftResults, chunksCache, chapterEdits } = get();
    if (!draftResults) return;

    let chapter = draftResults.results.find(r => r.id === id) || null;
    if (chapter) {
      chapter = mergeWithEdits(chapter, chapterEdits);
    }
    const sources = getSourcesWithText(chapter, chunksCache);

    // Default selected sources to cited sources
    const selectedSourceIds = new Set<string>();
    sources.forEach(s => {
      if (s.is_cited) selectedSourceIds.add(s.id);
    });

    set({
      selectedChapterId: id,
      currentChapter: chapter,
      currentSources: sources,
      highlightedSourceId: null,
      selectedText: '',
      aiSelectedText: '',
      showAIPanel: false,
      selectedSourceIds,
    });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setStatusFilter: (filter) => set({ statusFilter: filter }),

  toggleNode: (nodeId) => {
    const { expandedNodes } = get();
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    set({ expandedNodes: newExpanded });
  },

  expandAll: () => {
    const { treeData } = get();
    const allNodes = new Set<string>();

    const collectNodes = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (!node.isLeaf) {
          allNodes.add(node.id);
          collectNodes(node.children);
        }
      });
    };

    collectNodes(treeData);
    set({ expandedNodes: allNodes });
  },

  collapseAll: () => set({ expandedNodes: new Set() }),

  updateChapterContent: (chapterId, content) => {
    const { draftResults, chapterEdits } = get();
    if (!draftResults) return;

    // Update the in-memory edits
    const newEdits = new Map(chapterEdits);
    newEdits.set(chapterId, {
      id: chapterId,
      content,
      word_count: content.length,
      status: 'generated',
      updated_at: new Date().toISOString(),
    });

    const newResults = draftResults.results.map(r => {
      if (r.id === chapterId && r.draft) {
        return {
          ...r,
          draft: {
            ...r.draft,
            content,
            word_count: content.length,
          },
        };
      }
      return r;
    });

    set({
      draftResults: {
        ...draftResults,
        results: newResults,
      },
      currentChapter: newResults.find(r => r.id === chapterId) || null,
      chapterEdits: newEdits,
    });
  },

  highlightSource: (sourceId) => set({ highlightedSourceId: sourceId }),

  // P1 Actions
  setEditorMode: (mode) => set({ editorMode: mode }),
  setTiptapEditor: (editor) => set({ tiptapEditor: editor }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setSelectedText: (text) => {
    set({ selectedText: text });
    // When user selects text, snapshot it for AI and auto-show panel
    if (text) {
      set({ aiSelectedText: text, showAIPanel: true });
    }
    // When selection is cleared, do NOT close the panel or clear aiSelectedText
    // The panel persists with the last-selected text until explicitly closed
  },

  toggleSourceSelection: (sourceId) => {
    const { selectedSourceIds } = get();
    const newIds = new Set(selectedSourceIds);
    if (newIds.has(sourceId)) {
      newIds.delete(sourceId);
    } else {
      newIds.add(sourceId);
    }
    set({ selectedSourceIds: newIds });
  },

  setShowAIPanel: (show) => {
    if (!show) {
      // Closing the panel — clear the AI-snapshot text
      set({ showAIPanel: false, aiSelectedText: '' });
    } else {
      set({ showAIPanel: true });
    }
  },
  setShowVersionHistory: (show) => set({ showVersionHistory: show }),

  updateChapterStatus: (chapterId, status) => {
    const { draftResults, chapterEdits } = get();
    if (!draftResults) return;

    // Update edits map
    const newEdits = new Map(chapterEdits);
    const existing = newEdits.get(chapterId);
    if (existing) {
      newEdits.set(chapterId, { ...existing, status });
    } else {
      newEdits.set(chapterId, {
        id: chapterId,
        content: '',
        word_count: 0,
        status,
        updated_at: new Date().toISOString(),
      });
    }

    // Update results
    const newResults = draftResults.results.map(r => {
      if (r.id === chapterId) {
        return { ...r, status: status as ChapterResult['status'] };
      }
      return r;
    });

    const treeData = buildTreeFromResults(newResults);

    set({
      draftResults: { ...draftResults, results: newResults },
      chapterEdits: newEdits,
      treeData,
      currentChapter: newResults.find(r => r.id === chapterId) || get().currentChapter,
    });
  },

  setIsLoading: (loading) => set({ isLoading: loading }),

  // Project context
  activeProject: undefined,
  setActiveProject: (project) => set({ activeProject: project }),

  // Pipeline integration
  pipelineRunCompleted: false,
  setPipelineRunCompleted: (v) => set({ pipelineRunCompleted: v }),
  refreshDraftData: async (clearEdits = false) => {
    try {
      const { activeProject } = get();
      const qs = activeProject ? `?project=${encodeURIComponent(activeProject)}` : '';

      // 如果用户选择清除编辑，先调 API 清除 SQLite，再清空内存
      if (clearEdits) {
        await fetch(`/api/chapters/_all${qs}`, { method: 'DELETE' });
        set({ chapterEdits: new Map() });
      }

      const [draftRes, chunksRes] = await Promise.all([
        fetch(`/api/data/draft${qs}`),
        fetch(`/api/data/chunks${qs}`),
      ]);

      // 必须先设 chunks，再设 draft。
      // 因为 setDraftResults 内部会调 selectChapter → getSourcesWithText，
      // 需要 chunksCache 已经是最新的，否则所有来源都会显示 [原文未找到]。
      if (chunksRes.ok) {
        const chunksData = await chunksRes.json();
        // API 返回直接的 ChunkRecord[]（与 editor/page.tsx 初始化一致）
        const allChunks: ChunkRecord[] = Array.isArray(chunksData) ? chunksData : (chunksData.chunks ?? []);
        get().setChunksCache(allChunks);
      }
      if (draftRes.ok) {
        const draftData = await draftRes.json();
        get().setDraftResults(draftData);
      }
      set({ pipelineRunCompleted: false });
    } catch (err) {
      console.error('Failed to refresh draft data:', err);
    }
  },

  // Single-chapter regeneration
  isRegenerating: false,
  regenerateChapter: async (chapterId: string) => {
    const { activeProject, draftResults } = get();
    set({ isRegenerating: true });
    try {
      const res = await fetch(`/api/chapters/${encodeURIComponent(chapterId)}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: activeProject }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const { chapter } = data as { chapter: ChapterResult };
      // 更新内存中的 draftResults（不写 chapter_edits，保留为 AI 生成状态）
      if (draftResults) {
        set({
          draftResults: {
            ...draftResults,
            results: draftResults.results.map(r =>
              r.id === chapterId ? { ...r, ...chapter } : r
            ),
          },
        });
      }
    } finally {
      set({ isRegenerating: false });
    }
  },
}));
