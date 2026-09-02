import Sidebar from "./Sidebar";
import { SkeletonPage } from "./ui";

/**
 * Full-page loading state (Branch 02): the app shell + a shaped skeleton, so a page that is
 * still fetching shows its layout rather than a bare centred spinner. Used by the data pages
 * in place of `<Spinner />` first-load guards.
 */
export default function PageLoading({ stats = 4 }: { stats?: number }) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px", overflowY: "auto" }}>
          <SkeletonPage stats={stats} />
        </div>
      </div>
    </div>
  );
}
