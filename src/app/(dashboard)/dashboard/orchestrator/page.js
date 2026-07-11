/**
 * Dashboard: Orchestrator v4 — Complete ModelRouter Settings + Simulation + Usage Stats
 *
 * Полное управление ModelRouter:
 * - Switching (ротация, cooldown, preferFree, time-based rules)
 * - RouterAI (управление бесплатными моделями, Ollama)
 * - Rate Limiting (глобальные и per-model лимиты)
 * - Scheduling (пиковые часы, выходные, стратегии)
 * - Monitoring (логирование, алерты, пороги стоимости)
 * - Model Groups (модели, стратегии, лимиты, fallback)
 * - Симуляция выбора модели (round-robin, priority, cost-optimized, conditional)
 * - Статистика использования (стоимость, токены, запросы, ошибки)
 * - Health check моделей
 * - История ротаций
 * - Ссылка на страницу usage для детальной статистики
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ============================================================
   Иконки inline SVG
   ============================================================ */
const Icons = {
  Hub: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/>
      <line x1="9" y1="9" x2="9" y2="15"/><line x1="15" y1="9" x2="12" y2="12"/><line x1="12" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Check: () => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>),
  X: () => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Refresh: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>),
  Route: () => (<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="5" y1="5" x2="12" y2="12"/><line x1="12" y1="12" x2="19" y2="19"/></svg>),
  Settings: () => (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  Activity: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>),
  AlertTriangle: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>),
  Clock: () => (<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  Trash: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>),
  Heart: () => (<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>),
  BarChart: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>),
  List: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>),
  Zap: () => (<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>),
  Play: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>),
  StopCircle: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>),
  Download: () => (<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>),
  ExternalLink: () => (<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>),
  Free: () => (<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4m0 12v4M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>),
};

/* ============================================================
   Константы
   ============================================================ */
const STRATEGIES = [
  { value: 'round_robin', label: 'Round Robin', desc: 'Модели перебираются по кругу — равномерная нагрузка' },
  { value: 'priority', label: 'Priority', desc: 'Приоритет: сначала качественные, потом дешёвые' },
  { value: 'cost_optimized', label: 'Cost-Optimized', desc: 'Сначала самые дешёвые модели — экономия' },
  { value: 'conditional', label: 'Conditional', desc: 'Умный выбор: сложность, контекст, бюджет, время' }
];

const TASK_GROUPS = ['chat', 'code', 'vision', 'code_review', 'web_search', 'embeddings'];

const GROUP_LABELS = {
  chat: 'Чат / Диалог',
  code: 'Код / Программирование',
  vision: 'Зрение / Изображения',
  code_review: 'Ревью кода',
  web_search: 'Поиск',
  embeddings: 'Эмбеддинги'
};

const GROUP_COLORS = {
  chat: 'from-blue-500/20 to-cyan-500/20 text-blue-400',
  code: 'from-green-500/20 to-emerald-500/20 text-green-400',
  vision: 'from-purple-500/20 to-pink-500/20 text-purple-400',
  code_review: 'from-yellow-500/20 to-amber-500/20 text-yellow-400',
  web_search: 'from-orange-500/20 to-red-500/20 text-orange-400',
  embeddings: 'from-indigo-500/20 to-violet-500/20 text-indigo-400'
};

const PROVIDERS = ['routerai', 'openai', 'anthropic', 'google', 'ollama', 'deepseek', 'mistral', 'groq'];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

