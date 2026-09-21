// Global styling (Tailwind theme tokens) and the Remix icon font set
import "./globals.css";
import "remixicon/fonts/remixicon.css";

// Outlet renders the matched child route from React Router's layout route tree
import { Outlet } from "react-router-dom";

// Layout: the root shell every page renders inside; supplies global font/theme and mounts the route outlet
export function Layout() {
  return (
    // App-level background, sans font, and default text color so all routes look consistent
    <div className="min-h-screen bg-background font-sans text-foreground">
      {/* Child route (login, role silos, shared docs) is rendered into this slot */}
      <Outlet />
    </div>
  );
}
