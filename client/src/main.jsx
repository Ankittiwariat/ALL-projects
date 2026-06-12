import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from 'react-router-dom'
import { AppContextProvider } from './context/AppContext.jsx'
import { Provider } from 'react-redux'
import store from './redux/store.js'
import { setupInterceptors } from './services/api.js'
import { logoutUser } from './redux/slices/authSlice.js'

// Initialize interceptors with store access to avoid circular dependencies
setupInterceptors(store, logoutUser);

createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <BrowserRouter>
      <AppContextProvider>
        <App />
      </AppContextProvider>
    </BrowserRouter>
  </Provider>
)
