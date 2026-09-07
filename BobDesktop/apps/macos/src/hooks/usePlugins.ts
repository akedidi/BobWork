import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getPlugins } from '../lib/ipc';
import { useAppStore } from '../stores/appStore';
import { PLUGIN_CONVERSATION_PROMPT } from '../lib/pluginBuilder';
import type { Plugin, PluginCategory } from '@bob-work/shared-types';
import { isEnabled } from '../lib/pluginUtils';
import { isBuiltinPlugin, sortPluginsForDisplay } from '../lib/builtinCatalog';

export type PluginFilter = 'all' | 'ibm' | 'business' | 'enabled' | 'disabled';
type Form = { name: string; description: string; instructions: string; category: PluginCategory };
const EMPTY: Form = { name: '', description: '', instructions: '', category: 'recipe' };

export function usePluginsData() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [mcpRevision, setMcpRevision] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = hideBuiltinShadows(await getPlugins());
      setPlugins(next);
      return next;
    } catch (error) {
      setLoadError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  const incrementMcpRevision = useCallback(() => setMcpRevision(r => r + 1), []);

  return { plugins, setPlugins, loading, loadError, mcpRevision, incrementMcpRevision, reload: load };
}

export type PluginListSectionId = 'personal' | 'ibm' | 'business' | 'builtin';

export type PluginListSection = {
  id: PluginListSectionId;
  titleKey: 'plugins.sectionYours' | 'plugins.sectionIbm' | 'plugins.sectionBusiness' | 'plugins.sectionBuiltin';
  plugins: Plugin[];
};

