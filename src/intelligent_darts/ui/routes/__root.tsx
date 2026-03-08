import { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "sonner";
import { Logo } from "@/components/apx/logo";

function NavBar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 h-12 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-4 gap-6">
      <Logo showText={false} />
      <div className="flex items-center gap-1">
        <Link
          to="/"
          className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border-b-2 border-transparent"
          activeProps={{ className: "!text-foreground !border-primary" }}
          activeOptions={{ exact: true }}
        >
          Game
        </Link>
        <Link
          to="/dashboard"
          className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors border-b-2 border-transparent"
          activeProps={{ className: "!text-foreground !border-primary" }}
        >
          Dashboard
        </Link>
      </div>
    </nav>
  );
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => (
    <>
      {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-right" />
        </>
      )}
      <NavBar />
      <div className="pt-12">
        <Outlet />
      </div>
      <Toaster richColors />
    </>
  ),
});
