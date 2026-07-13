import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Nanopaquete } from './Nanopaquete'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Nanopaquete />
  </StrictMode>,
)