export function usePluginFilter(plugins: Plugin[]) {
  const [filter, setFilter] = useState<PluginFilter>('all');
  const [search, setSearch] = useState('');

  const catalogPlugins = useMemo(() => hideBuiltinShadows(plugins), [plugins]);

  const visiblePlugins = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = catalogPlugins.filter(plugin => {
      if (filter === 'ibm' && !isIbmProductPlugin(plugin)) return false;
      if (filter === 'business' && !isIbmProfessionPlugin(plugin)) return false;
      if (filter === 'enabled' && !isEnabled(plugin)) return false;
      if (filter === 'disabled' && isEnabled(plugin)) return false;
      if (!query) return true;
      return `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(query);
    });
    return sortPluginsForDisplay(filtered);
  }, [filter, catalogPlugins, search]);

  const visibleSections = useMemo(
    () => groupPluginsForDisplay(visiblePlugins),
    [visiblePlugins],
  );

  return { filter, setFilter, search, setSearch, visiblePlugins, visibleSections };
}

const IBM_PRODUCT_IDS = new Set([
  'builtin-docling',
  'builtin-granite-guardian',
  'builtin-data-prep-kit',
  'builtin-ai-reviewer',
]);

export function isIbmProfessionPlugin(plugin: Pick<Plugin, 'id' | 'manifest'>): boolean {
  const id = plugin.id.trim().toLocaleLowerCase();
  const manifest = plugin.manifest as unknown as Record<string, unknown> | undefined;
  const productFamily = `${manifest?.productFamily ?? ''}`.trim().toLocaleLowerCase();
  const slug = `${manifest?.slug ?? ''}`.trim().toLocaleLowerCase();
  return id.startsWith('builtin-ibm-agentic-')
    || id.includes('ibm-agentic-')
    || slug.startsWith('ibm-agentic-')
    || productFamily === 'ibm agentic'
    || productFamily.startsWith('ibm agentic');
}

export function isIbmProductPlugin(plugin: Pick<Plugin, 'id' | 'manifest'>): boolean {
  if (isIbmProfessionPlugin(plugin)) return false;
  const id = plugin.id.trim().toLocaleLowerCase();
  const manifest = plugin.manifest as unknown as Record<string, unknown> | undefined;
  const vendor = `${manifest?.vendor ?? manifest?.publisher ?? ''}`.trim().toLocaleLowerCase();
  const productFamily = `${manifest?.productFamily ?? ''}`.trim().toLocaleLowerCase();
  const slug = `${manifest?.slug ?? ''}`.trim().toLocaleLowerCase();
  if (vendor === 'ibm' || vendor.startsWith('ibm ')) return true;
  if (productFamily.startsWith('ibm')) return true;
  if (id.startsWith('builtin-beeai-') || IBM_PRODUCT_IDS.has(id)) return true;
  if (slug.startsWith('ibm-')) return true;
  return slug === 'bob-work-docling' || slug === 'docling' || slug.endsWith('-docling');
}

export function isIbmCatalogPlugin(plugin: Pick<Plugin, 'id' | 'manifest'>): boolean {
  return isIbmProfessionPlugin(plugin) || isIbmProductPlugin(plugin);
}

function catalogKey(plugin: Pick<Plugin, 'id' | 'name' | 'manifest'>): string {
  const manifest = plugin.manifest as unknown as Record<string, unknown> | undefined;
  const slug = `${manifest?.slug ?? ''}`.trim().toLocaleLowerCase();
  const stripped = slug.replace(/^(bob-work-|ibm-|builtin-|agentic-)+/, '');
  if (stripped) return stripped;
  return plugin.id.trim().toLocaleLowerCase().replace(/^(agentic-|builtin-)/, '');
}

export function hideBuiltinShadows(plugins: Plugin[]): Plugin[] {
  const builtins = plugins.filter(isBuiltinPlugin);
  return plugins.filter(plugin => {
    if (isBuiltinPlugin(plugin) || !plugin.id.startsWith('agentic-')) return true;
    const key = catalogKey(plugin);
    const name = plugin.name.trim().toLocaleLowerCase();
    return !builtins.some(builtin => {
      if (key && catalogKey(builtin) === key) return true;
      return Boolean(name) && builtin.name.trim().toLocaleLowerCase() === name;
    });
  });
}

export function groupPluginsForDisplay(plugins: Plugin[]): PluginListSection[] {
  const personal: Plugin[] = [];
  const ibm: Plugin[] = [];
  const business: Plugin[] = [];
  const builtin: Plugin[] = [];
  for (const plugin of plugins) {
    if (isIbmProfessionPlugin(plugin)) business.push(plugin);
    else if (isIbmProductPlugin(plugin)) ibm.push(plugin);
    else if (isBuiltinPlugin(plugin)) builtin.push(plugin);
    else personal.push(plugin);
  }
  const sections: PluginListSection[] = [
    { id: 'personal', titleKey: 'plugins.sectionYours', plugins: sortPluginsForDisplay(personal) },
    { id: 'business', titleKey: 'plugins.sectionBusiness', plugins: sortPluginsForDisplay(business) },
    { id: 'ibm', titleKey: 'plugins.sectionIbm', plugins: sortPluginsForDisplay(ibm) },
    { id: 'builtin', titleKey: 'plugins.sectionBuiltin', plugins: sortPluginsForDisplay(builtin) },
  ];
  return sections.filter(section => section.plugins.length > 0);
}

export function usePluginEditor(
  setFormOpen: (open: boolean) => void,
  setEditing: (plugin: Plugin | null) => void,
  setStatus: (status: string) => void
) {
  const [form, setForm] = useState<Form>(EMPTY);
  const navigate = useNavigate();

  const startPluginChat = useCallback(() => {
    setFormOpen(false);
    useAppStore.getState().setBuilderSession({
      kind: 'plugin_builder',
      brief: PLUGIN_CONVERSATION_PROMPT,
      guided: false,
    });
    navigate('/chat', { state: { mode: 'plugin_builder' } });
  }, [navigate, setFormOpen]);

  const startPluginWizard = useCallback(() => {
    setFormOpen(false);
    navigate('/plugins/new');
  }, [navigate, setFormOpen]);

  const resetForm = useCallback(() => setForm(EMPTY), []);

  return { form, setForm, resetForm, startPluginChat, startPluginWizard };
}
