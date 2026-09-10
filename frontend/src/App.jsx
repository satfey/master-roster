import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { StoreScopeProvider } from './context/StoreScopeContext';
import AppRoutes from './routes/AppRoutes';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StoreScopeProvider>
          <AppRoutes />
        </StoreScopeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
