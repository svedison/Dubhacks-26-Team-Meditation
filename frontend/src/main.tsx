import './shared/tokens.css'
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'

const MicTest = lazy(() => import('./pages/MicTest'))
const FaceLab = lazy(() => import('./dev/FaceLab'))
const ElderApp = lazy(() => import('./elder/ElderApp'))
const GuardianApp = lazy(() => import('./guardian/GuardianApp'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense>
        <Routes>
          <Route path="/mic-test" element={<MicTest />} />
          <Route path="/face-lab" element={<FaceLab />} />
          <Route path="/elder" element={<ElderApp />} />
          <Route path="/guardian/*" element={<GuardianApp />} />
          <Route path="*" element={<Navigate to="/elder" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
