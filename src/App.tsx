import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import './App.css'
import Portfolio from './Portfolio.tsx'
import BlogList from './components/BlogList'
import BlogPost from './components/BlogPost'

function App() {
  const [theme, setTheme] = useState('paper')

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'paper' : 'dark'))
  }

  const Home = () => (
    <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto', padding: '2rem' }}>
      {/* Content can be added here if needed */}
    </div>
  )

  return (
    <>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '1rem 2rem',
        borderBottom: '1px solid var(--read-docs)',
        marginBottom: '2rem'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>The Orchestration Layer</h1>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '1rem', color: 'var(--read-docs)' }}>A place for ideas, projects, and thoughts.</p>
        </div>
        <nav style={{ margin: '0 auto', display: 'flex', gap: '1rem' }}>
          <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-color)' }}>Home</Link>
          <Link to="/portfolio" style={{ textDecoration: 'none', color: 'var(--text-color)' }}>Portfolio</Link>
        </nav>
        <button onClick={toggleTheme} style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-color)',
          fontSize: '1rem'
        }}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/blog" element={<BlogList />} />
        <Route path="/blog/tag/:tag" element={<BlogList />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
      </Routes>
    </>
  )
}

export default App
