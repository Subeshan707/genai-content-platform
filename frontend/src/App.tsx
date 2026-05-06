import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import NewContent from './pages/NewContent';
import Editor from './pages/Editor';
import LocaleReview from './pages/LocaleReview';
import AssetManager from './pages/AssetManager';
import PublishPage from './pages/PublishPage';
import BrandSettings from './pages/BrandSettings';
import WorkspaceSettings from './pages/WorkspaceSettings';
import AuditTrail from './pages/AuditTrail';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewContent />} />
        <Route path="/editor/:id" element={<Editor />} />
        <Route path="/editor/:id/locales" element={<LocaleReview />} />
        <Route path="/editor/:id/assets" element={<AssetManager />} />
        <Route path="/publish/:id" element={<PublishPage />} />
        <Route path="/settings/brand" element={<BrandSettings />} />
        <Route path="/settings/workspace" element={<WorkspaceSettings />} />
        <Route path="/audit" element={<AuditTrail />} />
      </Route>
    </Routes>
  );
}
