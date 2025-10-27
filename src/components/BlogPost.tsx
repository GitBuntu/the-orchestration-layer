import ReactMarkdown from 'react-markdown'
import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import frontMatter from 'front-matter'

interface BlogPost {
  title: string
  date: string
  content: string
}

const BlogPost = () => {
  const { slug } = useParams()
  const [post, setPost] = useState<BlogPost | null>(null)

  useEffect(() => {
    async function fetchPost() {
      const res = await fetch(`/the-orchestration-layer/src/posts/${slug}.md`)
      const md = await res.text()
      const { attributes, body } = frontMatter(md) as { attributes: BlogPost; body: string }
      setPost({ title: attributes.title, date: attributes.date, content: body })
    }
    fetchPost()
  }, [slug])

  if (!post) return <div>Loading...</div>

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '2rem', textAlign: 'left' }}>
      <nav style={{ marginBottom: '2rem' }}>
        <Link to="/blog" style={{ textDecoration: 'none', color: 'var(--text-color)', fontSize: '1rem' }}>
          ← Back to Blog
        </Link>
      </nav>
      <h2>{post.title}</h2>
      <p>{String(post.date).split(' ')[0] + ' ' + String(post.date).split(' ')[1] + ' ' + String(post.date).split(' ')[2] + ' ' + String(post.date).split(' ')[3]}</p>
      <ReactMarkdown>{post.content}</ReactMarkdown>
    </div>
  )
}

export default BlogPost
