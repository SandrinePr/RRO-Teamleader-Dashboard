// Hoofdrouting: Overzicht (/), Deals (/deals), Sales activiteit (/sales-activity) binnen gemeenschappelijke layout.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components'
import { Dashboard } from './Dashboard'
import { Overview } from './Overview'
import { SalesActivity } from './SalesActivity'
import './styles/main.scss'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="deals" element={<Dashboard />} />
          <Route path="sales-activity" element={<SalesActivity />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
