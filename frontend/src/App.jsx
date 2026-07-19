import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import NavBar from './components/NavBar.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import SeriesList from './pages/Series/SeriesList.jsx';
import SeriesDetail from './pages/Series/SeriesDetail.jsx';
import MoviesList from './pages/Movies/MoviesList.jsx';
import MovieDetail from './pages/Movies/MovieDetail.jsx';
import Explore from './pages/Explore/Explore.jsx';
import ExploreDetail from './pages/Explore/ExploreDetail.jsx';
import Profile from './pages/Profile/Profile.jsx';
import Admin from './pages/Admin/Admin.jsx';
import { LoadingProgress, useElapsedSeconds } from './components/LoadingProgress.jsx';

function FullScreenLoader() {
  const seconds = useElapsedSeconds(true);
  return (
    <div className="h-screen flex items-center justify-center">
      <LoadingProgress seconds={seconds} />
    </div>
  );
}

function Protected({ children, adminOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/series" replace />;
  return children;
}

function Layout({ children }) {
  return (
    <div className="flex min-h-screen">
      <NavBar />
      <main className="flex-1 p-4 sm:p-6 pt-16 sm:pt-6 pb-20 sm:pb-6 max-w-6xl mx-auto w-full">{children}</main>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/series" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/series" replace /> : <Register />} />

      <Route path="/series" element={<Protected><Layout><SeriesList /></Layout></Protected>} />
      <Route path="/series/:showId" element={<Protected><Layout><SeriesDetail /></Layout></Protected>} />

      <Route path="/films" element={<Protected><Layout><MoviesList /></Layout></Protected>} />
      <Route path="/films/:movieId" element={<Protected><Layout><MovieDetail /></Layout></Protected>} />

      <Route path="/explorer" element={<Protected><Layout><Explore /></Layout></Protected>} />
      <Route path="/explorer/:mediaType/:source/:sourceId" element={<Protected><Layout><ExploreDetail /></Layout></Protected>} />

      <Route path="/profil" element={<Protected><Layout><Profile /></Layout></Protected>} />
      <Route path="/admin" element={<Protected adminOnly><Layout><Admin /></Layout></Protected>} />

      <Route path="*" element={<Navigate to={user ? '/series' : '/login'} replace />} />
    </Routes>
  );
}
