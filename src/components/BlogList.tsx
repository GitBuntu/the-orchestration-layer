import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

interface BlogPost {
  title: string;
  date: string;
  slug: string;
  content?: string;
  filename: string;
  tags?: string[];
}

const BlogList: React.FC = () => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const { tag } = useParams<{ tag?: string }>();

  useEffect(() => {
    async function loadLocalPosts() {
      const res = await fetch('/the-orchestration-layer/src/posts/manifest.json');
      const manifest = await res.json();
      setPosts(manifest);
    }
    loadLocalPosts();
  }, []);

  // Collect all unique tags
  const allTags = Array.from(new Set(posts.flatMap(post => post.tags || [])));

  // Filter posts by selected tag
  const filteredPosts = tag ? posts.filter(post => post.tags?.includes(tag)) : posts;

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '2rem' }}>
      <div style={{ marginBottom: '2rem', color: '#7da2ff', fontFamily: 'monospace', fontSize: '1rem' }}>
        <span style={{ color: 'var(--read-docs)', marginRight: '0.5rem' }}>tags:</span>
        {allTags.map(t => (
          <Link
            key={t}
            to={tag === t ? '/blog' : `/blog/tag/${t}`}
            style={{
              color: '#7da2ff',
              marginRight: '0.5rem',
              textDecoration: tag === t ? 'underline' : 'none',
              fontWeight: tag === t ? 'bold' : 'normal',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'inherit',
            }}
          >
            {t}
          </Link>
        ))}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {filteredPosts.map((post) => (
          <li key={post.slug + post.date} style={{ marginBottom: '2.5rem' }}>
            <Link to={`/blog/${post.slug}`} style={{ textDecoration: 'none', color: 'var(--text-color)' }}>
              <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 500, textAlign: 'left' }}>{post.title}</h2>
            </Link>
            <p style={{ margin: '0.5rem 0 0 0', color: 'var(--read-docs)', fontSize: '0.95rem', textAlign: 'left' }}>
              {String(post.date).split(' ')[0]}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BlogList;
