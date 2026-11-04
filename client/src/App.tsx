import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { RangeProvider } from "@/lib/dateRange";
import { AuthPage } from "@/pages/AuthPage";
import { CampaignDetail } from "@/pages/CampaignDetail";
import { ComparePage } from "@/pages/ComparePage";
import { Campaigns } from "@/pages/Campaigns";
import { Dashboard } from "@/pages/Dashboard";
import { ImportPage } from "@/pages/ImportPage";
import { SettingsPage } from "@/pages/SettingsPage";

function Protected() {
  const { authed } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  return <RangeProvider><Layout /></RangeProvider>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="campaigns/compare" element={<ComparePage />} />
        <Route path="campaigns/:id" element={<CampaignDetail />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
