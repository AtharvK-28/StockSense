import { Compass } from "lucide-react";
import { Fragment } from "react";
import { Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { Layout, Logo } from "./components/Layout";
import { Button, EmptyState, Spinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { Dashboard } from "./pages/Dashboard";
import { MoveHistory } from "./pages/MoveHistory";
import { Profile } from "./pages/Profile";
import { ForgotPassword } from "./pages/auth/ForgotPassword";
import { Login } from "./pages/auth/Login";
import { Signup } from "./pages/auth/Signup";
import { DocumentList } from "./pages/operations/DocumentList";
import { DocumentPage } from "./pages/operations/DocumentPage";
import { Categories } from "./pages/products/Categories";
import { ProductList } from "./pages/products/ProductList";
import { ProductPage } from "./pages/products/ProductPage";
import { Reordering } from "./pages/products/Reordering";
import { Stock } from "./pages/products/Stock";
import { Locations } from "./pages/settings/Locations";
import { Team } from "./pages/settings/Team";
import { Warehouses } from "./pages/settings/Warehouses";

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <Spinner />
      </div>
    </div>
  );
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Remounts its page whenever the path changes, so "new" forms never inherit stale state. */
function Keyed({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <Fragment key={pathname}>{children}</Fragment>;
}

function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="We can't find that page"
      action={
        <Link to="/">
          <Button>Back to dashboard</Button>
        </Link>
      }
    >
      It may have been moved, or the link is incorrect.
    </EmptyState>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="products" element={<ProductList />} />
          <Route path="products/new" element={<Keyed><ProductPage /></Keyed>} />
          <Route path="products/categories" element={<Categories />} />
          <Route path="products/reordering" element={<Reordering />} />
          <Route path="products/:id" element={<Keyed><ProductPage /></Keyed>} />
          <Route path="operations/:kind" element={<DocumentList />} />
          <Route path="operations/:kind/new" element={<Keyed><DocumentPage /></Keyed>} />
          <Route path="operations/:kind/:id" element={<Keyed><DocumentPage /></Keyed>} />
          <Route path="moves" element={<MoveHistory />} />
          <Route path="stock" element={<Stock />} />
          <Route path="settings/warehouses" element={<Warehouses />} />
          <Route path="settings/locations" element={<Locations />} />
          <Route path="settings/team" element={<Team />} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
