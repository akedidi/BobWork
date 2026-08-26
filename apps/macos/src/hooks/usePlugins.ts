import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getPlugins } from '../lib/ipc';
import { useAppStore } from '../stores/appStore';
import { PLUGIN_CONVERSATION_PROMPT } from '../lib/pluginBuilder';
import type { Plugin, PluginCategory } from '@bob-work/shared-types';
import { isEnabled } from '../lib/pluginUtils';
import { sortPluginsForDisplay } from '../lib/builtinCatalog';

type PluginFilter = 'all' | 'enabled' | 'disabled';
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
      const next = await getPlugins();
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

export function usePluginFilter(plugins: Plugin[]) {
  const [filter, setFilter] = useState<PluginFilter>('all');
  const [search, setSearch] = useState('');

  const visiblePlugins = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = plugins.filter(plugin => {
      if (filter === 'enabled' && !isEnabled(plugin)) return false;
      if (filter === 'disabled' && isEnabled(plugin)) return false;
      if (!query) return true;
      return `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(query);
    });
    return sortPluginsForDisplay(filtered);
  }, [filter, plugins, search]);

  return { filter, setFilter, search, setSearch, visiblePlugins };
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
