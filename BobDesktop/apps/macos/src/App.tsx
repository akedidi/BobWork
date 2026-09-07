import { useEffect } from 'react'
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import MainLayout from './components/Layout/MainLayout'
import HomeView from './views/HomeView'
import ChatView from './views/ChatView'
import ProjectView from './views/ProjectView'
import TasksView from './views/TasksView'
import PluginsView from './views/PluginsView'
import PluginBuilderView from './views/PluginBuilderView'
import IntegrationsView from './views/IntegrationsView'
import SettingsView from './views/SettingsView'
import ArtifactGallery from './views/ArtifactGallery'
import ScheduleView from './views/ScheduleView'
import OnboardingFlow from './views/OnboardingFlow'
import ExtensionsView from './views/ExtensionsView'
import { UpdateController } from './components/UpdateController'
import { installSharedRenderingRuntimeBridge } from './runtime/sharedRenderingRuntime'

export const LAST_ROUTE_STORAGE_KEY = 'bob-work-last-route'

export function restorableRoute(value: string | null): string {
  if (!value) return '/'
  if (value === '/') return value
  return /^\/(?:chat(?:\/[A-Za-z0-9_-]+)?|project\/[A-Za-z0-9_-]+|tasks|plugins|integrations|settings|artifacts|schedules|skills)$/.test(value)
    ? value
    : '/'
}

function RoutePersistence() {
  const location = useLocation()
  useEffect(() => {
    localStorage.setItem(LAST_ROUTE_STORAGE_KEY, restorableRoute(location.pathname))
  }, [location.pathname])
  return null
}

export default function App() {
  useEffect(() => installSharedRenderingRuntimeBridge(), [])
  const initialRoute = restorableRoute(localStorage.getItem(LAST_ROUTE_STORAGE_KEY))
  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <RoutePersistence />
      <UpdateController />
      {/* Drag regions live on each view topbar / sidebar header.
          A full-window overlay here sat above the UI (backdrop-filter
          stacking) and swallowed clicks on search / notifications. */}
      <Routes>
        <Route path="/onboarding" element={<OnboardingFlow />} />
        <Route path="/" element={<MainLayout />}>
          <Route index element={<HomeView />} />
          <Route path="chat/:id?" element={<ChatView />} />
          <Route path="project/:id" element={<ProjectView />} />
          <Route path="tasks" element={<TasksView />} />
          <Route path="plugins" element={<PluginsView />} />
          <Route path="plugins/new" element={<PluginBuilderView />} />
          <Route path="integrations" element={<IntegrationsView />} />
          <Route path="settings" element={<SettingsView />} />
          <Route path="artifacts" element={<ArtifactGallery />} />
          <Route path="schedules" element={<ScheduleView />} />
          <Route path="skills" element={<ExtensionsView />} />
          <Route path="extensions" element={<Navigate to="/skills" replace />} />
          <Route path="modes" element={<Navigate to="/settings" replace state={{ tab: 'modes' }} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  )
}
