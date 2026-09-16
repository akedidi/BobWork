import { Suspense, lazy, useEffect } from 'react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './components/Layout/MainLayout'
import HomeView from './views/HomeView'
import { UpdateController } from './components/UpdateController'
import { installSharedRenderingRuntimeBridge } from './runtime/sharedRenderingRuntime'

const ChatView = lazy(() => import('./views/ChatView'))
const ProjectView = lazy(() => import('./views/ProjectView'))
const TasksView = lazy(() => import('./views/TasksView'))
const PluginsView = lazy(() => import('./views/PluginsView'))
const PluginBuilderView = lazy(() => import('./views/PluginBuilderView'))
const IntegrationsView = lazy(() => import('./views/IntegrationsView'))
const SettingsView = lazy(() => import('./views/SettingsView'))
const ArtifactGallery = lazy(() => import('./views/ArtifactGallery'))
const ScheduleView = lazy(() => import('./views/ScheduleView'))
const OnboardingFlow = lazy(() => import('./views/OnboardingFlow'))
const ExtensionsView = lazy(() => import('./views/ExtensionsView'))

/** Cold start always lands on the main New Chat surface (`/`). */
export const LAUNCH_ROUTE = '/'

export default function App() {
  useEffect(() => installSharedRenderingRuntimeBridge(), [])
  return (
    <MemoryRouter initialEntries={[LAUNCH_ROUTE]}>
      <UpdateController />
      {/* Drag regions live on each view topbar / sidebar header.
          A full-window overlay here sat above the UI (backdrop-filter
          stacking) and swallowed clicks on search / notifications. */}
      <Suspense fallback={null}>
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
      </Suspense>
    </MemoryRouter>
  )
}
