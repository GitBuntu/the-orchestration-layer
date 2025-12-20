import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import './App.css'
import Portfolio from './Portfolio.tsx'
import BlogList from './components/BlogList'
import BlogPost from './components/BlogPost'

interface BlogMeta {
  title: string
  date: string
  slug: string
  tags: string[]
}

function App() {
  const [theme, setTheme] = useState('paper')
  const [recentPosts, setRecentPosts] = useState<BlogMeta[]>([])

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  useEffect(() => {
    async function fetchPosts() {
      try {
        const res = await fetch('/the-orchestration-layer/src/posts/manifest.json')
        const manifest = await res.json()
        const posts = manifest.posts
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 3)
        setRecentPosts(posts)
      } catch (error) {
        console.error('Failed to fetch posts:', error)
      }
    }
    fetchPosts()
  }, [])

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'paper' : 'dark'))
  }

  const categories = [
    { name: 'Azure', slug: 'azure', description: 'Cloud infrastructure & deployment lessons' },
    { name: 'Infrastructure as Code', slug: 'infrastructure-as-code', description: 'Bicep, ARM templates & IaC patterns' },
    { name: 'DevOps', slug: 'devops', description: 'CI/CD, automation & deployment strategies' },
    { name: 'Artificial Intelligence', slug: 'artificial-intelligence', description: 'AI services & intelligent systems' },
    { name: 'CI/CD', slug: 'cicd', description: 'Continuous integration & deployment workflows' }
  ]

  const Home = () => (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '2rem', textAlign: 'left' }}>
      {/* Hero Section */}
      <section style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Building AI-Powered MVPs on Azure</h2>
        <p style={{ fontSize: '1.1rem', color: 'var(--read-docs)', marginBottom: '1rem' }}>
          Infrastructure, code, AI & automation—lessons from real-world MVPs.
        </p>
      </section>

      {/* About Blurb */}
      <section style={{ marginBottom: '3rem', padding: '1.5rem', backgroundColor: 'var(--bg-secondary)', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>About</h3>
        <p>
          I build AI MVPs on Azure, learning lessons along the way. This site documents those insights—infrastructure patterns, IaC approaches, DevOps strategies—tested through real deployments. Whether you're exploring Azure for AI systems, refining your infrastructure practices, or shipping your first MVP, you'll find practical insights here.
        </p>
      </section>

      {/* Quick Links / Categories */}
      <section style={{ marginBottom: '3rem' }}>
        <h3>Explore by Topic</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              to={`/blog/tag/${cat.slug}`}
              style={{
                padding: '1rem',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--read-docs)',
                borderRadius: '6px',
                textDecoration: 'none',
                color: 'var(--text-color)',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{cat.name}</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--read-docs)' }}>{cat.description}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Latest Articles */}
      {recentPosts.length > 0 && (
        <section>
          <h3>Latest Articles</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {recentPosts.map((post) => (
              <Link
                key={post.slug}
                to={`/blog/${post.slug}`}
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  color: 'var(--text-color)',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
              >
                <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{post.title}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--read-docs)' }}>
                  {new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                </div>
                {post.tags && (
                  <div style={{ fontSize: '0.85rem', marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {post.tags.map((tag) => (
                      <span key={tag} style={{ backgroundColor: 'var(--read-docs)', color: 'var(--bg-primary)', padding: '0.25rem 0.5rem', borderRadius: '3px' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link to="/blog" style={{ color: 'var(--text-color)', fontWeight: 'bold', textDecoration: 'none' }}>
              View all articles →
            </Link>
          </div>
        </section>
      )}
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
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '1rem', color: 'var(--read-docs)' }}>Infrastructure, AI, Code & DevOps</p>
        </div>
        <nav style={{ margin: '0 auto', display: 'flex', gap: '1rem' }}>
          <Link to="/" style={{ textDecoration: 'none', color: 'var(--text-color)' }}>Home</Link>
          <Link to="/blog" style={{ textDecoration: 'none', color: 'var(--text-color)' }}>Blog</Link>
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
