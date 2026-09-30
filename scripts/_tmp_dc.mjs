import fs from 'node:fs';
let t = fs.readFileSync('scripts/docs-check.mjs', 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing ' + a.slice(0, 40)); t = t.replace(a, () => b); };

rep("        if (relative(ROOT, absolute).startsWith('..')) continue; // enlaces a otros repositorios: no se validan aquí\n",
`        if (relative(ROOT, absolute).startsWith('..')) {
          // Enlace a un repositorio hermano: se comprueba si está presente; si no, solo se avisa.
          const sibling = /(?:^|[\\/])(sigmetum-[\w-]+)[\\/]/.exec(relative(ROOT, absolute))?.[1];
          if (!sibling) continue;
          if (!existsSync(resolve(ROOT, '..', sibling))) missingSiblings.add(sibling);
          else if (!existsSync(absolute)) problems.push(\`\${file}:\${index + 1} enlaza a \${target}, que no existe en \${sibling}\`);
          continue;
        }
`);
rep("  const problems = [];\n  for (const [file, text] of Object.entries(docs)) {\n    let inFence = false;\n    text.split('\n').forEach((line, index) => {\n      if (line.trimStart().startsWith('```')) inFence = !inFence;\n      if (inFence) return;\n      for (const [, target]",
    "  const problems = [];\n  const missingSiblings = new Set();\n  for (const [file, text] of Object.entries(docs)) {\n    let inFence = false;\n    text.split('\n').forEach((line, index) => {\n      if (line.trimStart().startsWith('```')) inFence = !inFence;\n      if (inFence) return;\n      for (const [, target]");
rep("  check('Enlaces internos y anclas', problems);\n}",
    "  check('Enlaces internos y anclas', problems);\n  warn('Enlaces a repositorios hermanos', [...missingSiblings].map((name) => `No existe ../${name}: sus enlaces no se han podido comprobar`));\n}");

rep("// 3. Módulos y entornos frente a la arquitectura del README",
`// 2c. Cada documento de integración figura en el índice del README y en CLAUDE.md
check(
  'Documentos de integración (docs/integracion → README.md y CLAUDE.md)',
  docFiles
    .filter((file) => file.startsWith('docs/integracion/'))
    .flatMap((file) => [
      !docs['README.md'].includes(\`(\${file}\`) && \`\${file} no figura en el índice del README\`,
      !(docs['CLAUDE.md'] ?? '').includes(file) && \`\${file} no figura en CLAUDE.md\`,
      !(docs['INTEGRACION.md'] ?? '').includes(file) && \`\${file} no figura en INTEGRACION.md\`,
    ])
    .filter(Boolean)
);

// 2d. Los comandos de la definición de terminado son los mismos en CLAUDE.md, las guías, la plantilla de PR y la CI
{
  const commands = ['terraform fmt -check -recursive', 'terraform validate', 'node scripts/quality-check.mjs', 'node scripts/docs-check.mjs'];
  const sources = ['CLAUDE.md', 'docs/guias/mantenimiento.md', 'docs/guias/buenas-practicas-terraform.md', '.github/pull_request_template.md', '.github/workflows/ci.yml'];
  const problems = [];
  for (const file of sources) {
    if (!existsSync(join(ROOT, file))) {
      problems.push(\`Falta \${file}\`);
      continue;
    }
    const text = docs[file] ?? read(file);
    for (const command of commands) if (!text.includes(command)) problems.push(\`\${file} no contiene el comando "\${command}"\`);
  }
  check('Comandos de la definición de terminado (CLAUDE.md, guías, plantilla de PR y CI)', problems);
}

// 3. Módulos y entornos frente a la arquitectura del README`);
fs.writeFileSync('scripts/docs-check.mjs', t);
