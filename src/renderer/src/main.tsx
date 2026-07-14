import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { LogsPage } from "@/pages/LogsPage";
import { DataLogsPage } from "@/pages/DataLogsPage";
import { ControlSkpPage } from "@/pages/ControlSkpPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SkpPlanPage } from "@/pages/SkpPlanPage";
import { SkpPeriodicPage } from "@/pages/SkpPeriodicPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/beranda" replace /> },
      { path: "beranda", element: <DashboardPage /> },
      { path: "profil", element: <ProfilePage /> },
      { path: "rencana-skp", element: <SkpPlanPage /> },
      { path: "log-harian", element: <LogsPage /> },
      { path: "kirim-skp", element: <ControlSkpPage /> },
      { path: "skp-periodik", element: <SkpPeriodicPage /> },
      { path: "kalender-libur", element: <CalendarPage /> },
      { path: "referensi-skp", element: <Navigate to="/rencana-skp?tab=mapping" replace /> },
      { path: "pengaturan", element: <SettingsPage /> },
      { path: "dashboard", element: <Navigate to="/beranda" replace /> },
      { path: "logs", element: <Navigate to="/log-harian?tab=input-manual" replace /> },
      { path: "data-log-harian", element: <Navigate to="/log-harian?tab=daftar-log" replace /> },
      { path: "kontrol-skp", element: <Navigate to="/kirim-skp" replace /> },
      { path: "periodik", element: <Navigate to="/skp-periodik" replace /> },
      { path: "skp-periodic", element: <Navigate to="/skp-periodik" replace /> },
      { path: "import", element: <Navigate to="/log-harian?tab=import-excel" replace /> },
      { path: "mapping-skp", element: <Navigate to="/rencana-skp?tab=mapping" replace /> },
      { path: "queue", element: <Navigate to="/kirim-skp?tab=antrean" replace /> },
      { path: "calendar", element: <Navigate to="/kalender-libur" replace /> },
      { path: "history", element: <Navigate to="/kirim-skp?tab=riwayat" replace /> },
      { path: "settings", element: <Navigate to="/pengaturan" replace /> },
      { path: "profile", element: <Navigate to="/profil" replace /> },
      { path: "rencana", element: <Navigate to="/rencana-skp" replace /> },
      { path: "help", element: <Navigate to="/pengaturan" replace /> }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
