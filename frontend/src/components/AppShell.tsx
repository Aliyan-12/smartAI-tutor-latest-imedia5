import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

/**
 * Persistent app shell: the Sidebar is mounted ONCE here and the routed page renders into
 * the <Outlet>. Because the Sidebar lives above the route swap, navigating between pages
 * never remounts or re-fetches it — only the page content (with its own component-level
 * skeletons) changes. Pages render just their main-content column; the `.app-layout` flex
 * row (sidebar + content) is provided here.
 */
export default function AppShell() {
  return (
    <div className="app-layout">
      <Sidebar />
      <Outlet />
    </div>
  );
}
