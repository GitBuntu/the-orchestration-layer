---
title: Building a Markdown Blog with React, Typescript & Vite on Github Pages
date: 2025-10-27
slug: markdown-react-vite
tags: [react, typescript]
---

# Building a Markdown Blog with React, Typescript & Vite on Github Pages

I wanted a fast, modern, and automated way to publish a blog using React, markdown, and GitHub Pages. This post is a step-by-step summary of my journey, including all the lessons learned and solutions to common pitfalls. If you’re building something similar, I hope this helps you avoid the headaches and get your blog online with confidence.

## 1. Vite + React Setup
- Initialize a Vite/React SPA for instant HMR (Hot Module Replacement) and modern tooling.
- Create a minimal theme and navigation for Home, Blog, and Tag filtering.

## 2. Markdown Blog Support
- Use `react-markdown` for rendering posts. For example:

  ```tsx
  // BlogPost.tsx
  import React from 'react';
  import ReactMarkdown from 'react-markdown';

  export default function BlogPost({ content }: { content: string }) {
    return <ReactMarkdown>{content}</ReactMarkdown>;
  }
  ```

  To fetch and display a markdown file:

  ```tsx
  // Example usage in a component
  import { useEffect, useState } from 'react';
  import BlogPost from './BlogPost';

  export default function BlogPostLoader({ url }: { url: string }) {
    const [content, setContent] = useState('');

    useEffect(() => {
      fetch(url)
        .then(res => res.text())
        .then(setContent);
    }, [url]);

    return <BlogPost content={content} />;
  }
  ```
- Parse front-matter with the browser-compatible `front-matter` package. For example:

  ```js
  // Node.js example: scripts/generate-manifest.cjs
  const fm = require('front-matter');
  const fs = require('fs');
  const content = fs.readFileSync('src/posts/markdown-react-vite.md', 'utf-8');
  const { attributes, body } = fm(content);
  console.log(attributes); // { title, date, slug, tags }
  console.log(body); // Markdown content
  ```

  In the browser (if you want to parse front-matter client-side):

  ```js
  import fm from 'front-matter';
  // Assume 'raw' is the markdown string fetched from a file
  const { attributes, body } = fm(raw);
  ```
- Automate blog post listing with a manifest generator.

## 3. Manifest Generation
- Write a Node.js script to scan markdown files and output a manifest JSON. For example:

  ```js
  // scripts/generate-manifest.cjs
  const fs = require('fs');
  const path = require('path');
  const fm = require('front-matter');

  const postsDir = path.join(__dirname, '../src/posts');
  const manifestPath = path.join(postsDir, 'manifest.json');

  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));

  const posts = files.map(filename => {
    const filePath = path.join(postsDir, filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { attributes } = fm(content);
    return {
      title: attributes.title || filename,
      date: (attributes.date || '').toString().slice(0, 10), // YYYY-MM-DD
      slug: attributes.slug || filename.replace(/\.md$/, ''),
      filename,
      tags: attributes.tags || [],
    };
  });

  fs.writeFileSync(manifestPath, JSON.stringify(posts, null, 2));
  console.log(`Manifest written to ${manifestPath}`);
  ```
- Integrate manifest generation into the build pipeline. For example, in your `package.json`:

  ```json
  {
    "scripts": {
      "generate-manifest": "node scripts/generate-manifest.cjs",
      "prebuild": "npm run generate-manifest",
      "build": "tsc -b && vite build"
    }
  }
  ```

This ensures the manifest is always up-to-date before each build.

## 4. Asset Path Resolution
- Create an asset helper using `import.meta.env.BASE_URL` for correct URLs in all environments.

## 5. Static Asset Copying
- Use `vite-plugin-static-copy` to copy markdown and manifest files to the build output. For example, in your `vite.config.ts`:

  ```ts
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import { viteStaticCopy } from 'vite-plugin-static-copy';

  export default defineConfig({
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          { src: 'src/posts/*.md', dest: 'posts' },
          { src: 'src/posts/manifest.json', dest: 'posts' },
        ],
      }),
    ],
    // ...other config
  });
  ```

## 6. RESTful Tag Filtering
- Use `react-router-dom` for dynamic routes like `/blog/tag/:tag`.
- Fetch posts and manifest using the asset helper.

## 7. Automated Deployment
- Set up GitHub Actions to run build, manifest generation, and deploy with `peaceiris/actions-gh-pages`.

## 8. SPA Routing Fallback
- GitHub Pages needs a fallback for SPA routes. Add a postbuild script to copy `index.html` to `404.html`:
  ```json
  "postbuild": "cp dist/index.html dist/404.html"
  ```
- This lets the SPA handle routing for all URLs.

## Key Lessons
- Use browser-compatible markdown parsers.
- Automate manifest generation and asset copying.
- Always configure SPA fallback for GitHub Pages.
- Automate deployment for reliability.
- Link to repo: [The Orchestration Layer Repo](https://github.com/GitBuntu/the-orchestration-layer)

### Prompt and Context Engineering
Throughout this project, I leveraged advanced prompt engineering techniques to guide AI assistants in generating accurate, production-ready code. By providing detailed context, breaking down complex tasks, and iterating on feedback, I ensured that every component—from Vite configuration to syntax highlighting—was implemented correctly. This approach minimized errors, accelerated development, and demonstrated the power of precise communication with AI tools for modern web development.

Here are two standout prompts that drove key improvements:

1. **Adding Code Examples**: "Extract code block used to fetch and display the markdown file and add it to the blog post. Use `react-markdown` for rendering posts is just too vague."  
   This led to adding detailed, runnable code snippets for markdown rendering, front-matter parsing, manifest generation, and build integration, transforming vague descriptions into practical, copy-pasteable solutions.

2. **Adding Syntax Highlighting**: "There are code blocks in markdown. This works currently. Ensure all code blocks in markdown have a black background and the syntax has color highlighting."  
   This led to integrating `react-syntax-highlighter` with the `vscDarkPlus` theme, resulting in professional-looking code blocks with full syntax coloring.

## References

This blog post was created with the assistance of various online resources and documentation. Full disclosure: I referenced a list of sources to help compile and refine the content for accuracy and completeness.

- [Build & Deploy React Vite Website on Github Pages (CI/CD)](https://www.youtube.com/watch?v=uXiwgO_p0Yg)
- [How To Deploy A React Vite App To Github Pages (Simple)](https://www.youtube.com/watch?v=hn1IkJk24ow)

---
I am certain this workflow will help you build and deploy modern markdown blogs with React, Typescript, and Vite on Github Pages — avoiding common pitfalls and shipping with confidence.
