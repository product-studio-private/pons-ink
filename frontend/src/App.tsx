import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Launch } from './pages/Launch'
import { Token } from './pages/Token'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="launch" element={<Launch />} />
          <Route path="token/:address" element={<Token />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
