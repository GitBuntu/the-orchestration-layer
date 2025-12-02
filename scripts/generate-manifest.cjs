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
  
  // Handle date properly - if it's a Date object, convert to ISO string
  let dateStr = '';
  if (attributes.date instanceof Date) {
    dateStr = attributes.date.toISOString().slice(0, 10); // YYYY-MM-DD
  } else if (attributes.date) {
    dateStr = String(attributes.date).slice(0, 10);
  }
  
  return {
    title: attributes.title || filename,
    date: dateStr,
    slug: attributes.slug || filename.replace(/\.md$/, ''),
    filename,
    tags: attributes.tags || [],
  };
});

// Sort posts by date in descending order (newest first)
posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

fs.writeFileSync(manifestPath, JSON.stringify(posts, null, 2));
console.log(`Manifest written to ${manifestPath}`);
