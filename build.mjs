import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const name of ['index.html', 'assets', 'admin']) {
  await cp(name, 'dist/' + name, { recursive: true });
}
