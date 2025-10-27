// Node.js script to generate a manifest of all markdown posts
const fs = require('fs');
const path = require('path');
const fm = require('front-matter');

const postsDir = path.join(__dirname, '../src/posts');
const manifestPath = path.join(__dirname, '../src/posts/manifest.json');

const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
const posts = files.map(filename => {
  const filePath = path.join(postsDir, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  const { attributes } = fm(content);
  return {
    title: attributes.title || filename,
    date: attributes.date || '',
    slug: attributes.slug || filename.replace(/\.md$/, ''),
    filename,
    tags: attributes.tags || [],
  };
});

fs.writeFileSync(manifestPath, JSON.stringify(posts, null, 2));
console.log(`Manifest written to ${manifestPath}`);
