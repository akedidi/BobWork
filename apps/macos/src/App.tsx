import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './components/Layout/MainLayout'
import HomeView from './views/HomeView'
import ChatView from './views/ChatView'
import ProjectView from './views/ProjectView'
import TasksView from './views/TasksView'
import PluginsView from './views/PluginsView'
import IntegrationsView from './views/IntegrationsView'
import SettingsView from './views/SettingsView'
import ArtifactGallery from './views/ArtifactGallery'
import ScheduleView from './views/ScheduleView'
import OnboardingFlow from './views/OnboardingFlow'
import ExtensionsView from './views/ExtensionsView'

export default function App() {
  return (
    <MemoryRouter>
      <Routes>
        <Route path="/onboarding" element={<OnboardingFlow />} />
        <Route path="/" element={<MainLayout />}>
          <Route index element={<HomeView />} />
          <Route path="chat/:id?" element={<ChatView />} />
          <Route path="project/:id" element={<ProjectView />} />
          <Route path="tasks" element={<TasksView />} />
          <Route path="plugins" element={<PluginsView />} />
          <Route path="integrations" element={<IntegrationsView />} />
          <Route path="settings" element={<SettingsView />} />
          <Route path="artifacts" element={<ArtifactGallery />} />
          <Route path="schedules" element={<ScheduleView />} />
          <Route path="extensions" element={<ExtensionsView />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  )
}
