import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
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

export default function App() {
  return (
    <MemoryRouter>
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