export default function OrchestratorPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const editingRef = useRef({});
  const [saveMessage, setSaveMessage] = useState('');
  const [saveMsgType, setSaveMsgType] = useState('success');

  // Вкладки
  const [activeTab, setActiveTab] = useState('overview');

  // Переключение секций (collapsible)
  const [expandedSections, setExpandedSections] = useState({
    stats: true, switching: true, routerAI: true,
    rateLimiting: true, scheduling: true, monitoring: true,
    groups: { chat: true, code: false, vision: false, code_review: false, web_search: false, embeddings: false }
  });

  // Редактирование форм
  const [editingSwitching, setEditingSwitching] = useState(false);
  const [switchingForm, setSwitchingForm] = useState({});
  const [editingRouterAI, setEditingRouterAI] = useState(false);
  const [routerAIForm, setRouterAIForm] = useState({});
  const [editingRateLimiting, setEditingRateLimiting] = useState(false);
  const [rateLimitingForm, setRateLimitingForm] = useState({});
  const [editingScheduling, setEditingScheduling] = useState(false);
  const [schedulingForm, setSchedulingForm] = useState({});
  const [editingMonitoring, setEditingMonitoring] = useState(false);
  const [monitoringForm, setMonitoringForm] = useState({});
  const [editingTimeRules, setEditingTimeRules] = useState(false);
  const [timeRulesForm, setTimeRulesForm] = useState([]);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({});
  const [editingModelInGroup, setEditingModelInGroup] = useState(null);
  const [modelForm, setModelForm] = useState({});

  // Симуляция
  const [simParams, setSimParams] = useState({ taskType: 'chat', count: 10, markUsage: false, priority: 1, estimatedTokens: 1000 });
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simError, setSimError] = useState(null);

  // Рулетка (самодиагностика моделей)
  const [rouletteResult, setRouletteResult] = useState(null);
  const [rouletteLoading, setRouletteLoading] = useState(false);
  const [rouletteError, setRouletteError] = useState(null);

  // Прозвон всех провайдеров
  const [pingResults, setPingResults] = useState(null);
  const [pingLoading, setPingLoading] = useState(false);
  const [pingError, setPingError] = useState(null);
  const [autoConfigResult, setAutoConfigResult] = useState(null);
  const [autoConfigLoading, setAutoConfigLoading] = useState(false);

  // Сканер моделей (AI-бенчмарки)
  const [scanResults, setScanResults] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);

  // Ссылка на страницу usage
  const [usageLinkCopied, setUsageLinkCopied] = useState(false);

  // Автоматический дискавер (background scanner)
  const [discoveryStatus, setDiscoveryStatus] = useState(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [cacheResult, setCacheResult] = useState(null);
  const [cacheLoading, setCacheLoading] = useState(false);

  // Очистка битых моделей
  const [cleanupResult, setCleanupResult] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const toggleSection = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleGroup = (key) => setExpandedSections(prev => ({ ...prev, groups: { ...prev.groups, [key]: !prev.groups?.[key] } }));

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/orchestrator');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      if (data.lastPingResults) setPingResults(data.lastPingResults);
      if (data.lastScanResults) setScanResults(data.lastScanResults);
      const cfg = data.modelRouter?.config || {};
      // НЕ затираем формы, которые сейчас в режиме редактирования
      if (!editingSwitching) setSwitchingForm(cfg.switching || {});
      if (!editingRouterAI) setRouterAIForm(cfg.routerAI || {
        enabled: true,
        manageFreeModels: true,
        includeOllama: true,
        freeModelTimeout: 90000,
        maxFreeModelsPerGroup: 5,
        freeModelCooldownSeconds: 5,
        autoEnableAfterError: true
      });
      if (!editingRateLimiting) setRateLimitingForm(cfg.rateLimiting || {});
      if (!editingScheduling) setSchedulingForm(cfg.scheduling || {});
      if (!editingMonitoring) setMonitoringForm(cfg.monitoring || {});
      if (!editingTimeRules) setTimeRulesForm(cfg.switching?.timeBasedRules || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [editingSwitching, editingRouterAI, editingRateLimiting, editingScheduling,
      editingMonitoring, editingTimeRules]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  /* --- Сохранение настроек --- */
  const saveSettings = async (payload, successMsg) => {
    setSaveMessage('');
    try {
      const res = await fetch('/api/orchestrator', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaveMessage(`✅ ${successMsg}`);
      setSaveMsgType('success');
      setTimeout(fetchStatus, 200);
    } catch (err) {
      setSaveMessage(`❌ ${err.message}`);
      setSaveMsgType('error');
    }
  };

  const handleSaveSwitching = (e) => {
    e.preventDefault();
    saveSettings(switchingForm, 'Настройки Switching сохранены');
    setEditingSwitching(false);
  };

  const handleSaveRouterAI = (e) => {
    e.preventDefault();
    // Optimistic update: сразу фиксируем значения в форме, не дожидаясь ответа сервера
    const formValues = { ...routerAIForm };
    // Гарантируем, что timeout — число, не NaN
    if (typeof formValues.freeModelTimeout !== 'number' || isNaN(formValues.freeModelTimeout)) {
      formValues.freeModelTimeout = 90000;
    }
    saveSettings(formValues, 'Настройки RouterAI сохранены');
    // Не сбрасываем editingRouterAI немедленно — даём серверу время ответить
    // fetchStatus обновится через 200мс и уже подхватит сохранённые значения
    // Но защитимся от затирания: ставим флаг после получения ответа
    setTimeout(() => setEditingRouterAI(false), 300);
  };

  const handleSaveRateLimiting = (e) => {
    e.preventDefault();
    saveSettings(rateLimitingForm, 'Настройки Rate Limiting сохранены');
    setEditingRateLimiting(false);
  };

  const handleSaveScheduling = (e) => {
    e.preventDefault();
    saveSettings(schedulingForm, 'Настройки Scheduling сохранены');
    setEditingScheduling(false);
  };

  const handleSaveMonitoring = (e) => {
    e.preventDefault();
    saveSettings(monitoringForm, 'Настройки Monitoring сохранены');
    setEditingMonitoring(false);
  };

  const handleSaveTimeRules = (e) => {
    e.preventDefault();
    saveSettings({ timeBasedRules: timeRulesForm }, 'Time-based rules сохранены');
    setEditingTimeRules(false);
  };

  const handleSaveGroup = (e) => {
    e.preventDefault();
    if (!editingGroup) return;
    saveSettings({ modelGroupUpdates: { [editingGroup]: groupForm } }, `Группа "${GROUP_LABELS[editingGroup] || editingGroup}" обновлена`);
    setEditingGroup(null);
  };

  const handleResetStats = async () => {
    if (!confirm('Сбросить всю статистику ModelRouter?')) return;
    saveSettings({ resetStats: true }, 'Статистика сброшена');
  };

  const handleSimulate = async () => {
    setSimLoading(true);
    setSimResult(null);
    setSimError(null);
    try {
      const res = await fetch('/api/orchestrator/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskType: simParams.taskType,
          count: simParams.count,
          markUsage: simParams.markUsage,
          options: {
            priority: simParams.priority,
            estimatedTokens: simParams.estimatedTokens
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSimResult(data);
      setTimeout(fetchStatus, 500);
    } catch (err) {
      setSimError(err.message);
    } finally {
      setSimLoading(false);
    }
  };

  const copyUsageLink = () => {
    navigator.clipboard?.writeText('/dashboard/usage?tab=details').then(() => {
      setUsageLinkCopied(true);
      setTimeout(() => setUsageLinkCopied(false), 2000);
    });
  };

  /* --- Рулетка --- */
  const handleRoulette = async () => {
    if (rouletteLoading) return;
    setRouletteLoading(true);
    setRouletteResult(null);
    setRouletteError(null);
    try {
      const res = await fetch('/api/orchestrator/roulette', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRouletteResult(data);
      setTimeout(fetchStatus, 500);
    } catch (err) {
      setRouletteError(err.message);
    } finally {
      setRouletteLoading(false);
    }
  };

  /* --- Прозвон всех провайдеров --- */
  const handlePingAll = async () => {
    setPingLoading(true);
    setPingError(null);
    setAutoConfigResult(null);
    try {
      const res = await fetch('/api/orchestrator/ping-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPingResults(data);
    } catch (err) {
      setPingError(err.message);
    } finally {
      setPingLoading(false);
    }
  };

  /* --- Автонастройка --- */
  const handleAutoConfig = async () => {
    if (!pingResults?.workingModels?.length) return;
    setAutoConfigLoading(true);
    try {
      const res = await fetch('/api/orchestrator/auto-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingModels: pingResults.workingModels })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAutoConfigResult(data);
      setSaveMessage('✅ Оркестратор автонастроен по результатам теста');
      setSaveMsgType('success');
      setTimeout(fetchStatus, 500);
    } catch (err) {
      setSaveMessage('❌ ' + err.message);
      setSaveMsgType('error');
    } finally {
      setAutoConfigLoading(false);
    }
  };

  /* --- Сканер моделей (AI-бенчмарки) --- */
  const handleScan = async () => {
    if (scanLoading) return;
    setScanLoading(true);
    setScanResults(null);
    setScanError(null);
    try {
      const res = await fetch('/api/orchestrator/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setScanResults(data);
      setSaveMessage('✅ Сканер завершён — ModelRouter настроен по результатам');
      setSaveMsgType('success');
      setTimeout(fetchStatus, 500);
    } catch (err) {
      setScanError(err.message);
    } finally {
      setScanLoading(false);
    }
  };

  /* --- Автоматический дискавер (фоновое сканирование) --- */
  const handleDiscoveryAction = async (action) => {
    setDiscoveryLoading(true);
    if (action !== 'status') setDiscoveryStatus(null);
    try {
      const res = await fetch('/api/orchestrator/background-scanner', {
        method: action === 'status' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'status' ? undefined : JSON.stringify({ action })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDiscoveryStatus(data);
      if (action === 'stop' || action === 'start' || action === 'status') {
        setSaveMessage(`✅ ${action === 'start' ? 'Автодискавер запущен' : action === 'stop' ? 'Автодискавер остановлен' : 'Статус получен'}`);
        setSaveMsgType('success');
        setTimeout(fetchStatus, 300);
      }
    } catch (err) {
      if (action === 'start' || action === 'stop') {
        setSaveMessage(`❌ ${err.message}`);
        setSaveMsgType('error');
      }
    } finally {
      setDiscoveryLoading(false);
    }
  };

  /* --- Очистка битых моделей --- */
  const handleCleanupBroken = async () => {
    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/orchestrator/cleanup-broken', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCleanupResult(data);
      setSaveMessage(`✅ Отключено ${data.disabled.length} битых моделей`);
      setSaveMsgType('success');
      setTimeout(fetchStatus, 500);
    } catch (err) {
      setSaveMessage(`❌ ${err.message}`);
      setSaveMsgType('error');
    } finally {
      setCleanupLoading(false);
    }
  };

  /* --- Кэш сканера --- */
  const handleCheckCache = async () => {
    setCacheLoading(true);
    setCacheResult(null);
    try {
      const res = await fetch('/api/orchestrator/scan');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCacheResult(data);
    } catch (err) {
      setSaveMessage(`❌ ${err.message}`);
      setSaveMsgType('error');
    } finally {
      setCacheLoading(false);
    }
  };

  /* --- Утилиты --- */
  const routerConfig = status?.modelRouter?.config || {};
  const routerStats = status?.modelRouter?.stats || {};
  const fmtNum = (n) => new Intl.NumberFormat().format(n || 0);
  const fmtCostShort = (n) => {
    if (!n) return '$0';
    if (n < 0.001) return `$${(n * 1000).toFixed(2)}m`;
    return `$${n.toFixed(4)}`;
  };
  const fmtCostFull = (n) => `$${(n || 0).toFixed(6)}`;
  const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString() : '—';
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleString() : '—';

  // Active time rule
  const getActiveTimeRule = () => {
    const rules = routerConfig.switching?.timeBasedRules;
    if (!rules?.length) return null;
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    for (const rule of rules) {
      if (!rule.from || !rule.to) continue;
      const [fH, fM] = rule.from.split(':').map(Number);
      const [tH, tM] = rule.to.split(':').map(Number);
      const fMin = fH * 60 + fM;
      const tMin = tH * 60 + tM;
      if (fMin <= tMin && curMin >= fMin && curMin <= tMin) return rule;
      if (fMin > tMin && (curMin >= fMin || curMin <= tMin)) return rule;
    }
    return null;
  };

  // Loading / Error
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-main"></div>
      </div>
    );
  }
  if (error && !status) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mb-4"><Icons.X /></div>
        <h2 className="text-xl font-semibold text-text-main mb-2">Orchestrator недоступен</h2>
        <p className="text-text-muted text-sm mb-4">{error}</p>
        <button onClick={fetchStatus} className="px-4 py-2 bg-accent-main text-white rounded-lg hover:bg-accent-hover transition-colors text-sm">Повторить</button>
      </div>
    );
  }

  // Compute model list from config groups (for active models count)
  const allConfiguredModels = Object.values(routerConfig.modelGroups || {}).flatMap(g => g.models || []);
  const modelStats = allConfiguredModels.map(m => ({
    id: m.id,
    available: health[m.id]?.available !== false && !health[m.id]?.inCooldown
  }));
  const history = routerStats.rotationHistory || [];
  const health = routerStats.modelHealth || {};
  const activeTimeRule = getActiveTimeRule();
  const totalCostToday = routerStats.totalCost || 0;
  const totalTokensToday = routerStats.totalTokens || 0;
  const totalRequestsToday = routerStats.totalRequests || 0;

  /* ============================================================
     RENDER: Основная структура
     ============================================================ */
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* Заголовок */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-purple-400">
            <Icons.Hub />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-main">Orchestrator</h1>
            <p className="text-sm text-text-muted">
              Supervisor: <span className="font-mono text-text-main">{status?.supervisorModel || '—'}</span>
              {' · '}Стратегия: <span className="font-mono text-text-main">{routerConfig.strategy || 'round_robin'}</span>
              {activeTimeRule && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px]">
                  <Icons.Clock /> {activeTimeRule.preferFree ? 'FREE' : activeTimeRule.preferCheap ? 'CHEAP' : 'QUALITY'}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${status?.status === 'enabled' ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
            <span className={`size-1.5 rounded-full ${status?.status === 'enabled' ? 'bg-green-400' : 'bg-yellow-400'}`} />
            {status?.status === 'enabled' ? 'Enabled' : 'Disabled'}
          </span>
          {routerStats.hourlyCostAlert && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 text-red-400 text-[10px]">
              <Icons.AlertTriangle /> Cost spike
            </span>
          )}
          <button onClick={fetchStatus} className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-main transition-colors" title="Обновить"><Icons.Refresh /></button>
        </div>
      </div>

      {/* Сообщение об сохранении */}
      {saveMessage && (
        <div className={`px-4 py-2 rounded-lg text-sm font-medium ${saveMsgType === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {saveMessage}
        </div>
      )}

      {/* Вкладки */}
      <div className="flex gap-1 border-b border-border pb-1 overflow-x-auto">
        {[
          { id: 'overview', label: '📊 Обзор', icon: null },
          { id: 'ping', label: '📡 Тест провайдеров', icon: null },
          { id: 'settings', label: '⚙️ Все настройки', icon: null },
          { id: 'simulation', label: '🧪 Симуляция', icon: null },
          { id: 'groups', label: '📦 Группы моделей', icon: null },
          { id: 'history', label: '📜 История ротаций', icon: null },
          { id: 'health', label: '🏆 Рейтинг моделей', icon: null },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-bg-main text-text-main border-b-2 border-accent-main'
                : 'text-text-muted hover:text-text-main hover:bg-bg-hover'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Содержимое вкладок */}
      {activeTab === 'overview' && renderOverviewTab(
        status, routerConfig, routerStats, modelStats, totalCostToday, totalTokensToday,
        totalRequestsToday, activeTimeRule, handleResetStats, copyUsageLink, usageLinkCopied,
        rouletteResult, rouletteLoading, rouletteError, handleRoulette
      )}

      {activeTab === 'settings' && renderSettingsTab(
        routerConfig, switchingForm, setSwitchingForm, editingSwitching, setEditingSwitching, handleSaveSwitching,
        routerAIForm, setRouterAIForm, editingRouterAI, setEditingRouterAI, handleSaveRouterAI,
        rateLimitingForm, setRateLimitingForm, editingRateLimiting, setEditingRateLimiting, handleSaveRateLimiting,
        schedulingForm, setSchedulingForm, editingScheduling, setEditingScheduling, handleSaveScheduling,
        monitoringForm, setMonitoringForm, editingMonitoring, setEditingMonitoring, handleSaveMonitoring,
        timeRulesForm, setTimeRulesForm, editingTimeRules, setEditingTimeRules, handleSaveTimeRules,
        expandedSections, toggleSection, Icons
      )}

      {activeTab === 'simulation' && renderSimulationTab(
        simParams, setSimParams, simLoading, simResult, simError, handleSimulate,
        routerConfig, Icons
      )}

      {activeTab === 'groups' && renderGroupsTab(
        routerConfig, TASK_GROUPS, GROUP_LABELS, GROUP_COLORS, STRATEGIES, PROVIDERS,
        expandedSections, toggleGroup, editingGroup, setEditingGroup, setGroupForm, groupForm, handleSaveGroup,
        editingModelInGroup, setEditingModelInGroup, setModelForm, modelForm, Icons
      )}

      {activeTab === 'history' && renderHistoryTab(history, fmtTime, fmtDate, routerStats, Icons)}

      {activeTab === 'health' && renderHealthTab(health, routerConfig, routerStats, Icons, fmtNum, fmtTime, fmtCostFull)}

      {activeTab === 'ping' && renderPingTab(
        pingResults, pingLoading, pingError, handlePingAll,
        autoConfigResult, autoConfigLoading, handleAutoConfig, Icons,
        scanResults, scanLoading, scanError, handleScan,
        discoveryStatus, discoveryLoading, handleDiscoveryAction,
        cacheResult, cacheLoading, handleCheckCache,
        cleanupResult, cleanupLoading, handleCleanupBroken
      )}

      {/* Быстрый доступ к странице Usage */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-purple-500/5 to-blue-500/5 border border-border">
        <Icons.Activity />
        <span className="text-sm text-text-muted flex-1">
          Детальная статистика использования моделей и графики на странице <strong>Usage</strong>
        </span>
        <a href="/dashboard/usage?tab=details" className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent-main text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors">
          Usage Stats <Icons.ExternalLink />
        </a>
        <button onClick={copyUsageLink} className="px-2 py-1.5 text-xs text-text-muted hover:text-text-main rounded-lg hover:bg-bg-hover transition-colors">
          {usageLinkCopied ? '✓ Скопировано' : 'Копировать ссылку'}
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   Вкладка: Overview (Обзор)
   ================================================================ */
function renderOverviewTab(status, routerConfig, routerStats, modelStats, totalCostToday, totalTokensToday, totalRequestsToday, activeTimeRule, handleResetStats, copyUsageLink, usageLinkCopied, rouletteResult, rouletteLoading, rouletteError, handleRoulette) {
  return (
    <div className="space-y-4">
      {/* Быстрые карточки статистики */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-text-muted text-xs uppercase font-semibold">Запросов сегодня</span>
          <span className="text-2xl font-bold">{Intl.NumberFormat().format(totalRequestsToday)}</span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-text-muted text-xs uppercase font-semibold">Токенов сегодня</span>
          <span className="text-2xl font-bold text-primary">{Intl.NumberFormat().format(totalTokensToday)}</span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-text-muted text-xs uppercase font-semibold">Стоимость сегодня</span>
          <span className="text-2xl font-bold text-warning">${(totalCostToday).toFixed(4)}</span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-text-muted text-xs uppercase font-semibold">Активные модели</span>
          <span className="text-2xl font-bold text-success">{modelStats.filter(m => m.available !== false).length}/{modelStats.length}</span>
        </div>
      </div>

      {/* Текущие лимиты */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
          <h3 className="text-sm font-semibold mb-2">Глобальные лимиты</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Дневной лимит стоимости:</span>
              <span className={routerStats.globalLimitReached ? 'text-red-400 font-bold' : 'text-text-main'}>
                ${(totalCostToday).toFixed(4)} / ${(routerConfig.globalCostLimitPerDay || '—')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Дневной лимит токенов:</span>
              <span className={routerStats.globalLimitReached ? 'text-red-400 font-bold' : 'text-text-main'}>
                {Intl.NumberFormat().format(totalTokensToday)} / {Intl.NumberFormat().format(routerConfig.globalTokenLimitPerDay || 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Почасовая стоимость:</span>
              <span className={routerStats.hourlyCostAlert ? 'text-red-400 font-bold' : 'text-text-main'}>${(routerStats.hourlyCost || 0).toFixed(4)}</span>
            </div>
          </div>
        </div>
        <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
          <h3 className="text-sm font-semibold mb-2">Текущие настройки</h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-text-muted">Стратегия:</span><span className="font-mono">{routerConfig.strategy || 'round_robin'}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Prefer Free Models:</span><span className={routerConfig.switching?.preferFreeModels ? 'text-green-400' : 'text-red-400'}>{routerConfig.switching?.preferFreeModels ? '✅ Да' : '❌ Нет'}</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Ротация (мин):</span><span>{routerConfig.switching?.rotationIntervalMinutes || 10} мин</span></div>
            <div className="flex justify-between"><span className="text-text-muted">Cooldown:</span><span>{routerConfig.switching?.cooldownMinutes || 1} мин</span></div>
            {activeTimeRule && (
              <div className="flex justify-between"><span className="text-text-muted">Активное time-правило:</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
                  {activeTimeRule.preferFree ? '🆓 FREE' : activeTimeRule.preferCheap ? '💰 CHEAP' : '⭐ QUALITY'} ({activeTimeRule.from}-{activeTimeRule.to})
                </span>
              </div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={handleResetStats} className="px-3 py-1.5 text-xs bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors">Сбросить статистику</button>
          </div>
        </div>
      </div>

      {/* Использование моделей */}
      <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Использование моделей сегодня</h3>
          <a href="/dashboard/usage?tab=details" className="text-xs text-accent-main hover:underline">Подробнее →</a>
        </div>
        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {modelStats.length === 0 && (
            <div className="px-4 py-6 text-center text-text-muted text-sm">Нет данных об использовании за сегодня</div>
          )}
          {modelStats.map((m, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-bg-hover transition-colors">
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${m.cost === 0 ? 'bg-green-500/10 text-green-400' : m.cost < 0.001 ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {m.cost === 0 ? 'FREE' : m.cost < 0.001 ? 'CHEAP' : 'PAID'}
              </span>
              <span className="text-sm font-mono flex-1 truncate">{m.model}</span>
              <span className="text-xs text-text-muted w-16 text-right">{Intl.NumberFormat().format(m.requests)} req</span>
              <span className="text-xs text-text-muted w-20 text-right">{Intl.NumberFormat().format(m.tokens)} tok</span>
              <span className="text-xs w-16 text-right">${(m.cost || 0).toFixed(6)}</span>
              <span className={`text-xs w-12 text-right ${m.errors > 0 ? 'text-red-400' : 'text-green-400'}`}>{m.errors > 0 ? `⚠ ${m.errors}` : '✓'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ссылка на Usage */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500/5 to-cyan-500/5 border border-border">
        <Icons.Activity />
        <span className="text-sm text-text-muted flex-1">
          Детальная статистика — <strong>переключение моделей</strong>, стоимость по периодам, графики
        </span>
        <a href="/dashboard/usage?tab=overview" className="inline-flex items-center gap-1 px-3 py-1.5 bg-accent-main text-white rounded-lg text-xs font-medium hover:bg-accent-hover transition-colors">
          Usage Overview <Icons.ExternalLink />
        </a>
      </div>
    </div>
  );
}

/* ================================================================
   Вкладка: Все настройки
   ================================================================ */
function renderSettingsTab(
  routerConfig, switchingForm, setSwitchingForm, editingSwitching, setEditingSwitching, handleSaveSwitching,
  routerAIForm, setRouterAIForm, editingRouterAI, setEditingRouterAI, handleSaveRouterAI,
  rateLimitingForm, setRateLimitingForm, editingRateLimiting, setEditingRateLimiting, handleSaveRateLimiting,
  schedulingForm, setSchedulingForm, editingScheduling, setEditingScheduling, handleSaveScheduling,
  monitoringForm, setMonitoringForm, editingMonitoring, setEditingMonitoring, handleSaveMonitoring,
  timeRulesForm, setTimeRulesForm, editingTimeRules, setEditingTimeRules, handleSaveTimeRules,
  expandedSections, toggleSection, Icons
) {
  return (
    <div className="space-y-3">
      {/* 1. Switching настройки */}
      <SettingCard
        title="🔄 Switching — переключение и ротация моделей"
        sectionKey="switching"
        isExpanded={expandedSections.switching}
        toggle={() => toggleSection('switching')}
        isEditing={editingSwitching}
        onEdit={() => setEditingSwitching(true)}
        onCancel={() => setEditingSwitching(false)}
        formContent={
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleField label="Включено" value={switchingForm.enabled} onChange={(v) => setSwitchingForm(p => ({ ...p, enabled: v }))} />
              <ToggleField label="Prefer Free Models" value={switchingForm.preferFreeModels} onChange={(v) => setSwitchingForm(p => ({ ...p, preferFreeModels: v }))} />
              <ToggleField label="Smart Rotation" value={switchingForm.smartRotation} onChange={(v) => setSwitchingForm(p => ({ ...p, smartRotation: v }))} />
              <ToggleField label="Respect Rate Limits" value={switchingForm.respectRateLimits} onChange={(v) => setSwitchingForm(p => ({ ...p, respectRateLimits: v }))} />
              <NumberField label="Cooldown (мин)" value={switchingForm.cooldownMinutes} onChange={(v) => setSwitchingForm(p => ({ ...p, cooldownMinutes: v }))} min={0} step={0.5} />
              <NumberField label="Ротация каждые N мин" value={switchingForm.rotationIntervalMinutes} onChange={(v) => setSwitchingForm(p => ({ ...p, rotationIntervalMinutes: v }))} min={1} step={1} />
              <NumberField label="Макс. подряд free запросов" value={switchingForm.maxConsecutiveFreeRequests} onChange={(v) => setSwitchingForm(p => ({ ...p, maxConsecutiveFreeRequests: v }))} min={0} step={1} />
              <NumberField label="Мин. разница цены" value={switchingForm.minCostDiff} onChange={(v) => setSwitchingForm(p => ({ ...p, minCostDiff: v }))} min={0} step={0.00001} />
            </div>
            <div className="flex justify-end">
              <button onClick={handleSaveSwitching} className="px-4 py-2 bg-accent-main text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">Сохранить Switching</button>
            </div>
          </div>
        }
        viewContent={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <ViewItem label="Включено" value={routerConfig.switching?.enabled ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Prefer Free" value={routerConfig.switching?.preferFreeModels ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Smart Rotation" value={routerConfig.switching?.smartRotation ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Cooldown" value={`${routerConfig.switching?.cooldownMinutes || 1} мин`} />
            <ViewItem label="Ротация" value={`каждые ${routerConfig.switching?.rotationIntervalMinutes || 10} мин`} />
            <ViewItem label="Max free подряд" value={routerConfig.switching?.maxConsecutiveFreeRequests || 5} />
            <ViewItem label="Respect Rate Limits" value={routerConfig.switching?.respectRateLimits ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Min Cost Diff" value={`$${routerConfig.switching?.minCostDiff || 0.0001}`} />
          </div>
        }
      />

      {/* 2. Time-based Rules */}
      <SettingCard
        title="⏰ Time-Based Rules — правила по времени"
        sectionKey="timeRules"
        isExpanded={expandedSections.switching}
        toggle={() => toggleSection('switching')}
        isEditing={editingTimeRules}
        onEdit={() => setEditingTimeRules(true)}
        onCancel={() => setEditingTimeRules(false)}
        isNested
        formContent={
          <div className="space-y-3">
            {timeRulesForm.map((rule, idx) => (
              <div key={idx} className="p-3 rounded-lg border border-border bg-bg-subtle space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Правило #{idx + 1}</span>
                  <button onClick={() => {
                    const newRules = timeRulesForm.filter((_, i) => i !== idx);
                    setTimeRulesForm(newRules);
                  }} className="text-red-400 hover:text-red-300 text-xs">Удалить</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-text-muted">От (HH:MM)</label>
                    <input type="text" value={rule.from || ''} onChange={(e) => {
                      const newRules = [...timeRulesForm];
                      newRules[idx] = { ...newRules[idx], from: e.target.value };
                      setTimeRulesForm(newRules);
                    }} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" placeholder="08:00" />
                  </div>
                  <div><label className="text-[10px] text-text-muted">До (HH:MM)</label>
                    <input type="text" value={rule.to || ''} onChange={(e) => {
                      const newRules = [...timeRulesForm];
                      newRules[idx] = { ...newRules[idx], to: e.target.value };
                      setTimeRulesForm(newRules);
                    }} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" placeholder="18:00" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!rule.preferFree} onChange={(e) => {
                    const newRules = [...timeRulesForm];
                    newRules[idx] = { ...newRules[idx], preferFree: e.target.checked, preferCheap: false, preferQuality: false };
                    setTimeRulesForm(newRules);
                  }} /> 🆓 Free</label>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!rule.preferCheap} onChange={(e) => {
                    const newRules = [...timeRulesForm];
                    newRules[idx] = { ...newRules[idx], preferCheap: e.target.checked, preferFree: false, preferQuality: false };
                    setTimeRulesForm(newRules);
                  }} /> 💰 Cheap</label>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!rule.preferQuality} onChange={(e) => {
                    const newRules = [...timeRulesForm];
                    newRules[idx] = { ...newRules[idx], preferQuality: e.target.checked, preferFree: false, preferCheap: false };
                    setTimeRulesForm(newRules);
                  }} /> ⭐ Quality</label>
                </div>
                {(rule.preferCheap || !rule.preferFree) && (
                  <div><label className="text-[10px] text-text-muted">Max Cost Per Request ($)</label>
                    <input type="number" step="0.0001" value={rule.maxCostPerRequest || ''} onChange={(e) => {
                      const newRules = [...timeRulesForm];
                      newRules[idx] = { ...newRules[idx], maxCostPerRequest: parseFloat(e.target.value) || 0 };
                      setTimeRulesForm(newRules);
                    }} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" />
                  </div>
                )}
                {rule.preferQuality && (
                  <div><label className="text-[10px] text-text-muted">Min Quality Score</label>
                    <input type="number" step="0.1" min="0" max="1" value={rule.minQualityScore || ''} onChange={(e) => {
                      const newRules = [...timeRulesForm];
                      newRules[idx] = { ...newRules[idx], minQualityScore: parseFloat(e.target.value) || 0 };
                      setTimeRulesForm(newRules);
                    }} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" />
                  </div>
                )}
              </div>
            ))}
            <button onClick={() => setTimeRulesForm([...timeRulesForm, { from: '', to: '', preferFree: false, preferCheap: false, preferQuality: false }])}
              className="px-3 py-1.5 text-xs bg-bg-hover rounded-lg hover:bg-bg-subtle transition-colors">+ Добавить правило</button>
            <div className="flex justify-end">
              <button onClick={handleSaveTimeRules} className="px-4 py-2 bg-accent-main text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">Сохранить Time Rules</button>
            </div>
          </div>
        }
        viewContent={
          <div className="space-y-1.5">
            {(!routerConfig.switching?.timeBasedRules || routerConfig.switching.timeBasedRules.length === 0) && (
              <div className="text-xs text-text-muted">Правила не настроены</div>
            )}
            {routerConfig.switching?.timeBasedRules?.map((rule, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded ${rule.preferFree ? 'bg-green-500/10 text-green-400' : rule.preferCheap ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'}`}>
                  {rule.preferFree ? 'FREE' : rule.preferCheap ? 'CHEAP' : 'QUALITY'}
                </span>
                <span className="font-mono">{rule.from} — {rule.to}</span>
                {rule.maxCostPerRequest && <span className="text-text-muted">max ${rule.maxCostPerRequest}/req</span>}
                {rule.minQualityScore && <span className="text-text-muted">min score {rule.minQualityScore}</span>}
              </div>
            ))}
          </div>
        }
      />

      {/* 3. RouterAI настройки */}
      <SettingCard
        title="🤖 RouterAI — управление бесплатными моделями и Ollama"
        sectionKey="routerAI"
        isExpanded={expandedSections.routerAI}
        toggle={() => toggleSection('routerAI')}
        isEditing={editingRouterAI}
        onEdit={() => setEditingRouterAI(true)}
        onCancel={() => setEditingRouterAI(false)}
        formContent={
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleField label="Включено" value={routerAIForm.enabled} onChange={(v) => setRouterAIForm(p => ({ ...p, enabled: v }))} />
              <ToggleField label="Управлять бесплатными моделями" value={routerAIForm.manageFreeModels} onChange={(v) => setRouterAIForm(p => ({ ...p, manageFreeModels: v }))} />
              <ToggleField label="Включать Ollama" value={routerAIForm.includeOllama} onChange={(v) => setRouterAIForm(p => ({ ...p, includeOllama: v }))} />
              <ToggleField label="Авто-включение после ошибки" value={routerAIForm.autoEnableAfterError} onChange={(v) => setRouterAIForm(p => ({ ...p, autoEnableAfterError: v }))} />
              <NumberField label="Free Model Timeout (ms)" value={routerAIForm.freeModelTimeout} onChange={(v) => setRouterAIForm(p => ({ ...p, freeModelTimeout: v }))} min={1000} step={1000} />
              <NumberField label="Max Free Models per Group" value={routerAIForm.maxFreeModelsPerGroup} onChange={(v) => setRouterAIForm(p => ({ ...p, maxFreeModelsPerGroup: v }))} min={0} step={1} />
              <NumberField label="Free Model Cooldown (сек)" value={routerAIForm.freeModelCooldownSeconds} onChange={(v) => setRouterAIForm(p => ({ ...p, freeModelCooldownSeconds: v }))} min={0} step={1} />
            </div>
            <div className="flex justify-end">
              <button onClick={handleSaveRouterAI} className="px-4 py-2 bg-accent-main text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">Сохранить RouterAI</button>
            </div>
          </div>
        }
        viewContent={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <ViewItem label="Включено" value={routerConfig.routerAI?.enabled ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Manage Free" value={routerConfig.routerAI?.manageFreeModels ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Include Ollama" value={routerConfig.routerAI?.includeOllama ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Auto Enable" value={routerConfig.routerAI?.autoEnableAfterError ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Free Timeout" value={`${routerConfig.routerAI?.freeModelTimeout || 30000}ms`} />
            <ViewItem label="Max Free/Group" value={routerConfig.routerAI?.maxFreeModelsPerGroup || 3} />
            <ViewItem label="Free Cooldown" value={`${routerConfig.routerAI?.freeModelCooldownSeconds || 5}с`} />
          </div>
        }
      />

      {/* 4. Rate Limiting */}
      <SettingCard
        title="🚦 Rate Limiting — ограничение частоты запросов"
        sectionKey="rateLimiting"
        isExpanded={expandedSections.rateLimiting}
        toggle={() => toggleSection('rateLimiting')}
        isEditing={editingRateLimiting}
        onEdit={() => setEditingRateLimiting(true)}
        onCancel={() => setEditingRateLimiting(false)}
        formContent={
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleField label="Включено" value={rateLimitingForm.enabled} onChange={(v) => setRateLimitingForm(p => ({ ...p, enabled: v }))} />
              <NumberField label="Глобальных запросов/мин" value={rateLimitingForm.globalRequestsPerMinute} onChange={(v) => setRateLimitingForm(p => ({ ...p, globalRequestsPerMinute: v }))} min={1} step={5} />
              <NumberField label="Per-Model запросов/мин" value={rateLimitingForm.perModelRequestsPerMinute} onChange={(v) => setRateLimitingForm(p => ({ ...p, perModelRequestsPerMinute: v }))} min={1} step={1} />
              <NumberField label="Burst Limit" value={rateLimitingForm.burstLimit} onChange={(v) => setRateLimitingForm(p => ({ ...p, burstLimit: v }))} min={0} step={1} />
              <NumberField label="Retry After (сек)" value={rateLimitingForm.retryAfterOnLimit} onChange={(v) => setRateLimitingForm(p => ({ ...p, retryAfterOnLimit: v }))} min={0} step={5} />
            </div>
            <div className="flex justify-end">
              <button onClick={handleSaveRateLimiting} className="px-4 py-2 bg-accent-main text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">Сохранить Rate Limiting</button>
            </div>
          </div>
        }
        viewContent={
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <ViewItem label="Включено" value={routerConfig.rateLimiting?.enabled ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Глобальных/мин" value={routerConfig.rateLimiting?.globalRequestsPerMinute || 100} />
            <ViewItem label="Per-Model/мин" value={routerConfig.rateLimiting?.perModelRequestsPerMinute || 30} />
            <ViewItem label="Burst" value={routerConfig.rateLimiting?.burstLimit || 5} />
            <ViewItem label="Retry After" value={`${routerConfig.rateLimiting?.retryAfterOnLimit || 30}с`} />
          </div>
        }
      />

      {/* 5. Scheduling */}
      <SettingCard
        title="📅 Scheduling — планировщик по времени"
        sectionKey="scheduling"
        isExpanded={expandedSections.scheduling}
        toggle={() => toggleSection('scheduling')}
        isEditing={editingScheduling}
        onEdit={() => setEditingScheduling(true)}
        onCancel={() => setEditingScheduling(false)}
        formContent={
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleField label="Включено" value={schedulingForm.enabled} onChange={(v) => setSchedulingForm(p => ({ ...p, enabled: v }))} />
              <div><label className="text-[10px] text-text-muted">Timezone</label>
                <input type="text" value={schedulingForm.timezone || 'auto'} onChange={(e) => setSchedulingForm(p => ({ ...p, timezone: e.target.value }))} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" />
              </div>
              <div><label className="text-[10px] text-text-muted">Peak Hours Start</label>
                <input type="text" value={schedulingForm.peakHours?.start || '09:00'} onChange={(e) => setSchedulingForm(p => ({ ...p, peakHours: { ...p.peakHours, start: e.target.value } }))} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" />
              </div>
              <div><label className="text-[10px] text-text-muted">Peak Hours End</label>
                <input type="text" value={schedulingForm.peakHours?.end || '17:00'} onChange={(e) => setSchedulingForm(p => ({ ...p, peakHours: { ...p.peakHours, end: e.target.value } }))} className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main" />
              </div>
              <NumberField label="Peak Hour Cost Multiplier" value={schedulingForm.peakHourCostMultiplier} onChange={(v) => setSchedulingForm(p => ({ ...p, peakHourCostMultiplier: v }))} min={1} step={0.1} />
              <select value={schedulingForm.offPeakStrategy || 'cost_optimized'} onChange={(e) => setSchedulingForm(p => ({ ...p, offPeakStrategy: e.target.value }))}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main">
                {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <select value={schedulingForm.weekendStrategy || 'round_robin'} onChange={(e) => setSchedulingForm(p => ({ ...p, weekendStrategy: e.target.value }))}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main">
                {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="flex justify-end">
              <button onClick={handleSaveScheduling} className="px-4 py-2 bg-accent-main text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">Сохранить Scheduling</button>
            </div>
          </div>
        }
        viewContent={
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <ViewItem label="Включено" value={routerConfig.scheduling?.enabled ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Timezone" value={routerConfig.scheduling?.timezone || 'auto'} />
            <ViewItem label="Peak Hours" value={`${routerConfig.scheduling?.peakHours?.start || '09:00'} — ${routerConfig.scheduling?.peakHours?.end || '17:00'}`} />
            <ViewItem label="Peak Multiplier" value={routerConfig.scheduling?.peakHourCostMultiplier || 1.5} />
            <ViewItem label="Off-Peak Strategy" value={routerConfig.scheduling?.offPeakStrategy || 'cost_optimized'} />
            <ViewItem label="Weekend Strategy" value={routerConfig.scheduling?.weekendStrategy || 'round_robin'} />
          </div>
        }
      />

      {/* 6. Monitoring */}
      <SettingCard
        title="📊 Monitoring — мониторинг и уведомления"
        sectionKey="monitoring"
        isExpanded={expandedSections.monitoring}
        toggle={() => toggleSection('monitoring')}
        isEditing={editingMonitoring}
        onEdit={() => setEditingMonitoring(true)}
        onCancel={() => setEditingMonitoring(false)}
        formContent={
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleField label="Включено" value={monitoringForm.enabled} onChange={(v) => setMonitoringForm(p => ({ ...p, enabled: v }))} />
              <ToggleField label="Логировать ротации" value={monitoringForm.logRotations} onChange={(v) => setMonitoringForm(p => ({ ...p, logRotations: v }))} />
              <ToggleField label="Логировать ошибки" value={monitoringForm.logErrors} onChange={(v) => setMonitoringForm(p => ({ ...p, logErrors: v }))} />
              <ToggleField label="Alert on Cost Spike" value={monitoringForm.alertOnCostSpike} onChange={(v) => setMonitoringForm(p => ({ ...p, alertOnCostSpike: v }))} />
              <NumberField label="Cost Spike Threshold ($)" value={monitoringForm.costSpikeThreshold} onChange={(v) => setMonitoringForm(p => ({ ...p, costSpikeThreshold: v }))} min={0} step={0.05} />
              <select value={monitoringForm.logLevel || 'info'} onChange={(e) => setMonitoringForm(p => ({ ...p, logLevel: e.target.value }))}
                className="w-full px-2 py-1 text-xs rounded border border-border bg-bg-main">
                {LOG_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="flex justify-end">
              <button onClick={handleSaveMonitoring} className="px-4 py-2 bg-accent-main text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors">Сохранить Monitoring</button>
            </div>
          </div>
        }
        viewContent={
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <ViewItem label="Включено" value={routerConfig.monitoring?.enabled ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Лог ротаций" value={routerConfig.monitoring?.logRotations ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Лог ошибок" value={routerConfig.monitoring?.logErrors ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Alert Cost Spike" value={routerConfig.monitoring?.alertOnCostSpike ? '✅ Да' : '❌ Нет'} />
            <ViewItem label="Cost Spike Threshold" value={`$${routerConfig.monitoring?.costSpikeThreshold || 0.50}`} />
            <ViewItem label="Log Level" value={routerConfig.monitoring?.logLevel || 'info'} />
          </div>
        }
      />

      {/* Глобальные стратегии */}
      <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-bg-card border border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Глобальная стратегия:</span>
          <span className="text-sm font-mono bg-bg-subtle px-2 py-0.5 rounded">{routerConfig.strategy || 'round_robin'}</span>
        </div>
        <a href="/dashboard/usage?tab=details" className="text-xs text-accent-main hover:underline">Usage Stats →</a>
      </div>
    </div>
  );
}

/* ================================================================
   Вкладка: Симуляция
   ================================================================ */
function renderSimulationTab(simParams, setSimParams, simLoading, simResult, simError, handleSimulate, routerConfig, Icons) {
  return (
    <div className="space-y-4">
      {/* Explanation card */}
      <div className="rounded-xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 border border-border p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center size-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-blue-400 shrink-0">
            <Icons.Route />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-main">🧪 Симуляция выбора модели</h3>
            <p className="text-xs text-text-muted mt-1 leading-relaxed">
              Проверяет логику маршрутизатора: как ModelRouter выбирает модель для заданного типа задачи.
              Учитываются стратегии (round-robin, priority, cost-optimized, conditional), приоритеты, cooldown,
              лимиты стоимости и доступность моделей. Результат показывает, какая модель будет выбрана в каждом раунде.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px]">🔄 Round-Robin</span>
              <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px]">⭐ Priority</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px]">💰 Cost-Optimized</span>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 text-[10px]">🧠 Conditional</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Icons.Settings />
          <h3 className="text-sm font-semibold">Параметры симуляции</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label className="text-[10px] text-text-muted">Тип задачи</label>
              <select value={simParams.taskType} onChange={(e) => setSimParams(p => ({ ...p, taskType: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main">
                {['chat', 'code', 'vision', 'code_review', 'web_search', 'embeddings'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Итераций (1-50)</label>
              <input type="number" min="1" max="50" value={simParams.count} onChange={(e) => setSimParams(p => ({ ...p, count: Math.min(50, Math.max(1, parseInt(e.target.value) || 1)) }))}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Приоритет (1-5)</label>
              <input type="number" min="1" max="5" value={simParams.priority} onChange={(e) => setSimParams(p => ({ ...p, priority: parseInt(e.target.value) || 1 }))}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main" />
            </div>
            <div>
              <label className="text-[10px] text-text-muted">Est. Tokens</label>
              <input type="number" min="100" step="100" value={simParams.estimatedTokens} onChange={(e) => setSimParams(p => ({ ...p, estimatedTokens: parseInt(e.target.value) || 100 }))}
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={simParams.markUsage} onChange={(e) => setSimParams(p => ({ ...p, markUsage: e.target.checked }))} />
                Записывать usage
              </label>
            </div>
          </div>
          <button onClick={handleSimulate} disabled={simLoading}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2 ${
              simLoading
                ? 'bg-bg-hover text-text-muted cursor-wait'
                : 'bg-accent-main text-white hover:bg-accent-hover shadow-sm hover:shadow-md active:scale-[0.98]'
            }`}>
            {simLoading ? (
              <><span className="animate-spin size-4 border-2 border-current border-t-transparent rounded-full" /> Симуляция...</>
            ) : (
              <><Icons.Play /> Запустить симуляцию</>
            )}
          </button>
        </div>
      </div>

      {/* Результат симуляции */}
      {simError && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-400 text-sm">{simError}</div>
      )}

      {simResult && (
        <div className="space-y-3">
          {/* Сводка */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
              <span className="text-[10px] text-text-muted uppercase font-semibold">Группа</span>
              <div className="text-lg font-bold">{simResult.taskType}</div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
              <span className="text-[10px] text-text-muted uppercase font-semibold">Стратегия</span>
              <div className="text-lg font-bold">{simResult.config.strategy}</div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
              <span className="text-[10px] text-text-muted uppercase font-semibold">Включено</span>
              <div className="text-lg font-bold">{simResult.config.enabled ? '✅ Да' : '❌ Нет'}</div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
              <span className="text-[10px] text-text-muted uppercase font-semibold">Моделей в группе</span>
              <div className="text-lg font-bold">{simResult.config.modelsCount}</div>
            </div>
          </div>

          {/* Таблица выбора моделей */}
          <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Результаты симуляции ({simResult.iterations} итераций)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-bg-subtle">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Модель</th>
                    <th className="px-3 py-2 text-left">Провайдер</th>
                    <th className="px-3 py-2 text-right">Стоимость/1K</th>
                    <th className="px-3 py-2 text-right">Max Tokens</th>
                    <th className="px-3 py-2 text-left">Цвет</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {simResult.selections.map((s, i) => (
                    <tr key={i} className={`hover:bg-bg-hover transition-colors ${s.error ? 'bg-red-500/5' : ''}`}>
                      <td className="px-3 py-2 font-mono text-text-muted">{s.iteration}</td>
                      <td className="px-3 py-2 font-mono">
                        {s.modelId ? (
                          <span className={`inline-flex items-center gap-1 ${s.costPer1K === 0 ? 'text-green-400' : s.costPer1K < 0.001 ? 'text-blue-400' : 'text-amber-400'}`}>
                            <span className={`size-1.5 rounded-full ${s.costPer1K === 0 ? 'bg-green-400' : s.costPer1K < 0.001 ? 'bg-blue-400' : 'bg-amber-400'}`} />
                            {s.modelId}
                          </span>
                        ) : (
                          <span className="text-red-400">❌ {s.error}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-muted">{s.provider || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.costPer1K !== undefined ? `$${s.costPer1K}` : '—'}</td>
                      <td className="px-3 py-2 text-right">{s.maxTokens || '—'}</td>
                      <td className="px-3 py-2">
                        {s.costPer1K === 0 ? <span className="text-green-400 text-[10px]">🆓 FREE</span> :
                         s.costPer1K < 0.001 ? <span className="text-blue-400 text-[10px]">💰 CHEAP</span> :
                         <span className="text-amber-400 text-[10px]">💵 PAID</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Статистика после симуляции */}
          {simResult.stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
                <span className="text-[10px] text-text-muted">Общая стоимость</span>
                <div className="text-sm font-bold">${(simResult.stats.totalCost || 0).toFixed(6)}</div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
                <span className="text-[10px] text-text-muted">Всего токенов</span>
                <div className="text-sm font-bold">{Intl.NumberFormat().format(simResult.stats.totalTokens || 0)}</div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
                <span className="text-[10px] text-text-muted">Запросов</span>
                <div className="text-sm font-bold">{Intl.NumberFormat().format(simResult.stats.totalRequests || 0)}</div>
              </div>
              <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
                <span className="text-[10px] text-text-muted">Group Cost Limited</span>
                <div className={`text-sm font-bold ${simResult.stats.groupCostLimited ? 'text-red-400' : 'text-green-400'}`}>
                  {simResult.stats.groupCostLimited ? '⚠ Да' : '✅ Нет'}
                </div>
              </div>
            </div>
          )}

          {/* Доступные модели в группе */}
          <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Модели в группе "{simResult.taskType}"</h3>
            </div>
            <div className="divide-y divide-border">
              {simResult.models?.map((m, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-bg-hover transition-colors">
                  <span className={`size-2 rounded-full ${m.costPer1K === 0 ? 'bg-green-400' : m.costPer1K < 0.001 ? 'bg-blue-400' : 'bg-amber-400'}`} />
                  <span className="font-mono flex-1">{m.id}</span>
                  <span className="text-text-muted">{m.provider}</span>
                  <span className="text-text-muted">priority {m.priority}</span>
                  <span className="text-text-muted">${m.costPer1K}/1K</span>
                  <span className="text-text-muted">rate: {m.rateLimit || '∞'}/min</span>
                  {m.cooldownMinutes > 0 && <span className="text-text-muted">cooldown: {m.cooldownMinutes}min</span>}
                  <span className={m.costPer1K === 0 ? 'text-green-400' : 'text-text-muted'}>{m.costPer1K === 0 ? '🆓 FREE' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Вкладка: Группы моделей
   ================================================================ */
function renderGroupsTab(
  routerConfig, TASK_GROUPS, GROUP_LABELS, GROUP_COLORS, STRATEGIES, PROVIDERS,
  expandedSections, toggleGroup, editingGroup, setEditingGroup, setGroupForm, groupForm, handleSaveGroup,
  editingModelInGroup, setEditingModelInGroup, setModelForm, modelForm, Icons
) {
  const groups = routerConfig.modelGroups || {};

  return (
    <div className="space-y-3">
      {TASK_GROUPS.map(groupKey => {
        const g = groups[groupKey] || {};
        const isExpanded = expandedSections.groups?.[groupKey];
        const isEditing = editingGroup === groupKey;

        return (
          <div key={groupKey} className="rounded-xl bg-bg-card border border-border overflow-hidden">
            <button onClick={() => toggleGroup(groupKey)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors">
              <div className={`flex items-center justify-center size-8 rounded-lg bg-gradient-to-br ${GROUP_COLORS[groupKey] || 'from-gray-500/20 to-gray-500/20 text-gray-400'}`}>
                <Icons.BarChart />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-semibold">{GROUP_LABELS[groupKey] || groupKey}</div>
                <div className="text-[10px] text-text-muted">
                  {g.models?.length || 0} моделей · {g.strategy || routerConfig.strategy} · лимит ${g.costLimitPerDay || 0}/день
                </div>
              </div>
              <span className="text-text-muted">{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
              <div className="px-4 pb-4">
                {isEditing ? (
                  <div className="space-y-3 mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] text-text-muted">Стратегия</label>
                        <select value={groupForm.strategy || 'round_robin'} onChange={(e) => setGroupForm(p => ({ ...p, strategy: e.target.value }))}
                          className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main">
                          {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-text-muted">Fallback модель</label>
                        <input type="text" value={groupForm.fallbackModel || ''} onChange={(e) => setGroupForm(p => ({ ...p, fallbackModel: e.target.value }))}
                          className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main font-mono" placeholder="model-id" />
                      </div>
                      <TinyToggleField label="Включено" value={groupForm.enabled} onChange={(v) => setGroupForm(p => ({ ...p, enabled: v }))} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-text-muted">Дневной лимит стоимости ($)</label>
                        <input type="number" step="0.01" min="0" value={groupForm.costLimitPerDay || ''} onChange={(e) => setGroupForm(p => ({ ...p, costLimitPerDay: parseFloat(e.target.value) || 0 }))}
                          className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main" />
                      </div>
                      <div>
                        <label className="text-[10px] text-text-muted">Дневной лимит токенов</label>
                        <input type="number" step="1000" min="0" value={groupForm.tokenLimitPerDay || ''} onChange={(e) => setGroupForm(p => ({ ...p, tokenLimitPerDay: parseInt(e.target.value) || 0 }))}
                          className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main" />
                      </div>
                    </div>

                    {/* Редактирование моделей внутри группы */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold">Модели ({groupForm.models?.length || 0})</span>
                        <button onClick={() => {
                          const models = [...(groupForm.models || [])];
                          models.push({ id: '', provider: 'routerai', priority: models.length + 1, costPer1K: 0, maxTokens: 8000, rateLimit: 30, cooldownMinutes: 0 });
                          setGroupForm(p => ({ ...p, models }));
                        }} className="px-2 py-1 text-[10px] bg-bg-hover rounded hover:bg-bg-subtle transition-colors">+ Модель</button>
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {(groupForm.models || []).map((mdl, idx) => (
                          <div key={idx} className="p-2 rounded-lg border border-border bg-bg-subtle space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold text-text-muted">Модель #{idx + 1}</span>
                              <button onClick={() => {
                                const models = groupForm.models.filter((_, i) => i !== idx);
                                setGroupForm(p => ({ ...p, models }));
                              }} className="text-[10px] text-red-400 hover:text-red-300">Удалить</button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                              <div><label className="text-[9px] text-text-muted">ID</label>
                                <input type="text" value={mdl.id} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], id: e.target.value };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main font-mono" /></div>
                              <div><label className="text-[9px] text-text-muted">Provider</label>
                                <select value={mdl.provider} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], provider: e.target.value };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main">
                                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                              </div>
                              <div><label className="text-[9px] text-text-muted">Priority</label>
                                <input type="number" min="1" max="10" value={mdl.priority} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], priority: parseInt(e.target.value) || 1 };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main" /></div>
                              <div><label className="text-[9px] text-text-muted">Cost/1K</label>
                                <input type="number" step="0.00001" min="0" value={mdl.costPer1K} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], costPer1K: parseFloat(e.target.value) || 0 };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main" /></div>
                              <div><label className="text-[9px] text-text-muted">Max Tokens</label>
                                <input type="number" step="100" min="0" value={mdl.maxTokens} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], maxTokens: parseInt(e.target.value) || 0 };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main" /></div>
                              <div><label className="text-[9px] text-text-muted">Rate Limit/мин</label>
                                <input type="number" min="0" value={mdl.rateLimit} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], rateLimit: parseInt(e.target.value) || 0 };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main" /></div>
                              <div><label className="text-[9px] text-text-muted">Cooldown (мин)</label>
                                <input type="number" min="0" step="0.5" value={mdl.cooldownMinutes} onChange={(e) => {
                                  const models = [...groupForm.models];
                                  models[idx] = { ...models[idx], cooldownMinutes: parseFloat(e.target.value) || 0 };
                                  setGroupForm(p => ({ ...p, models }));
                                }} className="w-full px-1.5 py-1 text-[10px] rounded border border-border bg-bg-main" /></div>
                              {mdl.costPer1K === 0 && <div className="flex items-end px-1.5 py-1 text-[10px] text-green-400">🆓 FREE</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => { setEditingGroup(null); setGroupForm({}); }} className="px-3 py-1.5 text-xs bg-bg-hover rounded-lg hover:bg-bg-subtle transition-colors">Отмена</button>
                      <button onClick={handleSaveGroup} className="px-4 py-1.5 text-xs bg-accent-main text-white rounded-lg hover:bg-accent-hover transition-colors">Сохранить группу</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 mt-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-subtle font-mono">{g.strategy || routerConfig.strategy}</span>
                      <span className="text-[10px] text-text-muted">Fallback: <span className="font-mono text-text-main">{g.fallbackModel || '—'}</span></span>
                      <span className="text-[10px] text-text-muted">Cost limit: <span className="font-mono">${g.costLimitPerDay || 0}/день</span></span>
                      <span className="text-[10px] text-text-muted">Token limit: <span className="font-mono">{Intl.NumberFormat().format(g.tokenLimitPerDay || 0)}/день</span></span>
                      <span className={g.enabled !== false ? 'text-[10px] text-green-400' : 'text-[10px] text-red-400'}>{g.enabled !== false ? '✅ Enabled' : '❌ Disabled'}</span>
                      <button onClick={() => {
                        setEditingGroup(groupKey);
                        setGroupForm({ ...g });
                      }} className="px-2 py-1 text-[10px] bg-bg-hover rounded hover:bg-bg-subtle transition-colors ml-auto">✏️ Редактировать</button>
                    </div>

                    {/* Список моделей в группе */}
                    <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                      {(g.models || []).map((mdl, idx) => (
                        <div key={idx} className="px-3 py-2 flex items-center gap-2 text-xs hover:bg-bg-hover transition-colors">
                          <span className={`size-1.5 rounded-full ${mdl.costPer1K === 0 ? 'bg-green-400' : mdl.costPer1K < 0.001 ? 'bg-blue-400' : 'bg-amber-400'}`} />
                          <span className="font-mono flex-1">{mdl.id}</span>
                          <span className="text-text-muted">{mdl.provider}</span>
                          <span className="text-text-muted">P{mdl.priority}</span>
                          <span className="text-text-muted w-14 text-right">${mdl.costPer1K}</span>
                          <span className="text-text-muted w-12 text-right">{mdl.maxTokens}</span>
                          <span className="text-text-muted w-14 text-right">{mdl.rateLimit ? `${mdl.rateLimit}/min` : '∞'}</span>
                          {mdl.cooldownMinutes > 0 && <span className="text-text-muted">cd:{mdl.cooldownMinutes}m</span>}
                          {mdl.costPer1K === 0 && <span className="text-green-400 text-[10px]">🆓</span>}
                        </div>
                      ))}
                      {(!g.models || g.models.length === 0) && (
                        <div className="px-3 py-4 text-center text-text-muted text-xs">Нет моделей в группе</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
   Вкладка: История ротаций
   ================================================================ */
function renderHistoryTab(history, fmtTime, fmtDate, routerStats, Icons) {
  return (
    <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icons.List />
          <h3 className="text-sm font-semibold">История ротаций (переключений моделей)</h3>
        </div>
        <span className="text-[10px] text-text-muted">Последние {history.length} из 100</span>
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-8 text-center text-text-muted text-sm">Нет записей о ротациях. Отправьте запрос или запустите симуляцию.</div>
      ) : (
        <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
          {history.map((h, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-bg-hover transition-colors">
              <span className="text-text-muted w-8">{history.length - i}</span>
              <span className={`size-1.5 rounded-full ${h.provider === 'ollama' ? 'bg-green-400' : h.provider === 'routerai' ? 'bg-blue-400' : 'bg-purple-400'}`} />
              <span className="font-mono flex-1 truncate">{h.modelId}</span>
              <span className="text-text-muted">{h.provider}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-bg-subtle text-[10px]">{h.group}</span>
              <span className="text-text-muted text-[10px]">{h.strategy}</span>
              <span className="text-text-muted text-[10px]" title={fmtDate(h.timestamp)}>{fmtTime(h.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
      {routerStats.totalRequests > 0 && (
        <div className="px-4 py-2 border-t border-border bg-bg-subtle flex items-center gap-4 text-[10px] text-text-muted">
          <span>Всего запросов: {Intl.NumberFormat().format(routerStats.totalRequests)}</span>
          <span>Всего токенов: {Intl.NumberFormat().format(routerStats.totalTokens)}</span>
          <span>Всего ошибок: {routerStats.totalErrors || 0}</span>
          <span className="flex-1" />
          <a href="/dashboard/usage?tab=details" className="text-accent-main hover:underline">Usage Details →</a>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Вкладка: Рейтинг моделей (глобальный лидерборд)
    ================================================================ */
function renderHealthTab(health, routerConfig, routerStats, Icons, fmtNum, fmtTime, fmtCostFull) {
  // Build unified model list from all groups
  const usage = routerStats.dailyUsage || {};
  const allModels = [];
  const groups = routerConfig.modelGroups || {};
  for (const [groupType, group] of Object.entries(groups)) {
    for (const m of (group.models || [])) {
      const h = health[m.id] || {};
      const tokensUsed = usage.tokens?.[m.id] || 0;
      const requestsUsed = usage.requests?.[m.id] || 0;
      const costUsed = usage.costs?.[m.id] || 0;
      const errorsUsed = usage.errors?.[m.id] || 0;
      const errorRate = requestsUsed > 0 ? ((errorsUsed / requestsUsed) * 100).toFixed(1) : '—';

      // Composite score: lower priority = better, lower cost = better, more usage = proven
      const score = Math.max(0, 100
        - (m.priority - 1) * 10       // priority factor (1→0pts, 5→40pts penalty)
        - Math.min(30, (m.costPer1K || 0) * 10000) // cost penalty
        + Math.min(20, tokensUsed / 10000)         // usage bonus
        - (h.available === false ? 30 : h.inCooldown ? 15 : 0) // status penalty
        - Math.min(20, errorsUsed * 5)              // error penalty
      );

      allModels.push({
        id: m.id,
        provider: m.provider,
        group: groupType,
        priority: m.priority,
        costPer1K: m.costPer1K,
        maxTokens: m.maxTokens,
        rateLimit: m.rateLimit,
        cooldownMinutes: m.cooldownMinutes,
        score: Math.round(score),
        available: h.available !== false,
        inCooldown: !!h.inCooldown,
        cooldownRemainingSec: h.cooldownRemainingSec || 0,
        lastUsed: h.lastUsed,
        lastError: h.lastError,
        errorCount: h.errorCount || errorsUsed,
        tokensUsed,
        requestsUsed,
        costUsed,
        errorRate,
      });
    }
  }

  // Sort by score descending
  allModels.sort((a, b) => b.score - a.score);

  const totalTokens = allModels.reduce((s, m) => s + m.tokensUsed, 0);
  const totalRequests = allModels.reduce((s, m) => s + m.requestsUsed, 0);
  const totalCost = allModels.reduce((s, m) => s + m.costUsed, 0);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Моделей</span>
          <div className="text-lg font-bold">{allModels.length}</div>
        </div>
        <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Всего токенов</span>
          <div className="text-lg font-bold">{Intl.NumberFormat().format(totalTokens)}</div>
        </div>
        <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Запросов</span>
          <div className="text-lg font-bold">{Intl.NumberFormat().format(totalRequests)}</div>
        </div>
        <div className="px-4 py-3 rounded-xl bg-bg-card border border-border">
          <span className="text-[10px] text-text-muted uppercase font-semibold">Общая стоимость</span>
          <div className="text-lg font-bold">{fmtCostFull(totalCost)}</div>
        </div>
      </div>

      {/* Leaderboard table */}
      <div className="rounded-xl bg-bg-card border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Icons.BarChart />
            <h3 className="text-sm font-semibold">🏆 Глобальный рейтинг моделей</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted hidden sm:inline">Ранг по качеству, стоимости и использованию</span>
            <button onClick={() => exportRatingJSON(allModels)}
              className="px-2 py-1 text-[10px] bg-bg-hover rounded hover:bg-bg-subtle transition-colors inline-flex items-center gap-1"
              title="Скачать JSON">
              <Icons.Download /> JSON
            </button>
            <button onClick={() => exportRatingCSV(allModels)}
              className="px-2 py-1 text-[10px] bg-bg-hover rounded hover:bg-bg-subtle transition-colors inline-flex items-center gap-1"
              title="Скачать CSV">
              <Icons.Download /> CSV
            </button>
          </div>
        </div>
        {allModels.length === 0 ? (
          <div className="px-4 py-8 text-center text-text-muted text-sm">
            Нет моделей в конфигурации. Добавьте модели в группы настроек.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-bg-subtle">
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">Модель</th>
                  <th className="px-3 py-2 text-left">Провайдер</th>
                  <th className="px-3 py-2 text-left">Группа</th>
                  <th className="px-3 py-2 text-center">Статус</th>
                  <th className="px-3 py-2 text-right">Рейтинг</th>
                  <th className="px-3 py-2 text-right">Приоритет</th>
                  <th className="px-3 py-2 text-right">Cost/1K</th>
                  <th className="px-3 py-2 text-right">Токены</th>
                  <th className="px-3 py-2 text-right">Запросы</th>
                  <th className="px-3 py-2 text-right">Стоимость</th>
                  <th className="px-3 py-2 text-right">Ошибки</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allModels.map((m, i) => {
                  const rankColor = i === 0 ? 'text-amber-400' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-text-muted';
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
                  return (
                    <tr key={m.id} className={`hover:bg-bg-hover transition-colors ${i < 3 ? 'bg-amber-500/[0.02]' : ''}`}>
                      <td className={`px-3 py-2 font-mono ${rankColor}`}>{medal || (i + 1)}</td>
                      <td className="px-3 py-2 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className={`size-1.5 rounded-full ${m.available && !m.inCooldown ? 'bg-green-400' : m.inCooldown ? 'bg-yellow-400' : 'bg-red-400'}`} />
                          <span className={m.costPer1K === 0 ? 'text-green-400' : ''}>{m.id}</span>
                          {m.costPer1K === 0 && <span className="text-[9px] text-green-400">FREE</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-text-muted">{m.provider}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded bg-bg-subtle text-[10px]">{m.group}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                          m.available && !m.inCooldown ? 'bg-green-500/10 text-green-400' :
                          m.inCooldown ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {m.available && !m.inCooldown ? '🟢' : m.inCooldown ? `🟡 ${m.cooldownRemainingSec}s` : '🔴'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              m.score >= 80 ? 'bg-green-400' : m.score >= 50 ? 'bg-yellow-400' : 'bg-red-400'
                            }`} style={{ width: `${Math.min(100, m.score)}%` }} />
                          </div>
                          <span className="font-mono w-7 text-right">{m.score}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{m.priority}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={m.costPer1K === 0 ? 'text-green-400' : ''}>
                          {m.costPer1K === 0 ? 'FREE' : `$${m.costPer1K}`}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-text-muted">{Intl.NumberFormat().format(m.tokensUsed)}</td>
                      <td className="px-3 py-2 text-right font-mono text-text-muted">{Intl.NumberFormat().format(m.requestsUsed)}</td>
                      <td className="px-3 py-2 text-right font-mono text-text-muted">{fmtCostFull(m.costUsed)}</td>
                      <td className="px-3 py-2 text-right">
                        {m.errorCount > 0 ? (
                          <span className="text-red-400 font-mono" title={m.lastError || ''}>
                            {m.errorCount}{m.errorRate !== '—' ? ` (${m.errorRate}%)` : ''}
                          </span>
                        ) : (
                          <span className="text-text-muted">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {allModels.length > 0 && (
          <div className="px-4 py-2 border-t border-border bg-bg-subtle flex items-center gap-4 text-[10px] text-text-muted">
            <span>⭐ Приоритет (1 = лучший)</span>
            <span>💰 FREE = бесплатная модель</span>
            <span>🏆 Рейтинг = качество + использование − стоимость − ошибки</span>
          </div>
        )}
      </div>

      {/* Model health details (collapsed) */}
      <details className="rounded-xl bg-bg-card border border-border overflow-hidden">
        <summary className="px-4 py-3 text-sm font-semibold cursor-pointer hover:bg-bg-hover transition-colors flex items-center gap-2">
          <Icons.Heart />
          <span>Детальный статус моделей (Health Check)</span>
          <span className="text-[10px] text-text-muted font-normal">нажмите для раскрытия</span>
        </summary>
        <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
          {allModels.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-sm">Нет данных</div>
          ) : (
            allModels.map(m => (
              <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-bg-hover transition-colors">
                <span className={`size-2 rounded-full ${m.available && !m.inCooldown ? 'bg-green-400' : m.inCooldown ? 'bg-yellow-400' : 'bg-red-400'}`} />
                <span className="font-mono flex-1 truncate">{m.id}</span>
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${m.available && !m.inCooldown ? 'bg-green-500/10 text-green-400' : m.inCooldown ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
                  {m.available && !m.inCooldown ? '🟢 OK' : m.inCooldown ? `🟡 Cooldown ${m.cooldownRemainingSec}s` : '🔴 Unavailable'}
                </span>
                {m.lastUsed && <span className="text-text-muted">used: {fmtTime(m.lastUsed)}</span>}
                {m.lastError && <span className="text-red-400 truncate max-w-[150px]" title={m.lastError}>err: {m.lastError}</span>}
                {m.errorCount > 0 && <span className="text-red-400">⚠ {m.errorCount}</span>}
                <span className="text-text-muted">{m.tokensUsed > 0 ? `${Intl.NumberFormat().format(m.tokensUsed)} tok` : ''}</span>
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

/* ================================================================
   Вспомогательные компоненты полей
   ================================================================ */

/** Карточка настройки с collapsible и режимом редактирования */
function SettingCard({ title, sectionKey, isExpanded, toggle, isEditing, onEdit, onCancel, formContent, viewContent, isNested }) {
  return (
    <div className={`rounded-xl bg-bg-card border border-border overflow-hidden ${isNested ? 'ml-4' : ''}`}>
      <button onClick={toggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-hover transition-colors">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="px-2 py-1 text-[10px] bg-bg-hover rounded hover:bg-bg-subtle transition-colors">✏️ Редактировать</button>
          )}
          <span className="text-text-muted">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4">
          {isEditing ? formContent : viewContent}
        </div>
      )}
    </div>
  );
}

function ToggleField({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5 bg-bg-subtle rounded-lg">
      <span className="text-xs">{label}</span>
      <button onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-green-500' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function TinyToggleField({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px]">{label}</span>
      <button onClick={() => onChange(!value)}
        className={`relative w-7 h-4 rounded-full transition-colors ${value ? 'bg-green-500' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 left-0.5 size-3 rounded-full bg-white transition-transform ${value ? 'translate-x-3' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step }) {
  // Защита от NaN: показываем пустую строку, если value невалидное
  const displayValue = (value === null || value === undefined || Number.isNaN(value)) ? '' : value;
  return (
    <div>
      <label className="text-[10px] text-text-muted">{label}</label>
      <input type="number" min={min} max={max} step={step} value={displayValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange('');
            return;
          }
          const v = parseFloat(raw);
          onChange(Number.isNaN(v) ? '' : v);
        }}
        className="w-full px-2 py-1.5 text-xs rounded border border-border bg-bg-main" />
    </div>
  );
}

function ViewItem({ label, value }) {
  return (
    <div className="px-2 py-1.5 bg-bg-subtle rounded-lg">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="text-xs font-medium">{value ?? '—'}</div>
    </div>
  );
}

/* ============================================================
   TAB: Тест провайдеров (Ping All)
   ============================================================ */
function renderPingTab(
  pingResults, pingLoading, pingError, handlePingAll,
  autoConfigResult, autoConfigLoading, handleAutoConfig, Icons,
  scanResults, scanLoading, scanError, handleScan,
  discoveryStatus, discoveryLoading, handleDiscoveryAction,
  cacheResult, cacheLoading, handleCheckCache,
  cleanupResult, cleanupLoading, handleCleanupBroken
) {
  return (
    <div className="space-y-4">
      {/* Header + Button */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-surface border border-border">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-main)' }}>📡 Тест провайдеров</h2>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Прозвонить все провайдеры и бесплатные модели. Результаты попадут в статистику.
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={handlePingAll}
            disabled={pingLoading}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '12px',
              color: '#fff',
              background: pingLoading
                ? 'linear-gradient(135deg, #6b7280, #9ca3af)'
                : 'linear-gradient(135deg, #E56A4A, #cc5236)',
              border: 'none',
              cursor: pingLoading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {pingLoading ? '⏳' : '🔔 Прозвон'}
          </button>
          {pingResults?.workingModels?.length > 0 && (
            <button
              onClick={handleAutoConfig}
              disabled={autoConfigLoading}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '12px',
                color: '#fff',
                background: autoConfigLoading
                  ? 'linear-gradient(135deg, #6b7280, #9ca3af)'
                  : 'linear-gradient(135deg, #10b981, #059669)',
                border: 'none',
                cursor: autoConfigLoading ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {autoConfigLoading ? '⏳' : '⚡ Автонастройка'}
            </button>
          )}
          <button
            onClick={handleScan}
            disabled={scanLoading}
            title="AI-бенчмарки всех моделей"
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '12px',
              color: '#fff',
              background: scanLoading
                ? 'linear-gradient(135deg, #6b7280, #9ca3af)'
                : 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
              border: 'none',
              cursor: scanLoading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {scanLoading ? '⏳' : '🔬 Сканер AI'}
          </button>
          <button
            onClick={() => handleDiscoveryAction(discoveryStatus?.scanner?.scheduled ? 'stop' : 'start')}
            disabled={discoveryLoading}
            title={discoveryStatus?.scanner?.scheduled ? 'Остановить автодискавер' : 'Запустить автодискавер'}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '12px',
              color: '#fff',
              background: discoveryLoading
                ? 'linear-gradient(135deg, #6b7280, #9ca3af)'
                : discoveryStatus?.scanner?.scheduled
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : 'linear-gradient(135deg, #06b6d4, #0891b2)',
              border: 'none',
              cursor: discoveryLoading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {discoveryLoading ? '⏳' : discoveryStatus?.scanner?.scheduled ? '⏹ Дискавер' : '▶ Дискавер'}
          </button>
          <button
            onClick={handleCheckCache}
            disabled={cacheLoading}
            title="Кэш результатов сканера"
            style={{
              padding: '6px 10px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '12px',
              color: 'var(--color-text-main)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              cursor: cacheLoading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cacheLoading ? '⏳' : '📦'}
          </button>
          <button
            onClick={handleCleanupBroken}
            disabled={cleanupLoading}
            title="Отключить модели стабильно не отвечающие (3+ ошибки)"
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '12px',
              color: '#fff',
              background: cleanupLoading
                ? 'linear-gradient(135deg, #6b7280, #9ca3af)'
                : 'linear-gradient(135deg, #f59e0b, #d97706)',
              border: 'none',
              cursor: cleanupLoading ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cleanupLoading ? '⏳' : '🧹 Битые'}
          </button>
        </div>
      </div>

      {/* Loading spinner */}
      {pingLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary)' }}></div>
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Тестирую все модели и провайдеры...</span>
          </div>
        </div>
      )}

      {/* Error */}
      {pingError && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          fontSize: '14px',
        }}>
          ❌ {pingError}
        </div>
      )}

      {/* Scan loading spinner */}
      {scanLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: '#8b5cf6' }}></div>
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>AI-бенчмарки всех моделей (до 5 мин)...</span>
          </div>
        </div>
      )}

      {/* Scan error */}
      {scanError && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          fontSize: '14px',
        }}>
          ❌ Ошибка сканера: {scanError}
        </div>
      )}

      {/* Discovery status */}
      {discoveryStatus && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(6, 182, 212, 0.08)',
          border: '1px solid rgba(6, 182, 212, 0.2)',
          fontSize: '13px',
        }}>
          <strong style={{ color: 'var(--color-text-main)' }}>
            {discoveryStatus.message || 'Статус автодискавера'}
          </strong>
          {discoveryStatus.scanner && (
            <div style={{ marginTop: '6px', color: 'var(--color-text-muted)', fontSize: '12px' }}>
              {discoveryStatus.scanner.scheduled ? '🟢 Активен' : '🔴 Остановлен'}
              {discoveryStatus.scanner.running ? ' (выполняется сканирование)' : ''}
            </div>
          )}
        </div>
      )}

      {/* Cache result */}
      {cacheResult && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(139, 92, 246, 0.08)',
          border: '1px solid rgba(139, 92, 246, 0.2)',
          fontSize: '13px',
        }}>
          <strong style={{ color: 'var(--color-text-main)' }}>📦 Кэш сканера</strong>
          <pre style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-text-muted)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(cacheResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Cleanup result — список отключённых моделей */}
      {cleanupResult && cleanupResult.disabled?.length > 0 && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          fontSize: '13px',
        }}>
          <strong style={{ color: 'var(--color-warning)' }}>🧹 Отключено {cleanupResult.disabled.length} битых моделей:</strong>
          <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {cleanupResult.disabled.map((m, i) => (
              <span key={i} style={{
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border)',
                fontSize: '11px',
                color: 'var(--color-text-muted)',
              }}>
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
      {cleanupResult && cleanupResult.disabled?.length === 0 && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          fontSize: '13px',
          color: 'var(--color-success)',
        }}>
          ✅ Нет моделей для отключения — все стабильно работают
        </div>
      )}

      {/* Summary cards */}
      {pingResults && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            <SummaryCard label="Всего тестов" value={pingResults.summary.total} color="var(--color-info)" />
            <SummaryCard label="Успешно" value={pingResults.summary.ok} color="var(--color-success)" />
            <SummaryCard label="Ошибки" value={pingResults.summary.failed} color="var(--color-danger)" />
            <SummaryCard label="Ср. задержка" value={`${pingResults.summary.avgLatencyMs}ms`} color="var(--color-warning)" />
          </div>

          {/* Results table */}
          <div className="rounded-xl border border-border overflow-hidden">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)' }}>
                  <th style={thStyle}>Статус</th>
                  <th style={thStyle}>Провайдер</th>
                  <th style={thStyle}>Модель</th>
                  <th style={thStyle}>Задержка</th>
                  <th style={thStyle}>Ответ</th>
                </tr>
              </thead>
              <tbody>
                {pingResults.results.map((r, i) => (
                  <tr key={i} style={{
                    borderTop: '1px solid var(--color-border)',
                    background: r.status === 'ok' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                  }}>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: r.status === 'ok' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: r.status === 'ok' ? '#10b981' : '#ef4444',
                      }}>
                        {r.status === 'ok' ? '✅' : '❌'} {r.status === 'ok' ? 'OK' : 'Fail'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{r.connectionName || r.provider}</span>
                    </td>
                    <td style={tdStyle}>
                      <code style={{
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--color-surface-2)',
                        color: 'var(--color-text-main)',
                      }}>{r.model}</code>
                    </td>
                    <td style={tdStyle}>
                      <LatencyBar ms={r.latencyMs} />
                    </td>
                    <td style={{ ...tdStyle, maxWidth: '200px' }}>
                      {r.status === 'ok'
                        ? <span style={{ color: 'var(--color-text-muted)', fontSize: '12px' }}>{r.response?.substring(0, 50)}</span>
                        : <span style={{ color: '#ef4444', fontSize: '11px' }}>{r.error?.substring(0, 80)}</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Auto-config result */}
      {autoConfigResult && (
        <div style={{
          padding: '16px',
          borderRadius: '12px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
        }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px', color: 'var(--color-text-main)' }}>
            ⚡ Автонастройка выполнена
          </h3>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--color-text-muted)', lineHeight: '1.8' }}>
            {autoConfigResult.actions?.map((a, i) => (
              <li key={i}>✓ {a}</li>
            ))}
          </ul>
          {autoConfigResult.supervisorModel && (
            <div style={{ marginTop: '8px', fontSize: '12px' }}>
              <strong style={{ color: 'var(--color-text-main)' }}>Supervisor:</strong>{' '}
              <code style={{ padding: '2px 6px', borderRadius: '4px', background: 'var(--color-surface-2)', color: 'var(--color-primary)' }}>
                {autoConfigResult.supervisorModel}
              </code>
            </div>
          )}
        </div>
      )}

      {/* Scan results */}
      {scanResults && (
        <div className="space-y-3">
          <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px', color: 'var(--color-text-main)' }}>
              🔬 Сканер моделей — результаты
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              <SummaryCard label="Всего моделей" value={scanResults.summary.total} color="#8b5cf6" />
              <SummaryCard label="Работает" value={scanResults.summary.ok} color="var(--color-success)" />
              <SummaryCard label="Ошибки" value={scanResults.summary.failed} color="var(--color-danger)" />
              <SummaryCard label="Топ модель" value={scanResults.summary.topModel || '—'} color="var(--color-warning)" />
              <SummaryCard label="Топ оценка" value={scanResults.summary.topScore ? `${(scanResults.summary.topScore * 100).toFixed(0)}%` : '—'} color="var(--color-info)" />
            </div>

            {/* Ranking table */}
            {scanResults.ranking?.length > 0 && (
              <>
                <h4 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>
                  🏆 Рейтинг моделей
                </h4>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-surface-2)' }}>
                        <th style={thStyle}>#</th>
                        <th style={thStyle}>Модель</th>
                        <th style={thStyle}>Провайдер</th>
                        <th style={thStyle}>Оценка</th>
                        <th style={thStyle}>Задержка</th>
                        <th style={thStyle}>Тир</th>
                        <th style={thStyle}>Способности</th>
                        <th style={thStyle}>Стоимость</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanResults.ranking.map((m, i) => (
                        <tr key={i} style={{
                          borderTop: '1px solid var(--color-border)',
                          background: m.tier === 'free' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(59, 130, 246, 0.05)',
                        }}>
                          <td style={tdStyle}>{i + 1}</td>
                          <td style={tdStyle}><strong>{m.model}</strong></td>
                          <td style={tdStyle}>{m.provider}</td>
                          <td style={tdStyle}>
                            <span style={{
                              display: 'inline-block',
                              padding: '1px 8px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: m.avgScore >= 0.7 ? 'rgba(16, 185, 129, 0.15)' : m.avgScore >= 0.4 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: m.avgScore >= 0.7 ? 'var(--color-success)' : m.avgScore >= 0.4 ? 'var(--color-warning)' : '#ef4444',
                            }}>
                              {(m.avgScore * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td style={tdStyle}>{m.latencyMs}ms</td>
                          <td style={tdStyle}>
                            <span style={{
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 600,
                              background: m.tier === 'free' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                              color: m.tier === 'free' ? 'var(--color-success)' : 'var(--color-warning)',
                            }}>
                              {m.tier === 'free' ? 'FREE' : 'PAID'}
                            </span>
                          </td>
                          <td style={tdStyle}>{(m.capabilities || []).join(', ')}</td>
                          <td style={tdStyle}>{m.costPer1K > 0 ? `$${m.costPer1K}/1K` : 'free'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Applied config summary */}
            {scanResults.config && (
              <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: 'var(--color-surface-2)', fontSize: '12px' }}>
                <strong style={{ color: 'var(--color-text-main)' }}>⚙️ Конфигурация применена:</strong>
                <div style={{ marginTop: '4px', color: 'var(--color-text-muted)', lineHeight: '1.8' }}>
                  Стратегия: <code style={{ padding: '1px 4px', borderRadius: '3px', background: 'var(--color-surface)' }}>{scanResults.config.strategy}</code>
                  {' | '}Free first: <strong>{scanResults.config.preferFreeModels ? '✅' : '❌'}</strong>
                  {' | '}Групп: <strong>{Object.keys(scanResults.config.groups || {}).length}</strong>
                  {' | '}Supervisor: <code style={{ padding: '1px 4px', borderRadius: '3px', background: 'var(--color-surface)' }}>{scanResults.config.supervisor?.model || '—'}</code>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-muted)',
};

const tdStyle = {
  padding: '8px 12px',
  verticalAlign: 'middle',
};

function SummaryCard({ label, value, color }) {
  return (
    <div style={{
      padding: '12px 16px',
      borderRadius: '12px',
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}

function LatencyBar({ ms }) {
  const maxMs = 10000;
  const pct = Math.min(100, (ms / maxMs) * 100);
  const color = ms < 2000 ? '#10b981' : ms < 5000 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{
        width: '60px',
        height: '6px',
        borderRadius: '3px',
        background: 'var(--color-surface-3)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: '3px',
          background: color,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color, minWidth: '50px' }}>
        {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
      </span>
    </div>
  );
}

/* ============================================================
   Экспорт рейтинга в JSON / CSV
   ============================================================ */
function exportRatingJSON(models) {
  const data = models.map((m, i) => ({
    rank: i + 1,
    model: m.id,
    provider: m.provider,
    group: m.group,
    rating: m.score,
    priority: m.priority,
    costPer1K: m.costPer1K,
    status: m.available && !m.inCooldown ? 'ok' : m.inCooldown ? 'cooldown' : 'unavailable',
    tokensUsed: m.tokensUsed,
    requestsUsed: m.requestsUsed,
    totalCost: m.costUsed,
    errors: m.errorCount,
    lastError: m.lastError || '',
  }));
  downloadBlob(JSON.stringify(data, null, 2), 'model-rating.json', 'application/json');
}

function exportRatingCSV(models) {
  const headers = ['Rank','Model','Provider','Group','Rating','Priority','Cost/1K','Status','Tokens','Requests','Total Cost','Errors','Last Error'];
  const rows = models.map((m, i) => [
    i + 1,
    m.id,
    m.provider,
    m.group,
    m.score,
    m.priority,
    m.costPer1K,
    m.available && !m.inCooldown ? 'ok' : m.inCooldown ? 'cooldown' : 'unavailable',
    m.tokensUsed,
    m.requestsUsed,
    m.costUsed,
    m.errorCount,
    (m.lastError || '').replace(/"/g, '""'),
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(','))].join('\n');
  downloadBlob('\uFEFF' + csv, 'model-rating.csv', 'text/csv;charset=utf-8');
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}