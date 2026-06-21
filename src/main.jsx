import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { EnokiFlowProvider } from '@mysten/enoki/react'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import '@mysten/dapp-kit/dist/index.css'
import './index.css'
import App from './App.jsx'

const queryClient = new QueryClient()

const networks = {
  testnet: { url: getJsonRpcFullnodeUrl('testnet') },
}

// Public Enoki key — safe to expose in the browser
const ENOKI_PUBLIC_KEY = "enoki_public_81f69efa32009bbcc144f8f4a0a02219";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <EnokiFlowProvider apiKey={ENOKI_PUBLIC_KEY}>
          <WalletProvider autoConnect>
            <App />
          </WalletProvider>
        </EnokiFlowProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </StrictMode>,
)